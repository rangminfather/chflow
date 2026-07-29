-- CHFlow education history foundation.
-- Raw import rows are immutable; only normalized/review fields may change.

create table if not exists public.app_capabilities (
  capability_key text primary key,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.app_capability_grants (
  id uuid primary key default gen_random_uuid(),
  capability_key text not null references public.app_capabilities(capability_key) on delete cascade,
  principal_type text not null
    check (principal_type in ('authenticated', 'system_role', 'member_sub_role', 'user')),
  principal_key text,
  principal_user_id uuid references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (
    (principal_type = 'authenticated' and principal_key = '*' and principal_user_id is null)
    or (principal_type in ('system_role', 'member_sub_role') and principal_key is not null and principal_user_id is null)
    or (principal_type = 'user' and principal_key is null and principal_user_id is not null)
  )
);

create unique index if not exists app_capability_grants_named_unique
  on public.app_capability_grants(capability_key, principal_type, principal_key)
  where principal_type <> 'user';
create unique index if not exists app_capability_grants_user_unique
  on public.app_capability_grants(capability_key, principal_user_id)
  where principal_type = 'user';

create or replace function public.has_app_capability(
  p_capability text,
  p_user_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  -- Authenticated callers may only inspect themselves. A service/postgres caller
  -- may supply an actor id for a local administrative import.
  if current_user in ('service_role', 'postgres') and p_user_id is not null then
    v_user_id := p_user_id;
  else
    v_user_id := auth.uid();
  end if;

  if v_user_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.profiles p
    join public.app_capabilities c
      on c.capability_key = p_capability
     and c.active
    where p.id = v_user_id
      and p.status = 'active'
      and exists (
        select 1
        from public.app_capability_grants g
        where g.capability_key = c.capability_key
          and g.active
          and (
            (g.principal_type = 'authenticated' and g.principal_key = '*')
            or (g.principal_type = 'system_role' and g.principal_key = p.role)
            or (g.principal_type = 'user' and g.principal_user_id = p.id)
            or (
              g.principal_type = 'member_sub_role'
              and exists (
                select 1
                from public.members m
                where (m.app_user_id = p.id or m.id = p.member_id)
                  and m.status = 'active'
                  and m.sub_role = g.principal_key
              )
            )
          )
      )
  );
end;
$$;

create or replace function public.assert_app_capability(p_capability text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_app_capability(p_capability) then
    raise exception '권한이 없습니다: %', p_capability using errcode = '42501';
  end if;
end;
$$;

create table if not exists public.education_courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  category text not null
    check (category in (
      'life_study', 'discipleship', 'mission_training', 'family_ministry',
      'bible_training', 'leadership_training', 'lmtc', 'other', 'unclassified'
    )),
  default_audience text not null default 'adult'
    check (default_audience in ('adult', 'youth', 'child', 'couple', 'parent', 'leader', 'unknown')),
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  unique (normalized_name, default_audience)
);

create table if not exists public.education_course_aliases (
  id uuid primary key default gen_random_uuid(),
  raw_course_name text not null,
  normalized_raw_name text not null,
  course_id uuid not null references public.education_courses(id) on delete restrict,
  cohort_no integer,
  class_variant text,
  audience text
    check (audience is null or audience in ('adult', 'youth', 'child', 'couple', 'parent', 'leader', 'unknown')),
  ministry_department text,
  normalization_rule jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists education_course_aliases_active_unique
  on public.education_course_aliases(normalized_raw_name, coalesce(audience, 'unknown'))
  where active;

create table if not exists public.education_course_policies (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.education_courses(id) on delete restrict,
  requirement_type text not null
    check (requirement_type in ('basic_required', 'elective', 'not_applicable', 'unknown')),
  effective_from date,
  effective_to date,
  policy_name text not null,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table if not exists public.education_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  source_type text not null
    check (source_type in ('general_education_history', 'lmtc_history', 'standard_csv')),
  file_hash text not null check (file_hash ~ '^[0-9a-fA-F]{64}$'),
  parser_version text not null,
  total_tables integer not null default 0,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  repeated_header_rows integer not null default 0,
  empty_rows integer not null default 0,
  import_status text not null default 'parsed'
    check (import_status in (
      'parsed', 'staged', 'reviewing', 'partially_approved', 'approved',
      'cancelled', 'failed', 'duplicate'
    )),
  validation_report jsonb not null default '{}'::jsonb,
  duplicate_of_batch_id uuid references public.education_import_batches(id) on delete set null,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text
);

create index if not exists education_import_batches_hash_idx
  on public.education_import_batches(file_hash, source_type);
create index if not exists education_import_batches_status_idx
  on public.education_import_batches(import_status, uploaded_at desc);

create table if not exists public.education_offerings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.education_courses(id) on delete restrict,
  cohort_no integer,
  cohort_label_raw text,
  cohort_from integer,
  cohort_to integer,
  cohort_precision text not null default 'unknown'
    check (cohort_precision in ('exact', 'range', 'unknown')),
  class_variant text,
  instructor_raw text,
  audience text not null default 'unknown'
    check (audience in ('adult', 'youth', 'child', 'couple', 'parent', 'leader', 'unknown')),
  ministry_department text,
  organization_raw text,
  started_on date,
  ended_on date,
  completed_on date,
  date_precision text not null default 'unknown'
    check (date_precision in ('day', 'month', 'year', 'range', 'unknown')),
  source_import_batch_id uuid references public.education_import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (cohort_to is null or cohort_from is null or cohort_to >= cohort_from),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);

create index if not exists education_offerings_course_idx
  on public.education_offerings(course_id, completed_on desc);
create index if not exists education_offerings_cohort_idx
  on public.education_offerings(cohort_no, cohort_from, cohort_to);

create table if not exists public.education_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.education_import_batches(id) on delete cascade,
  source_table_no integer not null,
  source_row_no integer not null,
  serial_raw text,
  course_name_raw text,
  person_name_raw text,
  instructor_raw text,
  certificate_no_raw text,
  date_raw text,
  note_raw text,
  status_raw text,
  raw_data jsonb not null,
  raw_row_text text not null,
  parser_version text not null,

  person_name_normalized text,
  historical_role_raw text,
  disambiguator_raw text,
  organization_raw text,
  normalization_note text,
  cohort_no integer,
  cohort_label_raw text,
  cohort_from integer,
  cohort_to integer,
  cohort_precision text not null default 'unknown'
    check (cohort_precision in ('exact', 'range', 'unknown')),
  class_variant text,
  audience text not null default 'unknown'
    check (audience in ('adult', 'youth', 'child', 'couple', 'parent', 'leader', 'unknown')),
  ministry_department text,
  category text
    check (category is null or category in (
      'life_study', 'discipleship', 'mission_training', 'family_ministry',
      'bible_training', 'leadership_training', 'lmtc', 'other', 'unclassified'
    )),
  requirement_type text
    check (requirement_type is null or requirement_type in ('basic_required', 'elective', 'not_applicable', 'unknown')),
  started_on date,
  ended_on date,
  completed_on date,
  date_precision text not null default 'unknown'
    check (date_precision in ('day', 'month', 'year', 'range', 'unknown')),
  attendance_status text not null default 'unknown'
    check (attendance_status in ('completed', 'attended', 'applied', 'education', 'incomplete', 'unknown')),
  date_parse_status text not null default 'unknown'
    check (date_parse_status in ('parsed', 'partial', 'invalid', 'blank', 'unknown')),
  normalized_data jsonb not null default '{}'::jsonb,

  suggested_course_id uuid references public.education_courses(id) on delete set null,
  suggested_member_id uuid references public.members(id) on delete set null,
  matched_member_id uuid references public.members(id) on delete set null,
  match_status text not null default 'pending'
    check (match_status in (
      'pending', 'recommended', 'ambiguous', 'unmatched', 'approved',
      'rejected', 'skipped', 'duplicate_suspected'
    )),
  normalization_status text not null default 'unclassified'
    check (normalization_status in ('auto_suggested', 'manually_confirmed', 'ambiguous', 'unclassified')),
  duplicate_status text not null default 'unchecked'
    check (duplicate_status in ('unchecked', 'clear', 'suspected', 'resolved')),
  duplicate_resolution text
    check (duplicate_resolution is null or duplicate_resolution in (
      'keep_existing', 'keep_new', 'keep_both', 'merge', 'exclude'
    )),
  review_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  excluded_at timestamptz,
  excluded_by uuid references auth.users(id) on delete set null,
  exclusion_reason text,
  created_history_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, source_table_no, source_row_no),
  check (cohort_to is null or cohort_from is null or cohort_to >= cohort_from),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);

