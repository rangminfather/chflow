-- A child added from one parent's card must also be linked to that parent's
-- spouse. Directory search derives grandchildren through two parent edges;
-- without the second edge, one side of the grandparents cannot find the child.

create or replace function public.member_add_child(
  p_parent_id  uuid,
  p_name       text,
  p_gender     text default null,
  p_birth_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_id       uuid;
  v_household_id   uuid;
  v_family_church  text;
  v_parent_gender  text;
  v_parent_name    text;
  v_spouse_name    text;
  v_spouse_id      uuid;
  v_spouse_gender  text;
  v_parent_role    text;
  v_spouse_role    text;
begin
  if not public.can_manage_member_children(p_parent_id) then
    raise exception '권한이 없습니다';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception '이름은 필수입니다';
  end if;

  select m.household_id, m.family_church, m.gender, m.name, m.spouse_name
    into v_household_id, v_family_church, v_parent_gender, v_parent_name, v_spouse_name
  from public.members m
  where m.id = p_parent_id;

  if not found then
    raise exception '부모 회원을 찾을 수 없습니다';
  end if;
  if v_household_id is null then
    raise exception '부모의 가족(household) 정보가 없어 자녀를 추가할 수 없습니다';
  end if;

  -- Prefer an explicit spouse_id, then either direction of the spouse
  -- relation. Reciprocal spouse names are the compatibility fallback for
  -- older records that have not yet been structurally linked.
  select candidate.spouse_id, candidate.gender
    into v_spouse_id, v_spouse_gender
  from (
    select s.id as spouse_id, s.gender, 0 as priority
    from public.members p
    join public.members s on s.id = p.spouse_id
    where p.id = p_parent_id and s.status = 'active'

    union all

    select s.id, s.gender, 1
    from public.member_relations r
    join public.members s on s.id = r.relative_id and s.status = 'active'
    where r.subject_id = p_parent_id and r.kind = 'spouse'

    union all

    select s.id, s.gender, 2
    from public.member_relations r
    join public.members s on s.id = r.subject_id and s.status = 'active'
    where r.relative_id = p_parent_id and r.kind = 'spouse'

    union all

    select s.id, s.gender, 3
    from public.members s
    where nullif(trim(v_spouse_name), '') is not null
      and s.id <> p_parent_id
      and s.status = 'active'
      and s.name = v_spouse_name
      and nullif(trim(s.spouse_name), '') = v_parent_name
    order by priority, spouse_id
    limit 1
  ) candidate;

  insert into public.members (
    name, household_id, family_church, is_child, gender, birth_date, guard_status, phone
  )
  values (
    trim(p_name), v_household_id, v_family_church, true,
    p_gender, p_birth_date, '비회원', ''
  )
  returning id into v_child_id;

  v_parent_role := case v_parent_gender
    when 'M' then 'father'
    when 'F' then 'mother'
    else null
  end;

  insert into public.member_relations (
    subject_id, relative_id, kind, role, created_by
  )
  values (
    v_child_id, p_parent_id, 'parent', v_parent_role, auth.uid()
  );

  if v_spouse_id is not null and v_spouse_id <> p_parent_id then
    v_spouse_role := case v_spouse_gender
      when 'M' then 'father'
      when 'F' then 'mother'
      else null
    end;

    insert into public.member_relations (
      subject_id, relative_id, kind, role, created_by
    )
    values (
      v_child_id, v_spouse_id, 'parent', v_spouse_role, auth.uid()
    )
    on conflict (subject_id, relative_id, kind)
    do update set role = excluded.role;
  end if;

  return v_child_id;
end;
$$;

grant execute on function public.member_add_child(uuid, text, text, date) to authenticated;

-- Repair the child that exposed the issue. The mother edge already exists.
insert into public.member_relations (subject_id, relative_id, kind, role)
values (
  '49606634-a2bd-4954-ad83-ab42907ecc54'::uuid,
  'a4e4354d-ae1f-4190-aaaf-3e19d5e203f4'::uuid,
  'parent',
  'father'
)
on conflict (subject_id, relative_id, kind)
do update set role = excluded.role;

notify pgrst, 'reload schema';
