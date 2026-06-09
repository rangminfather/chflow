CREATE OR REPLACE FUNCTION get_real_email_by_username(p_username text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT au.email INTO v_email
  FROM auth.users au
  JOIN public.profiles p ON p.user_id = au.id
  WHERE p.username = p_username;

  IF v_email IS NULL OR v_email LIKE '%@smartms.app' THEN
    RETURN NULL;
  END IF;

  RETURN v_email;
END;
$$;