create index if not exists education_import_rows_review_idx
  on public.education_import_rows(batch_id, match_status, normalization_status);
create index if not exists education_import_rows_person_idx
  on public.education_import_rows(person_name_normalized);
create index if not exists education_import_rows_course_raw_idx
  on public.education_import_rows(course_name_raw);
create index if not exists education_import_rows_date_status_idx
  on public.education_import_rows(date_parse_status, attendance_status);

create table if not exists public.education_import_match_candidates (
  id uuid primary key default gen_random_uuid(),
  import_row_id uuid not null references public.education_import_rows(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  candidate_rank integer not null,
  match_score numeric(5,2),
  match_basis jsonb not null default '{}'::jsonb,
  alias_id uuid,
  created_at timestamptz not null default now(),
  unique (import_row_id, member_id)
);

create index if not exists education_match_candidates_row_idx
  on public.education_import_match_candidates(import_row_id, candidate_rank);

create table if not exists public.education_import_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  import_row_id uuid not null references public.education_import_rows(id) on delete cascade,
  history_id uuid,
  duplicate_basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (import_row_id, history_id)
);

create table if not exists public.member_identity_aliases (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  person_name_raw text not null,
  person_name_normalized text not null,
  historical_role_raw text,
  disambiguator_raw text,
  organization_raw text,
  source_type text
    check (source_type is null or source_type in ('general_education_history', 'lmtc_history', 'standard_csv')),
  match_confidence numeric(5,2),
  active boolean not null default true,
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists member_identity_aliases_name_idx
  on public.member_identity_aliases(person_name_normalized)
  where active;

create table if not exists public.member_education_history (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  course_id uuid not null references public.education_courses(id) on delete restrict,
  offering_id uuid references public.education_offerings(id) on delete set null,
  attendance_status text not null
    check (attendance_status in ('completed', 'attended', 'applied', 'education', 'incomplete', 'unknown')),
  certificate_no_raw text,
  person_name_raw text not null,
  historical_role_raw text,
  organization_raw text,
  source_import_row_id uuid references public.education_import_rows(id) on delete set null,
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deletion_reason text
);

alter table public.education_import_rows
  add constraint education_import_rows_created_history_fkey
  foreign key (created_history_id) references public.member_education_history(id) on delete set null;
alter table public.education_import_duplicate_candidates
  add constraint education_duplicate_candidates_history_fkey
  foreign key (history_id) references public.member_education_history(id) on delete cascade;
alter table public.education_import_match_candidates
  add constraint education_match_candidates_alias_fkey
  foreign key (alias_id) references public.member_identity_aliases(id) on delete set null;

create index if not exists member_education_history_member_idx
  on public.member_education_history(member_id, created_at desc)
  where deleted_at is null;
create index if not exists member_education_history_course_idx
  on public.member_education_history(course_id, attendance_status)
  where deleted_at is null;
create unique index if not exists member_education_history_source_unique
  on public.member_education_history(source_import_row_id)
  where source_import_row_id is not null and deleted_at is null;

create table if not exists public.education_history_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target_type text not null,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  reason text,
  import_row_id uuid references public.education_import_rows(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists education_history_audit_target_idx
  on public.education_history_audit_logs(target_type, target_id, created_at desc);
create index if not exists education_history_audit_actor_idx
  on public.education_history_audit_logs(actor_id, created_at desc);

create or replace function public.education_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger education_courses_touch_updated_at
  before update on public.education_courses
  for each row execute function public.education_touch_updated_at();
create trigger education_course_aliases_touch_updated_at
  before update on public.education_course_aliases
  for each row execute function public.education_touch_updated_at();
create trigger education_course_policies_touch_updated_at
  before update on public.education_course_policies
  for each row execute function public.education_touch_updated_at();
create trigger education_offerings_touch_updated_at
  before update on public.education_offerings
  for each row execute function public.education_touch_updated_at();
create trigger education_import_rows_touch_updated_at
  before update on public.education_import_rows
  for each row execute function public.education_touch_updated_at();
create trigger member_education_history_touch_updated_at
  before update on public.member_education_history
  for each row execute function public.education_touch_updated_at();
create trigger app_capability_grants_touch_updated_at
  before update on public.app_capability_grants
  for each row execute function public.education_touch_updated_at();

create or replace function public.education_guard_import_raw_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if row(
    new.batch_id, new.source_table_no, new.source_row_no, new.serial_raw,
    new.course_name_raw, new.person_name_raw, new.instructor_raw,
    new.certificate_no_raw, new.date_raw, new.note_raw, new.status_raw,
    new.raw_data, new.raw_row_text, new.parser_version
  ) is distinct from row(
    old.batch_id, old.source_table_no, old.source_row_no, old.serial_raw,
    old.course_name_raw, old.person_name_raw, old.instructor_raw,
    old.certificate_no_raw, old.date_raw, old.note_raw, old.status_raw,
    old.raw_data, old.raw_row_text, old.parser_version
  ) then
    raise exception '원본 import 행은 수정할 수 없습니다' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger education_import_rows_raw_immutable
  before update on public.education_import_rows
  for each row execute function public.education_guard_import_raw_fields();

create or replace function public.education_audit_row_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_target_id text;
  v_import_row uuid;
begin
  if tg_table_name = 'education_import_rows' then
    if tg_op = 'INSERT' then return new; end if;
    if tg_op = 'UPDATE' and new.reviewed_at is null and old.reviewed_at is null then
      return new;
    end if;
  end if;

  v_action := case
    when tg_op = 'INSERT' then lower(tg_table_name) || '.created'
    when tg_op = 'DELETE' then lower(tg_table_name) || '.deleted'
    else lower(tg_table_name) || '.updated'
  end;
  v_target_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'));
  v_import_row := nullif(coalesce(
    to_jsonb(new)->>'source_import_row_id',
    to_jsonb(new)->>'import_row_id',
    to_jsonb(old)->>'source_import_row_id',
    to_jsonb(old)->>'import_row_id'
  ), '')::uuid;

  insert into public.education_history_audit_logs(
    action, target_type, target_id, before_data, after_data, actor_id, import_row_id, reason
  )
  values (
    v_action,
    tg_table_name,
    v_target_id,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    auth.uid(),
    v_import_row,
    coalesce(
      nullif(current_setting('app.education_audit_reason', true), ''),
      case when tg_table_name = 'education_course_policies'
        then coalesce(to_jsonb(new)->>'note', to_jsonb(old)->>'note') end,
      case when tg_table_name = 'education_import_rows'
        then coalesce(
          to_jsonb(new)->>'review_note', to_jsonb(new)->>'exclusion_reason',
          to_jsonb(old)->>'review_note', to_jsonb(old)->>'exclusion_reason'
        ) end
    )
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger education_courses_audit
  after insert or update or delete on public.education_courses
  for each row execute function public.education_audit_row_changes();
create trigger education_course_aliases_audit
  after insert or update or delete on public.education_course_aliases
  for each row execute function public.education_audit_row_changes();
create trigger education_course_policies_audit
  after insert or update or delete on public.education_course_policies
  for each row execute function public.education_audit_row_changes();
create trigger education_import_batches_audit
  after insert or update or delete on public.education_import_batches
  for each row execute function public.education_audit_row_changes();
create trigger education_import_rows_audit
  after insert or update or delete on public.education_import_rows
  for each row execute function public.education_audit_row_changes();
create trigger member_identity_aliases_audit
  after insert or update or delete on public.member_identity_aliases
  for each row execute function public.education_audit_row_changes();
create trigger member_education_history_audit
  after insert or update or delete on public.member_education_history
  for each row execute function public.education_audit_row_changes();
create trigger app_capability_grants_audit
  after insert or update or delete on public.app_capability_grants
  for each row execute function public.education_audit_row_changes();
