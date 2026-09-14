-- Ephemeral local-Supabase verification for bulletin scripture readings.
-- This is executed only against the GitHub-hosted runner's local Docker database.
\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
end;
$$;

-- Schema assertions: these inspect the database after the complete migration chain applied.
select pg_temp.assert_true(to_regclass('public.bulletin_scripture_readings') is not null,
  'bulletin_scripture_readings exists');

select pg_temp.assert_true((
  select relrowsecurity from pg_class where oid = 'public.bulletin_scripture_readings'::regclass
), 'RLS is enabled');

select pg_temp.assert_true((
  select count(*) = 2
  from pg_constraint
  where conrelid = 'public.bulletin_scripture_readings'::regclass
    and contype = 'f'
    and pg_get_constraintdef(oid) in (
      'FOREIGN KEY (bulletin_id) REFERENCES bulletins(id) ON DELETE CASCADE',
      'FOREIGN KEY (book_id) REFERENCES bible_books(book_id)'
    )
), 'bulletin_id and book_id foreign keys exist');

select pg_temp.assert_true(exists (
  select 1 from pg_constraint
  where conrelid = 'public.bulletin_scripture_readings'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (bulletin_id, service_type, sort_order)'
), 'unique bulletin/service/sort constraint exists');

select pg_temp.assert_true(exists (
  select 1 from pg_constraint
  where conrelid = 'public.bulletin_scripture_readings'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ~ 'pending.*verified.*rejected'
), 'status constraint permits pending, verified, and rejected only');

select pg_temp.assert_true(exists (
  select 1 from pg_index i
  join pg_class c on c.oid = i.indexrelid
  where i.indrelid = 'public.bulletin_scripture_readings'::regclass
    and c.relname = 'bulletin_scripture_readings_verified_idx'
    and pg_get_expr(i.indpred, i.indrelid) = '(status = ''verified''::text)'
), 'verified partial index exists');

select pg_temp.assert_true((
  select count(*) = 3 from pg_policies
  where schemaname = 'public'
    and tablename = 'bulletin_scripture_readings'
) = 3, 'all three RLS policies exist');

-- Fixture rows are created as the local database owner, then read through authenticated RLS.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-normal@example.test', '$2a$10$7EqJtq98hPqEX7fNZaFWoOaQHqD/2zVZQzW4QxK5AegNtNs3RZOeK', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-admin@example.test', '$2a$10$7EqJtq98hPqEX7fNZaFWoOaQHqD/2zVZQzW4QxK5AegNtNs3RZOeK', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.profiles (id, email, name, role) values
  ('00000000-0000-0000-0000-000000000101', 'rls-normal@example.test', 'RLS normal', 'member'),
  ('00000000-0000-0000-0000-000000000102', 'rls-admin@example.test', 'RLS admin', 'admin');

insert into public.bulletins (id, title, sunday_date) values
  ('00000000-0000-0000-0000-000000000201', 'RLS fixture bulletin', date '2026-09-13');

insert into public.bible_books (book_id, osis_code, testament, book_order, name_ko, name_en, chapters)
values (1, 'Gen', 'OT', 1, '창세기', 'Genesis', 50);

insert into public.bulletin_scripture_readings (
  bulletin_id, service_type, book_id, chapter_start, verse_start, chapter_end, verse_end,
  raw_reference, source, confidence, status, sort_order
) values
  ('00000000-0000-0000-0000-000000000201', 'sunday_morning', 1, 1, 1, 1, 1, '창세기 1:1', 'manual', 1, 'verified', 0),
  ('00000000-0000-0000-0000-000000000201', 'sunday_afternoon', 1, 1, 2, 1, 2, '창세기 1:2', 'ocr', 0.9, 'pending', 0),
  ('00000000-0000-0000-0000-000000000201', 'wednesday_morning', 1, 1, 3, 1, 3, '창세기 1:3', 'ocr', 0.9, 'rejected', 0);

-- Normal authenticated user: one verified row only and all writes denied.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select pg_temp.assert_true(public.get_user_role() = 'member', 'normal get_user_role returns member without recursion');
select pg_temp.assert_true((select count(*) from public.bulletin_scripture_readings) = 1,
  'normal user sees exactly the verified reading');
select pg_temp.assert_true((select count(*) from public.bulletin_scripture_readings where status = 'pending') = 0,
  'normal user cannot see pending reading');
select pg_temp.assert_true((select count(*) from public.bulletin_scripture_readings where status = 'rejected') = 0,
  'normal user cannot see rejected reading');

do $$
declare affected integer;
begin
  begin
    insert into public.bulletin_scripture_readings (bulletin_id, service_type, raw_reference, source, sort_order)
    values ('00000000-0000-0000-0000-000000000201', 'wednesday_evening', '창세기 1:4', 'manual', 0);
    raise exception 'normal INSERT was unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  update public.bulletin_scripture_readings set normalized_label = 'not allowed' where status = 'verified';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'normal UPDATE was unexpectedly allowed'; end if;
  delete from public.bulletin_scripture_readings where status = 'verified';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'normal DELETE was unexpectedly allowed'; end if;
end;
$$;
rollback;

-- Staff authenticated user: all states and the permitted write lifecycle are available.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select pg_temp.assert_true(public.get_user_role() = 'admin', 'admin get_user_role returns admin without recursion');
select pg_temp.assert_true((select count(*) from public.bulletin_scripture_readings) = 3,
  'admin sees verified, pending, and rejected readings');

insert into public.bulletin_scripture_readings (bulletin_id, service_type, raw_reference, source, sort_order)
values ('00000000-0000-0000-0000-000000000201', 'wednesday_evening', '창세기 1:4', 'manual', 0);

select pg_temp.assert_true((select count(*) from public.bulletin_scripture_readings where status = 'pending') = 2,
  'admin can insert pending reading');

update public.bulletin_scripture_readings set status = 'verified'
where service_type = 'sunday_afternoon';
select pg_temp.assert_true((select status = 'verified' from public.bulletin_scripture_readings where service_type = 'sunday_afternoon'),
  'admin can verify pending reading');

update public.bulletin_scripture_readings set status = 'rejected'
where service_type = 'wednesday_evening';
select pg_temp.assert_true((select status = 'rejected' from public.bulletin_scripture_readings where service_type = 'wednesday_evening'),
  'admin can reject pending reading');

delete from public.bulletin_scripture_readings where service_type = 'wednesday_evening';
select pg_temp.assert_true((select count(*) from public.bulletin_scripture_readings where service_type = 'wednesday_evening') = 0,
  'admin can delete according to current staff-write policy');
rollback;

-- SECURITY DEFINER hardening assertions after authenticated queries have exercised the function.
select pg_temp.assert_true((
  select prosecdef from pg_proc where oid = 'public.get_user_role()'::regprocedure
), 'get_user_role is SECURITY DEFINER');
select pg_temp.assert_true((
  select proconfig @> array['search_path=public'] from pg_proc where oid = 'public.get_user_role()'::regprocedure
), 'get_user_role has a fixed public search_path');
select pg_temp.assert_true(has_function_privilege('authenticated', 'public.get_user_role()', 'EXECUTE'),
  'authenticated has execute permission on get_user_role');
select pg_temp.assert_true((
  select r.rolname not in ('authenticated', 'anon')
  from pg_proc p join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.get_user_role()'::regprocedure
), 'get_user_role owner is not an untrusted API role');

select 'bulletin scripture readings migration and RLS verification passed' as result;
