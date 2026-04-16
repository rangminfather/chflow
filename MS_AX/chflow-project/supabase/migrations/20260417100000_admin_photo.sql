-- 관리자가 타인의 사진 업로드/변경 가능하도록 Storage 정책 확장
DROP POLICY IF EXISTS "member_photos_admin_all" ON storage.objects;
CREATE POLICY "member_photos_admin_all"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND public.get_user_role() IN ('admin', 'office', 'pastor')
  )
  WITH CHECK (
    bucket_id = 'member-photos'
    AND public.get_user_role() IN ('admin', 'office', 'pastor')
  );

-- 관리자용 photo_url 갱신 RPC
DROP FUNCTION IF EXISTS public.admin_set_member_photo(uuid, text);
CREATE OR REPLACE FUNCTION public.admin_set_member_photo(p_member_id uuid, p_photo_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.get_user_role() NOT IN ('admin', 'office', 'pastor') THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
  UPDATE public.members SET photo_url = p_photo_url WHERE id = p_member_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_member_photo(uuid, text) TO authenticated;

-- 특정 회원의 가족 관계 조회 (admin용)
DROP FUNCTION IF EXISTS public.admin_member_profile(uuid);
CREATE OR REPLACE FUNCTION public.admin_member_profile(p_member_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'member', to_jsonb(m) || jsonb_build_object(
      'address', h.address,
      'home_phone', h.home_phone,
      'pasture_name', p.name,
      'grassland_name', g.name,
      'plain_name', pl.name
    ),
    'household_members', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', mm.id, 'name', mm.name, 'phone', mm.phone,
        'family_church', mm.family_church, 'sub_role', mm.sub_role,
        'is_child', mm.is_child, 'photo_url', mm.photo_url, 'gender', mm.gender
      ) ORDER BY mm.is_child, mm.name)
      FROM public.members mm WHERE mm.household_id = m.household_id AND mm.id <> m.id
    ),
    'relations', (
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'role', r.role,
        'relative_id', r.relative_id,
        'name', rm.name, 'phone', rm.phone,
        'photo_url', rm.photo_url,
        'pasture_name', rp.name,
        'plain_name', rpl.name,
        'direction', 'ancestor'
      ))
      FROM public.member_relations r
      JOIN public.members rm ON rm.id = r.relative_id
      LEFT JOIN public.households rh ON rm.household_id = rh.id
      LEFT JOIN public.directory_pastures rp ON rh.pasture_id = rp.id
      LEFT JOIN public.grasslands rg ON rp.grassland_id = rg.id
      LEFT JOIN public.plains rpl ON rg.plain_id = rpl.id
      WHERE r.subject_id = p_member_id
    ),
    'descendants', (
      SELECT jsonb_agg(jsonb_build_object(
        'kind', r.kind, 'role', r.role,
        'relative_id', r.subject_id,
        'name', sm.name, 'phone', sm.phone,
        'photo_url', sm.photo_url,
        'pasture_name', sp.name,
        'plain_name', spl.name,
        'direction', 'descendant'
      ))
      FROM public.member_relations r
      JOIN public.members sm ON sm.id = r.subject_id
      LEFT JOIN public.households sh ON sm.household_id = sh.id
      LEFT JOIN public.directory_pastures sp ON sh.pasture_id = sp.id
      LEFT JOIN public.grasslands sg ON sp.grassland_id = sg.id
      LEFT JOIN public.plains spl ON sg.plain_id = spl.id
      WHERE r.relative_id = p_member_id AND r.kind <> 'spouse'
    )
  )
  FROM public.members m
  LEFT JOIN public.households h ON m.household_id = h.id
  LEFT JOIN public.directory_pastures p ON h.pasture_id = p.id
  LEFT JOIN public.grasslands g ON p.grassland_id = g.id
  LEFT JOIN public.plains pl ON g.plain_id = pl.id
  WHERE m.id = p_member_id;
$$;
GRANT EXECUTE ON FUNCTION public.admin_member_profile(uuid) TO authenticated;

-- 관계 제거
DROP FUNCTION IF EXISTS public.remove_member_relation(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.remove_member_relation(
  p_subject_id uuid, p_relative_id uuid, p_kind text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.member_relations
  WHERE subject_id = p_subject_id AND relative_id = p_relative_id AND kind = p_kind;
END;
$$;
GRANT EXECUTE ON FUNCTION public.remove_member_relation(uuid, uuid, text) TO authenticated;
