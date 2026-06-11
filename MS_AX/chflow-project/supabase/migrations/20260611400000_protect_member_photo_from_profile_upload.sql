-- Prevent personal profile uploads from overwriting the directory/original member photo.
-- profiles.avatar_url is the user-controlled profile photo.
-- members.photo_url is the directory/original photo and must not point at the user's upload folder.

CREATE OR REPLACE FUNCTION public.update_my_photo(p_photo_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  UPDATE public.profiles
  SET avatar_url = p_photo_url
  WHERE id = auth.uid();
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_profile_upload_as_member_photo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.photo_url IS NOT NULL
     AND NEW.app_user_id IS NOT NULL
     AND NEW.photo_url LIKE ('%/member-photos/' || NEW.app_user_id::text || '/%') THEN
    RAISE EXCEPTION 'profile upload cannot be stored as member directory photo';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_prevent_profile_upload_as_member_photo ON public.members;
CREATE TRIGGER trg_prevent_profile_upload_as_member_photo
BEFORE INSERT OR UPDATE OF photo_url, app_user_id ON public.members
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_upload_as_member_photo();
