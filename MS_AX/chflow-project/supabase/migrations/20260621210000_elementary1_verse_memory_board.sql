-- Elementary 1 monthly verse-memory board.
-- Read: approved department members through parent grade (0..4).
-- Write/delete: department executives, including secretary/manager (0..2).

create table if not exists public.dept_verse_memories (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  memory_month date not null,
  title text not null,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint dept_verse_memories_month_first_day
    check (memory_month = date_trunc('month', memory_month)::date),
  constraint dept_verse_memories_attachments_array
    check (jsonb_typeof(attachments) = 'array')
);

create index if not exists idx_dept_verse_memories_month
  on public.dept_verse_memories (department_id, memory_month desc, created_at desc)
  where deleted_at is null;

alter table public.dept_verse_memories enable row level security;
revoke all on table public.dept_verse_memories from anon, authenticated;

create or replace function public.list_dept_verse_memories(
  p_department_id uuid,
  p_year int default extract(year from current_date)::int
)
returns table (
  id uuid,
  memory_month date,
  title text,
  body text,
  attachments jsonb,
  author_name text,
  author_sub_role text,
  can_delete boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_dept_name text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;

  select d.name into v_dept_name
  from public.departments d
  where d.id = p_department_id and d.is_active = true;

  if v_dept_name is distinct from '초등1부' then
    raise exception '요절암송 게시판은 초등1부 전용입니다';
  end if;

  v_grade := public.get_user_grade(p_department_id);
  if v_grade is null or v_grade > 4 then
    raise exception '요절암송 자료를 볼 권한이 없습니다';
  end if;

  return query
  select
    vm.id,
    vm.memory_month,
    vm.title,
    vm.body,
    vm.attachments,
    pr.name,
    pr.sub_role,
    (v_grade <= 2 or vm.author_id = auth.uid()),
    vm.created_at,
    vm.updated_at
  from public.dept_verse_memories vm
  left join public.profiles pr on pr.id = vm.author_id
  where vm.department_id = p_department_id
    and vm.deleted_at is null
    and extract(year from vm.memory_month)::int = coalesce(p_year, extract(year from current_date)::int)
  order by vm.memory_month desc, vm.created_at desc;
end;
$$;

grant execute on function public.list_dept_verse_memories(uuid, int) to authenticated;

create or replace function public.create_dept_verse_memory(
  p_department_id uuid,
  p_memory_month date,
  p_title text,
  p_body text default '',
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_grade smallint;
  v_dept_name text;
  v_id uuid;
  v_month date;
  v_attachment jsonb;
  v_author_name text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;

  select d.name into v_dept_name
  from public.departments d
  where d.id = p_department_id and d.is_active = true;

  if v_dept_name is distinct from '초등1부' then
    raise exception '요절암송 게시판은 초등1부 전용입니다';
  end if;

  v_grade := public.get_user_grade(p_department_id);
  if v_grade is null or v_grade > 2 then
    raise exception '요절암송 등록은 총무·서기 이상 임원진만 가능합니다';
  end if;

  if coalesce(trim(p_title), '') = '' then raise exception '제목을 입력하세요'; end if;
  if p_memory_month is null then raise exception '대상 월을 선택하세요'; end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 8 then
    raise exception '첨부파일은 최대 8개까지 가능합니다';
  end if;

  for v_attachment in
    select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    if coalesce(v_attachment->>'file_path', '') not like auth.uid()::text || '/verse-memory/%'
       or coalesce(v_attachment->>'file_name', '') = '' then
      raise exception '잘못된 첨부파일 정보입니다';
    end if;
  end loop;

  v_month := date_trunc('month', p_memory_month)::date;
  insert into public.dept_verse_memories
    (department_id, author_id, memory_month, title, body, attachments)
  values
    (p_department_id, auth.uid(), v_month, trim(p_title), coalesce(trim(p_body), ''), coalesce(p_attachments, '[]'::jsonb))
  returning id into v_id;

  select p.name into v_author_name from public.profiles p where p.id = auth.uid();
  insert into public.notifications (user_id, type, title, body, link_url, created_by, metadata)
  select
    dm.user_id,
    'dept_verse_memory_new',
    '요절암송 자료 등록',
    extract(month from v_month)::int || '월 · ' || trim(p_title),
    '/departments/d/' || p_department_id || '/verse-memory',
    auth.uid(),
    jsonb_build_object('verse_memory_id', v_id, 'department_id', p_department_id, 'author_name', v_author_name)
  from public.department_members dm
  where dm.department_id = p_department_id
    and dm.status = 'approved'
    and dm.user_id <> auth.uid();

  return v_id;
end;
$$;

grant execute on function public.create_dept_verse_memory(uuid, date, text, text, jsonb) to authenticated;

create or replace function public.delete_dept_verse_memory(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.dept_verse_memories;
  v_grade smallint;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;

  select * into v_row
  from public.dept_verse_memories
  where id = p_id and deleted_at is null;
  if not found then raise exception '자료를 찾을 수 없습니다'; end if;

  v_grade := public.get_user_grade(v_row.department_id);
  if v_grade is null or v_grade > 2 then
    raise exception '요절암송 자료 삭제는 총무·서기 이상 임원진만 가능합니다';
  end if;

  update public.dept_verse_memories
  set deleted_at = now(), updated_at = now()
  where id = p_id;

  return v_row.attachments;
end;
$$;

grant execute on function public.delete_dept_verse_memory(uuid) to authenticated;
