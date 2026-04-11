-- =============================================================
-- Storage 버킷: member-photos (회원 사진)
-- =============================================================

-- 버킷 생성 (이미 있으면 스킵)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'member-photos',
  'member-photos',
  true,                                          -- 공개 (URL로 직접 접근)
  5242880,                                       -- 5MB 제한
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- =============================================================
-- Storage RLS Policies
-- =============================================================

-- 인증된 사용자만 본인 폴더에 업로드 가능
DROP POLICY IF EXISTS "member_photos_upload_own" ON storage.objects;
CREATE POLICY "member_photos_upload_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'member-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 본인 사진만 업데이트
DROP POLICY IF EXISTS "member_photos_update_own" ON storage.objects;
CREATE POLICY "member_photos_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 본인 사진만 삭제
DROP POLICY IF EXISTS "member_photos_delete_own" ON storage.objects;
CREATE POLICY "member_photos_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'member-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 누구나 (인증/비인증) 사진 조회 가능 (공개 버킷이므로 URL로도 접근 가능)
DROP POLICY IF EXISTS "member_photos_read_all" ON storage.objects;
CREATE POLICY "member_photos_read_all"
  ON storage.objects FOR SELECT
  TO authenticated, anon
  USING (bucket_id = 'member-photos');


-- =============================================================
-- 사용자 사진 URL 업데이트 RPC
-- =============================================================
DROP FUNCTION IF EXISTS public.update_my_photo(text);
CREATE OR REPLACE FUNCTION public.update_my_photo(p_photo_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;

  -- profiles.avatar_url 업데이트
  UPDATE public.profiles
  SET avatar_url = p_photo_url
  WHERE id = auth.uid();

  -- 매칭된 member가 있으면 members.photo_url도 업데이트
  UPDATE public.members
  SET photo_url = p_photo_url
  WHERE app_user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_photo(text) TO authenticated;


-- =============================================================
-- 내 사진 조회 RPC (avatar_url + member photo_url 모두)
-- =============================================================
DROP FUNCTION IF EXISTS public.get_my_photos();
CREATE OR REPLACE FUNCTION public.get_my_photos()
RETURNS TABLE (
  avatar_url text,
  member_photo_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.avatar_url,
    m.photo_url AS member_photo_url
  FROM public.profiles p
  LEFT JOIN public.members m ON m.app_user_id = p.id
  WHERE p.id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_photos() TO authenticated;
