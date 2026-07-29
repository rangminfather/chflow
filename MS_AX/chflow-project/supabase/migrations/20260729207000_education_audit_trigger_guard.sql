-- Avoid record-field resolution on tables that do not have reviewed_at.
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
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
