-- 성도용 위치 기반 자동출석 1단계
--
-- 자동출석은 법적/회계상 출석 증빙이 아니라 목회 참고용 신호다.
-- 모바일은 geofence 진입 후보를 제출하고, 체류 시간이 서버 기준을
-- 만족할 때만 church_attendance 로 확정한다.

CREATE TABLE IF NOT EXISTS public.attendance_geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'default' CHECK (scope = 'default'),
  name text NOT NULL DEFAULT '본당',
  latitude numeric(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m integer NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 50 AND 500),
  dwell_seconds integer NOT NULL DEFAULT 600 CHECK (dwell_seconds BETWEEN 300 AND 3600),
  window_start time NOT NULL DEFAULT '07:00',
  window_end time NOT NULL DEFAULT '15:00',
  timezone text NOT NULL DEFAULT 'Asia/Seoul',
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope)
);

CREATE TABLE IF NOT EXISTS public.attendance_location_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  geofence_id uuid NOT NULL REFERENCES public.attendance_geofences(id),
  local_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('android_geofence', 'ios_region', 'foreground_check')),
  entered_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  dwell_seconds integer NOT NULL DEFAULT 0 CHECK (dwell_seconds >= 0),
  distance_m numeric(8, 2) CHECK (distance_m IS NULL OR distance_m >= 0),
  accuracy_m numeric(8, 2) CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  device_event_id text,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'confirmed', 'expired', 'rejected')),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, local_date)
);

CREATE TABLE IF NOT EXISTS public.church_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  attend_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('auto_geofence', 'manual', 'corrected')),
  candidate_id uuid REFERENCES public.attendance_location_candidates(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES auth.users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, attend_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_candidates_date_status
  ON public.attendance_location_candidates(local_date, status);
CREATE INDEX IF NOT EXISTS idx_attendance_candidates_member_date
  ON public.attendance_location_candidates(member_id, local_date DESC);
CREATE INDEX IF NOT EXISTS idx_church_attendance_date
  ON public.church_attendance(attend_date DESC);
CREATE INDEX IF NOT EXISTS idx_church_attendance_member_date
  ON public.church_attendance(member_id, attend_date DESC);

ALTER TABLE public.attendance_geofences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_location_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_attendance ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_member_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.member_id FROM public.profiles p WHERE p.id = auth.uid()),
    (SELECT m.id FROM public.members m WHERE m.app_user_id = auth.uid() LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_church_attendance()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.members m ON m.id = p.member_id
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('admin', 'pastor', 'office', 'leader')
        OR m.family_church IN ('목자', '목녀')
        OR EXISTS (
          SELECT 1
          FROM public.pastures pasture
          WHERE pasture.leader_id = p.member_id
        )
      )
  );
$$;

CREATE POLICY attendance_geofences_select_authenticated
  ON public.attendance_geofences FOR SELECT TO authenticated USING (true);
CREATE POLICY attendance_geofences_manage_admin_office
  ON public.attendance_geofences FOR ALL TO authenticated
  USING (public.get_user_role() IN ('admin', 'office'))
  WITH CHECK (public.get_user_role() IN ('admin', 'office'));

CREATE POLICY attendance_candidates_select_self_or_manager
  ON public.attendance_location_candidates FOR SELECT TO authenticated
  USING (member_id = public.current_member_id() OR public.can_manage_church_attendance());
CREATE POLICY attendance_records_select_self_or_manager
  ON public.church_attendance FOR SELECT TO authenticated
  USING (member_id = public.current_member_id() OR public.can_manage_church_attendance());

-- 모바일 클라이언트는 원시 INSERT를 하지 않고 이 RPC만 호출한다.
-- 후보는 하루 1건으로 합쳐지며, 이미 확정된 출석은 절대 되돌리지 않는다.
CREATE OR REPLACE FUNCTION public.submit_attendance_candidate(
  p_geofence_id uuid,
  p_local_date date,
  p_source text,
  p_entered_at timestamptz,
  p_last_seen_at timestamptz,
  p_dwell_seconds integer,
  p_distance_m numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_device_event_id text DEFAULT NULL
)
RETURNS public.attendance_location_candidates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member_id uuid := public.current_member_id();
  v_required_dwell integer;
  v_candidate public.attendance_location_candidates;
BEGIN
  IF v_member_id IS NULL THEN RAISE EXCEPTION '연결된 성도 계정을 찾을 수 없습니다'; END IF;
  IF p_source NOT IN ('android_geofence', 'ios_region', 'foreground_check') THEN
    RAISE EXCEPTION '지원하지 않는 위치 이벤트 출처입니다';
  END IF;
  SELECT * INTO v_geofence FROM public.attendance_geofences
   WHERE id = p_geofence_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION '활성화된 출석 위치가 아닙니다'; END IF;
  IF p_last_seen_at < p_entered_at OR p_dwell_seconds < 0 THEN
    RAISE EXCEPTION '위치 이벤트 시간이 올바르지 않습니다';
  END IF;

  INSERT INTO public.attendance_location_candidates
    (member_id, geofence_id, local_date, source, entered_at, last_seen_at,
     dwell_seconds, distance_m, accuracy_m, device_event_id, status)
  VALUES
    (v_member_id, p_geofence_id, p_local_date, p_source, p_entered_at, p_last_seen_at,
     p_dwell_seconds, p_distance_m, p_accuracy_m, p_device_event_id, 'candidate')
  ON CONFLICT (member_id, local_date) DO UPDATE SET
    last_seen_at = GREATEST(attendance_location_candidates.last_seen_at, EXCLUDED.last_seen_at),
    dwell_seconds = GREATEST(attendance_location_candidates.dwell_seconds, EXCLUDED.dwell_seconds),
    distance_m = COALESCE(EXCLUDED.distance_m, attendance_location_candidates.distance_m),
    accuracy_m = COALESCE(EXCLUDED.accuracy_m, attendance_location_candidates.accuracy_m),
    device_event_id = COALESCE(EXCLUDED.device_event_id, attendance_location_candidates.device_event_id),
    updated_at = now()
  RETURNING * INTO v_candidate;
  RETURN v_candidate;
