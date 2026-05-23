-- update_my_photo: members.photo_url(요람 원본)을 더 이상 건드리지 않음.
-- profile.avatar_url 만 사용자 사진. NULL 허용 → "요람으로 되돌리기".

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
