-- 검수용 교회요람 PDF 저장소: directory-pdf 버킷
-- private bucket, admin/office/pastor 만 접근

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'directory-pdf',
  'directory-pdf',
  false,
  110 * 1024 * 1024,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- admin/office/pastor 만 SELECT (signed URL 생성용)
DROP POLICY IF EXISTS "directory_pdf_admin_read" ON storage.objects;
CREATE POLICY "directory_pdf_admin_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'directory-pdf'
    AND public.get_user_role() IN ('admin', 'office', 'pastor')
  );

DROP POLICY IF EXISTS "directory_pdf_admin_write" ON storage.objects;
CREATE POLICY "directory_pdf_admin_write"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'directory-pdf'
    AND public.get_user_role() IN ('admin', 'office', 'pastor')
  )
  WITH CHECK (
    bucket_id = 'directory-pdf'
    AND public.get_user_role() IN ('admin', 'office', 'pastor')
  );
