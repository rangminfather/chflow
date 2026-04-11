-- =============================================================
-- chflow Church Management System - Initial Migration
-- PostgreSQL / Supabase
-- =============================================================

-- =============================================================
-- 1. profiles (사용자 프로필)
-- =============================================================
CREATE TABLE public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text,
  name       text,
  role       text DEFAULT 'member' CHECK (role IN ('admin','pastor','office','finance','leader','member')),
  member_id  uuid,  -- FK added after members table exists
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

-- =============================================================
-- 2. members (성도 기본 정보)
-- =============================================================
CREATE TABLE public.members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text,
  email      text,
  birth_date date,
  address    text,
  photo_url  text,
  join_date  date DEFAULT current_date,
  status     text DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes      text,
  created_at timestamptz DEFAULT now()
);

-- Now add the FK from profiles -> members
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_member_id_fkey
  FOREIGN KEY (member_id) REFERENCES public.members(id);

-- =============================================================
-- 3. pastures (목장 정보)
-- =============================================================
CREATE TABLE public.pastures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  leader_id   uuid REFERENCES public.members(id),
  description text,
  created_at  timestamptz DEFAULT now()
);

-- =============================================================
-- 4. pasture_members (목장 배정)
-- =============================================================
CREATE TABLE public.pasture_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pasture_id  uuid NOT NULL REFERENCES public.pastures(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  role        text DEFAULT 'member' CHECK (role IN ('leader','member')),
  assigned_at timestamptz DEFAULT now(),
  UNIQUE (pasture_id, member_id)
);

-- =============================================================
-- 5. offerings (헌금 기록)
-- =============================================================
CREATE TABLE public.offerings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid REFERENCES public.members(id),
  date       date NOT NULL,
  type       text NOT NULL CHECK (type IN ('십일조','감사','주일','건축','기타')),
  amount     bigint NOT NULL DEFAULT 0,
  note       text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- =============================================================
-- 6. expense_requests (재정 청구)
-- =============================================================
CREATE TABLE public.expense_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid REFERENCES auth.users(id),
  amount       bigint NOT NULL,
  purpose      text NOT NULL,
  receipt_url  text,
  status       text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approver_id  uuid REFERENCES auth.users(id),
  approved_at  timestamptz,
  comment      text,
  created_at   timestamptz DEFAULT now()
);

-- =============================================================
-- 7. facility_bookings (시설 예약)
-- =============================================================
CREATE TABLE public.facility_bookings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid REFERENCES auth.users(id),
  facility_name text NOT NULL,
  date          date NOT NULL,
  time_start    time NOT NULL,
  time_end      time NOT NULL,
  purpose       text,
  status        text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by   uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

-- =============================================================
-- 8. vehicle_bookings (차량 예약)
-- =============================================================
CREATE TABLE public.vehicle_bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid REFERENCES auth.users(id),
  vehicle_name text NOT NULL,
  date         date NOT NULL,
  time_start   time NOT NULL,
  time_end     time NOT NULL,
  destination  text,
  passengers   int DEFAULT 1,
  purpose      text,
  status       text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by  uuid REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now()
);

-- =============================================================
-- 9. life_studies (삶공부 과정)
-- =============================================================
CREATE TABLE public.life_studies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  semester     text,
  period_start date,
  period_end   date,
  description  text,
  created_at   timestamptz DEFAULT now()
);

-- =============================================================
-- 10. life_study_enrollments (삶공부 수강)
-- =============================================================
CREATE TABLE public.life_study_enrollments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id         uuid NOT NULL REFERENCES public.life_studies(id) ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  attendance_count int DEFAULT 0,
  completed        boolean DEFAULT false,
  notes            text,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (study_id, member_id)
);

-- =============================================================
-- 11. schedules (목장 일정)
-- =============================================================
CREATE TABLE public.schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pasture_id  uuid NOT NULL REFERENCES public.pastures(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  date        date NOT NULL,
  time        time,
  location    text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now()
);

-- =============================================================
-- 12. schedule_responses (참석 응답)
-- =============================================================
CREATE TABLE public.schedule_responses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id  uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  response     text NOT NULL CHECK (response IN ('attend','absent','undecided')),
  responded_at timestamptz DEFAULT now(),
  UNIQUE (schedule_id, member_id)
);

