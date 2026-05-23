-- get_my_profile_full: avatar_url 컬럼 추가 (사용자가 직접 등록한 사진).
-- photo_url 은 요람 원본, avatar_url 은 본인 변경.

DROP FUNCTION IF EXISTS public.get_my_profile_full();

CREATE OR REPLACE FUNCTION public.get_my_profile_full()
RETURNS TABLE(
  user_id uuid,
  username text,
  role text,
  status text,
  approved_at timestamp with time zone,
  must_change_password boolean,
  member_id uuid,
  name text,
  phone text,
  birth_date date,
  gender text,
  family_church text,
  sub_role text,
  spouse_name text,
  is_child boolean,
  photo_url text,
  avatar_url text,
  household_id uuid,
  address text,
  pasture_name text,
  grassland_name text,
  plain_name text,
  review_status text,
  review_note text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.id, p.username, p.role, p.status, p.approved_at, p.must_change_password,
    m.id, m.name, COALESCE(p.phone, m.phone), m.birth_date, m.gender,
    m.family_church, COALESCE(p.sub_role, m.sub_role), m.spouse_name, m.is_child,
    m.photo_url, p.avatar_url,
    m.household_id, h.address,
    pa.name, g.name, pl.name,
    m.review_status, m.review_note
  FROM public.profiles p
  LEFT JOIN public.members m ON m.app_user_id = p.id
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures pa ON h.pasture_id = pa.id
  LEFT JOIN public.grasslands g ON pa.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE p.id = auth.uid();
$function$;