END;
$$;

-- 서버/검증 단계에서만 호출한다. 실제 출석은 최소 체류시간을 만족할 때 기록한다.
CREATE OR REPLACE FUNCTION public.confirm_attendance_candidate(p_candidate_id uuid)
RETURNS public.church_attendance
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_candidate public.attendance_location_candidates;
  v_geofence public.attendance_geofences;
  v_attendance public.church_attendance;
BEGIN
  SELECT c, g.dwell_seconds
    INTO v_candidate, v_required_dwell
    FROM public.attendance_location_candidates c
    JOIN public.attendance_geofences g ON g.id = c.geofence_id
   WHERE c.id = p_candidate_id AND c.status IN ('candidate', 'confirmed');
  IF NOT FOUND THEN RAISE EXCEPTION '출석 후보를 찾을 수 없습니다'; END IF;
  IF v_candidate.member_id <> public.current_member_id()
     AND NOT public.can_manage_church_attendance() THEN
    RAISE EXCEPTION '출석 후보를 확정할 권한이 없습니다';
  END IF;
  IF v_candidate.dwell_seconds < v_required_dwell THEN
    RAISE EXCEPTION '최소 체류시간을 충족하지 않았습니다';
  END IF;

  INSERT INTO public.church_attendance
    (member_id, attend_date, source, candidate_id, recorded_by)
  VALUES
    (v_candidate.member_id, v_candidate.local_date, 'auto_geofence', v_candidate.id, NULL)
  ON CONFLICT (member_id, attend_date) DO NOTHING
  RETURNING * INTO v_attendance;

  UPDATE public.attendance_location_candidates
     SET status = 'confirmed', updated_at = now()
   WHERE id = p_candidate_id;

  IF v_attendance.id IS NULL THEN
    SELECT * INTO v_attendance FROM public.church_attendance
     WHERE member_id = v_candidate.member_id AND attend_date = v_candidate.local_date;
  END IF;
  RETURN v_attendance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_member_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_church_attendance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_attendance_candidate(uuid, date, text, timestamptz, timestamptz, integer, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_attendance_candidate(uuid) TO authenticated;

-- 리더 화면용 조회 계약. 원자료의 좌표는 반환하지 않는다.
CREATE OR REPLACE FUNCTION public.list_church_attendance_overview(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  member_id uuid,
  member_name text,
  attend_date date,
  source text,
  recorded_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_church_attendance() THEN
    RAISE EXCEPTION '출석 조회 권한이 없습니다';
  END IF;
  IF p_end_date < p_start_date OR p_end_date - p_start_date > 366 THEN
    RAISE EXCEPTION '조회 기간은 1년 이내여야 합니다';
  END IF;
  RETURN QUERY
  SELECT a.member_id, m.name, a.attend_date, a.source, a.recorded_at
    FROM public.church_attendance a
    JOIN public.members m ON m.id = a.member_id
   WHERE a.attend_date BETWEEN p_start_date AND p_end_date
   ORDER BY a.attend_date DESC, m.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_church_absence_candidates(
  p_as_of_date date DEFAULT current_date,
  p_weeks smallint DEFAULT 2
)
RETURNS TABLE (
  member_id uuid,
  member_name text,
  last_attend_date date,
  absent_weeks integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_church_attendance() THEN
    RAISE EXCEPTION '장기 미출석 조회 권한이 없습니다';
  END IF;
  IF p_weeks < 2 OR p_weeks > 12 THEN
    RAISE EXCEPTION '미출석 기준은 2~12주 사이여야 합니다';
  END IF;
  RETURN QUERY
  SELECT m.id,
         m.name,
         MAX(a.attend_date) AS last_attend_date,
         FLOOR((p_as_of_date - MAX(a.attend_date)) / 7.0)::integer AS absent_weeks
    FROM public.members m
    LEFT JOIN public.church_attendance a ON a.member_id = m.id
   WHERE m.status = 'active'
     AND COALESCE(m.is_child, false) = false
   GROUP BY m.id, m.name
  HAVING MAX(a.attend_date) IS NOT NULL
     AND p_as_of_date - MAX(a.attend_date) >= p_weeks * 7
   ORDER BY last_attend_date NULLS FIRST, m.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_church_attendance_overview(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_church_absence_candidates(date, smallint) TO authenticated;