-- =============================================================
-- 13. bulletins (주보)
-- =============================================================
CREATE TABLE public.bulletins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  content     text,
  sunday_date date NOT NULL,
  pdf_url     text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now()
);

-- =============================================================
-- 14. announcements (공지)
-- =============================================================
CREATE TABLE public.announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  content    text,
  category   text DEFAULT 'general',
  start_date date,
  end_date   date,
  is_pinned  boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- =============================================================
-- 15. church_events (행사)
-- =============================================================
CREATE TABLE public.church_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  event_date  date NOT NULL,
  event_time  time,
  location    text,
  category    text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now()
);

-- ---------------------
-- Helper functions (created after tables exist)
-- ---------------------

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_pasture_member(p_pasture_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pasture_members pm
    JOIN public.profiles p ON p.member_id = pm.member_id
    WHERE pm.pasture_id = p_pasture_id
      AND p.id = auth.uid()
  );
$$;

-- =============================================================
-- INDEXES
-- =============================================================

-- members
CREATE INDEX idx_members_name       ON public.members (name);
CREATE INDEX idx_members_status     ON public.members (status);
CREATE INDEX idx_members_birth_date ON public.members (birth_date);
CREATE INDEX idx_members_join_date  ON public.members (join_date);

-- profiles
CREATE INDEX idx_profiles_role      ON public.profiles (role);
CREATE INDEX idx_profiles_member_id ON public.profiles (member_id);

-- pastures
CREATE INDEX idx_pastures_leader_id ON public.pastures (leader_id);

-- pasture_members
CREATE INDEX idx_pasture_members_pasture_id ON public.pasture_members (pasture_id);
CREATE INDEX idx_pasture_members_member_id  ON public.pasture_members (member_id);

-- offerings
CREATE INDEX idx_offerings_member_id ON public.offerings (member_id);
CREATE INDEX idx_offerings_date      ON public.offerings (date);
CREATE INDEX idx_offerings_type      ON public.offerings (type);
CREATE INDEX idx_offerings_created_by ON public.offerings (created_by);

-- expense_requests
CREATE INDEX idx_expense_requests_requester_id ON public.expense_requests (requester_id);
CREATE INDEX idx_expense_requests_status       ON public.expense_requests (status);
CREATE INDEX idx_expense_requests_approver_id  ON public.expense_requests (approver_id);

-- facility_bookings
CREATE INDEX idx_facility_bookings_requester_id ON public.facility_bookings (requester_id);
CREATE INDEX idx_facility_bookings_date         ON public.facility_bookings (date);
CREATE INDEX idx_facility_bookings_status       ON public.facility_bookings (status);

-- vehicle_bookings
CREATE INDEX idx_vehicle_bookings_requester_id ON public.vehicle_bookings (requester_id);
CREATE INDEX idx_vehicle_bookings_date         ON public.vehicle_bookings (date);
CREATE INDEX idx_vehicle_bookings_status       ON public.vehicle_bookings (status);

-- life_studies
CREATE INDEX idx_life_studies_semester ON public.life_studies (semester);

-- life_study_enrollments
CREATE INDEX idx_life_study_enrollments_study_id  ON public.life_study_enrollments (study_id);
CREATE INDEX idx_life_study_enrollments_member_id ON public.life_study_enrollments (member_id);

-- schedules
CREATE INDEX idx_schedules_pasture_id ON public.schedules (pasture_id);
CREATE INDEX idx_schedules_date       ON public.schedules (date);
CREATE INDEX idx_schedules_created_by ON public.schedules (created_by);

-- schedule_responses
CREATE INDEX idx_schedule_responses_schedule_id ON public.schedule_responses (schedule_id);
CREATE INDEX idx_schedule_responses_member_id   ON public.schedule_responses (member_id);

-- bulletins
CREATE INDEX idx_bulletins_sunday_date ON public.bulletins (sunday_date);

-- announcements
CREATE INDEX idx_announcements_category   ON public.announcements (category);
CREATE INDEX idx_announcements_start_date ON public.announcements (start_date);
CREATE INDEX idx_announcements_is_pinned  ON public.announcements (is_pinned);

