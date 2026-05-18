-- Bulk-confirm auto-matched MDB review rows.
-- This only moves review rows from auto_matched to matched. It does not update public.members.

DROP FUNCTION IF EXISTS public.admin_mdb_review_confirm_auto_matches();

CREATE OR REPLACE FUNCTION public.admin_mdb_review_confirm_auto_matches()
RETURNS TABLE (
  affected_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  RETURN QUERY
  WITH updated AS (
    UPDATE public.staging_member_matches smm
    SET
      match_status = 'matched',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = concat_ws(
        E'\n',
        NULLIF(smm.review_note, ''),
        'Bulk auto-match confirmation: review status changed to matched before members apply'
      )
    WHERE
      smm.match_status = 'auto_matched'
      AND smm.auto_classification = 'auto_matched'
      AND smm.member_id IS NOT NULL
    RETURNING smm.staging_id
  )
  SELECT count(*)::bigint AS affected_count
  FROM updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mdb_review_confirm_auto_matches() TO authenticated;

NOTIFY pgrst, 'reload schema';
