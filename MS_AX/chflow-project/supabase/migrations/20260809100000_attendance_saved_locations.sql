-- 자동출석 위치를 여러 개 보관하고, 그중 하나를 현재 등록지점으로 지정한다.

CREATE TABLE IF NOT EXISTS public.attendance_saved_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '저장된 위치',
  latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (latitude, longitude)
);

ALTER TABLE public.attendance_geofences
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.attendance_saved_locations(id) ON DELETE SET NULL;

-- 기존 전역 위치도 목록으로 보존하고 현재 등록지점과 연결한다.
INSERT INTO public.attendance_saved_locations (name, latitude, longitude, created_by, updated_by)
SELECT name, latitude, longitude, created_by, updated_by
FROM public.attendance_geofences
WHERE scope = 'default'
ON CONFLICT (latitude, longitude) DO NOTHING;

UPDATE public.attendance_geofences AS geofence
SET location_id = saved.id
FROM public.attendance_saved_locations AS saved
WHERE geofence.scope = 'default'
  AND geofence.location_id IS NULL
  AND saved.latitude = geofence.latitude
  AND saved.longitude = geofence.longitude;

ALTER TABLE public.attendance_saved_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_saved_locations_select_authenticated
  ON public.attendance_saved_locations;
CREATE POLICY attendance_saved_locations_select_authenticated
  ON public.attendance_saved_locations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS attendance_saved_locations_manage_admin_office
  ON public.attendance_saved_locations;
CREATE POLICY attendance_saved_locations_manage_admin_office
  ON public.attendance_saved_locations FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office'));