-- church_events
CREATE INDEX idx_church_events_event_date ON public.church_events (event_date);
CREATE INDEX idx_church_events_category   ON public.church_events (category);

-- =============================================================
-- ENABLE ROW LEVEL SECURITY
-- =============================================================

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastures              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pasture_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offerings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_bookings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_bookings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.life_studies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.life_study_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_responses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletins             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_events         ENABLE ROW LEVEL SECURITY;

-- =============================================================
-- RLS POLICIES
-- =============================================================

-- -----------------------------------------------
-- profiles
-- -----------------------------------------------
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "profiles_select_admin_pastor"
  ON public.profiles FOR SELECT
  USING (public.get_user_role() IN ('admin','pastor'));

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- -----------------------------------------------
-- members
-- -----------------------------------------------
CREATE POLICY "members_select_authenticated"
  ON public.members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "members_insert_admin_office"
  ON public.members FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "members_update_admin_office"
  ON public.members FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'))
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "members_delete_admin"
  ON public.members FOR DELETE
  TO authenticated
  USING (public.get_user_role() = 'admin');

-- -----------------------------------------------
-- pastures
-- -----------------------------------------------
CREATE POLICY "pastures_select_authenticated"
  ON public.pastures FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "pastures_insert_admin_office"
  ON public.pastures FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "pastures_update_admin_office"
  ON public.pastures FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'))
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "pastures_delete_admin_office"
  ON public.pastures FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'));

-- -----------------------------------------------
-- pasture_members
-- -----------------------------------------------
CREATE POLICY "pasture_members_select_authenticated"
  ON public.pasture_members FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "pasture_members_insert_admin_office"
  ON public.pasture_members FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "pasture_members_update_admin_office"
  ON public.pasture_members FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'))
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "pasture_members_delete_admin_office"
  ON public.pasture_members FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'));

-- -----------------------------------------------
-- offerings
-- -----------------------------------------------
CREATE POLICY "offerings_select_finance_admin"
  ON public.offerings FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('finance','admin'));

CREATE POLICY "offerings_insert_finance"
  ON public.offerings FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('finance','admin'));

CREATE POLICY "offerings_update_finance"
  ON public.offerings FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('finance','admin'))
  WITH CHECK (public.get_user_role() IN ('finance','admin'));

CREATE POLICY "offerings_delete_admin"
  ON public.offerings FOR DELETE
  TO authenticated
  USING (public.get_user_role() = 'admin');

-- -----------------------------------------------
-- expense_requests
-- -----------------------------------------------
CREATE POLICY "expense_requests_select_own"
  ON public.expense_requests FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid());

CREATE POLICY "expense_requests_select_finance_admin"
  ON public.expense_requests FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('finance','admin'));

CREATE POLICY "expense_requests_insert_authenticated"
  ON public.expense_requests FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "expense_requests_update_finance_admin"
  ON public.expense_requests FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('finance','admin'))
  WITH CHECK (public.get_user_role() IN ('finance','admin'));

CREATE POLICY "expense_requests_update_own_pending"
  ON public.expense_requests FOR UPDATE
  TO authenticated
  USING (requester_id = auth.uid() AND status = 'pending')
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "expense_requests_delete_admin"
  ON public.expense_requests FOR DELETE
  TO authenticated
  USING (public.get_user_role() = 'admin');

-- -----------------------------------------------
-- facility_bookings
-- -----------------------------------------------
CREATE POLICY "facility_bookings_select_own"
  ON public.facility_bookings FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid());

CREATE POLICY "facility_bookings_select_office_admin"
  ON public.facility_bookings FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('office','admin'));

CREATE POLICY "facility_bookings_insert_authenticated"
  ON public.facility_bookings FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "facility_bookings_update_office_admin"
  ON public.facility_bookings FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('office','admin'))
  WITH CHECK (public.get_user_role() IN ('office','admin'));

CREATE POLICY "facility_bookings_delete_office_admin"
  ON public.facility_bookings FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('office','admin'));

-- -----------------------------------------------
-- vehicle_bookings
-- -----------------------------------------------
CREATE POLICY "vehicle_bookings_select_own"
  ON public.vehicle_bookings FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid());

CREATE POLICY "vehicle_bookings_select_office_admin"
  ON public.vehicle_bookings FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('office','admin'));

