-- PostgreSQL does not define min(uuid). Patch the already deployed staging
-- function while keeping clean installations on the corrected source body.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.stage_education_import(jsonb,jsonb)'::regprocedure
  ) into v_definition;

  v_definition := replace(
    v_definition,
    'min(c.id) AS course_id',
    'min(c.id::text)::uuid AS course_id'
  );
  v_definition := replace(
    v_definition,
    'min(mc.member_id) AS single_member_id',
    'min(mc.member_id::text)::uuid AS single_member_id'
  );
  v_definition := replace(
    v_definition,
    'min(c.id) as course_id',
    'min(c.id::text)::uuid as course_id'
  );
  v_definition := replace(
    v_definition,
    'min(mc.member_id) as single_member_id',
    'min(mc.member_id::text)::uuid as single_member_id'
  );

  if v_definition ~* 'min\(c\.id\)' or v_definition ~* 'min\(mc\.member_id\)' then
    raise exception 'stage_education_import uuid aggregate patch did not apply';
  end if;

  execute v_definition;
end;
$$;