CREATE POLICY "vehicle_bookings_insert_authenticated"
  ON public.vehicle_bookings FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "vehicle_bookings_update_office_admin"
  ON public.vehicle_bookings FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('office','admin'))
  WITH CHECK (public.get_user_role() IN ('office','admin'));

CREATE POLICY "vehicle_bookings_delete_office_admin"
  ON public.vehicle_bookings FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('office','admin'));

-- -----------------------------------------------
-- life_studies
-- -----------------------------------------------
CREATE POLICY "life_studies_select_authenticated"
  ON public.life_studies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "life_studies_insert_admin_office"
  ON public.life_studies FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "life_studies_update_admin_office"
  ON public.life_studies FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'))
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "life_studies_delete_admin_office"
  ON public.life_studies FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'));

-- -----------------------------------------------
-- life_study_enrollments
-- -----------------------------------------------
CREATE POLICY "life_study_enrollments_select_authenticated"
  ON public.life_study_enrollments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "life_study_enrollments_insert_admin_office"
  ON public.life_study_enrollments FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "life_study_enrollments_update_admin_office"
  ON public.life_study_enrollments FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'))
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "life_study_enrollments_delete_admin_office"
  ON public.life_study_enrollments FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'));

-- -----------------------------------------------
-- schedules
-- -----------------------------------------------
CREATE POLICY "schedules_select_pasture_member"
  ON public.schedules FOR SELECT
  TO authenticated
  USING (public.is_pasture_member(pasture_id));

CREATE POLICY "schedules_select_admin_pastor"
  ON public.schedules FOR SELECT
  TO authenticated
  USING (public.get_user_role() IN ('admin','pastor','office'));

CREATE POLICY "schedules_insert_pasture_member"
  ON public.schedules FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_pasture_member(pasture_id)
    OR public.get_user_role() IN ('admin','pastor','office')
  );

CREATE POLICY "schedules_update_pasture_member"
  ON public.schedules FOR UPDATE
  TO authenticated
  USING (
    public.is_pasture_member(pasture_id)
    OR public.get_user_role() IN ('admin','pastor','office')
  )
  WITH CHECK (
    public.is_pasture_member(pasture_id)
    OR public.get_user_role() IN ('admin','pastor','office')
  );

CREATE POLICY "schedules_delete_admin"
  ON public.schedules FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin','pastor','office'));

-- -----------------------------------------------
-- schedule_responses
-- -----------------------------------------------
CREATE POLICY "schedule_responses_select_pasture"
  ON public.schedule_responses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.id = schedule_id
        AND (public.is_pasture_member(s.pasture_id)
             OR public.get_user_role() IN ('admin','pastor','office'))
    )
  );

CREATE POLICY "schedule_responses_insert_own"
  ON public.schedule_responses FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.member_id = member_id
    )
    AND EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.id = schedule_id
        AND public.is_pasture_member(s.pasture_id)
    )
  );

CREATE POLICY "schedule_responses_update_own"
  ON public.schedule_responses FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.member_id = schedule_responses.member_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.member_id = schedule_responses.member_id
    )
  );

-- -----------------------------------------------
-- bulletins
-- -----------------------------------------------
CREATE POLICY "bulletins_select_authenticated"
  ON public.bulletins FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "bulletins_insert_admin_office"
  ON public.bulletins FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "bulletins_update_admin_office"
  ON public.bulletins FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'))
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "bulletins_delete_admin_office"
  ON public.bulletins FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'));

-- -----------------------------------------------
-- announcements
-- -----------------------------------------------
CREATE POLICY "announcements_select_authenticated"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "announcements_insert_admin_office"
  ON public.announcements FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "announcements_update_admin_office"
  ON public.announcements FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'))
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "announcements_delete_admin_office"
  ON public.announcements FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'));

-- -----------------------------------------------
-- church_events
-- -----------------------------------------------
CREATE POLICY "church_events_select_authenticated"
  ON public.church_events FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "church_events_insert_admin_office"
  ON public.church_events FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "church_events_update_admin_office"
  ON public.church_events FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'))
  WITH CHECK (public.get_user_role() IN ('admin','office'));

CREATE POLICY "church_events_delete_admin_office"
  ON public.church_events FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('admin','office'));
