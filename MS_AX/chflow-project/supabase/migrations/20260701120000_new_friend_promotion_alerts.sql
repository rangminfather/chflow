-- =============================================================
-- 새친구 등반 알림 자동화 + 장기결석 상태 + 등반예정 사전알림
--
-- 배경/용어:
--   - 학생관리 '구분'(정/체험/소) 선택 UI 제거. 내부 student_type 은 유지하되
--     의미를 다음과 같이 이해한다: '체험' = 등반전(비회원), '정' = 등반(정회원).
--   - 등반 임계치 = '출' 4회 (기존 정책 동일, 타교회 '인' 제외).
--
-- 변경 요약:
--   1) edu_students.mgmt_status('정상'|'장기결석') 신설 — 장기결석이면 알림/프롬프트 억제.
--   2) 알림 dedup용 부분 유니크 인덱스 + 알림 발신 헬퍼(_emit_promo_notif, 멱등).
--   3) edu_confirm_promotion 확장 — 등반 확정 시 담임+임원(grade<=2)에게 '등반완료' 알림.
--   4) edu_promotion_board(dept) — 출석부 프롬프트용(ready: '출'>=4 / upcoming: '출'==3, 정상·미등반).
--   5) edu_new_friend_flags(dept) — 출석부 등반전/등반 뱃지용.
--   6) edu_emit_promotion_upcoming(slot, week) — 주말 등반예정 푸시(토09·토17·일09 KST),
--      신규 새친구당 최대 2주말까지만 푸시(이후는 출석부 앱 배너로만). cron 이 service_role 로 호출.
--   ※ 인도자(학생) +5 자동적립은 기존 get_student_auto_talent 그대로(변경 없음).
--
--   적용: npx supabase db query --linked --file supabase\migrations\20260701120000_new_friend_promotion_alerts.sql
-- =============================================================


-- ─────────────────────────────────────────
-- 1. 장기결석 상태 컬럼
-- ─────────────────────────────────────────
ALTER TABLE public.edu_students
  ADD COLUMN IF NOT EXISTS mgmt_status text NOT NULL DEFAULT '정상'
    CHECK (mgmt_status IN ('정상','장기결석'));


-- ─────────────────────────────────────────
-- 2. 알림 dedup (metadata.dedup_key) + 발신 헬퍼
--    message_new 알림은 dedup_key 를 쓰지 않으므로 충돌 없음.
-- ─────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedup_key
  ON public.notifications (user_id, ((metadata->>'dedup_key')))
  WHERE metadata ? 'dedup_key';

CREATE OR REPLACE FUNCTION public._emit_promo_notif(
  p_user_id uuid,
  p_type    text,
  p_title   text,
  p_body    text,
  p_link    text,
  p_dedup   text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, body, link_url, metadata, created_by)
    VALUES (p_user_id, p_type, p_title, p_body, p_link,
            jsonb_build_object('dedup_key', p_dedup), NULL);
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- 이미 보낸 알림 → 무시(멱등)
  END;
END;
$$;
GRANT EXECUTE ON FUNCTION public._emit_promo_notif(uuid, text, text, text, text, text) TO authenticated, service_role;


-- ─────────────────────────────────────────
-- 3. 등반 확정(멱등) + 등반완료 알림(담임 + 임원 grade<=2)
--    +5 적립은 기존 get_student_auto_talent 자동집계가 담당.
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_confirm_promotion(uuid);
CREATE OR REPLACE FUNCTION public.edu_confirm_promotion(p_new_friend_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dept         uuid;
  v_student      uuid;
  v_promoted     boolean;
  v_name         text;
  v_teacher_user uuid;
  v_link         text;
  v_dedup        text;
  v_body         text;
  r              record;
BEGIN
  SELECT f.department_id, f.student_id, f.promoted, s.name
    INTO v_dept, v_student, v_promoted, v_name
  FROM public.edu_new_friends f
  LEFT JOIN public.edu_students s ON s.id = f.student_id
  WHERE f.id = p_new_friend_id;

  IF v_dept IS NULL THEN RAISE EXCEPTION '새친구를 찾을 수 없습니다'; END IF;
  IF NOT public.is_edu_member_or_admin(v_dept) THEN RAISE EXCEPTION '권한이 없습니다'; END IF;
  IF v_student IS NULL THEN RAISE EXCEPTION '편입된 학생이 없습니다'; END IF;
  IF v_promoted THEN RETURN; END IF;   -- 멱등

  -- 체험(등반전) → 정(등반)
  UPDATE public.edu_students SET student_type = '정'
   WHERE id = v_student AND department_id = v_dept;

  UPDATE public.edu_new_friends
     SET promoted = true, promoted_at = now(), promoted_by = auth.uid()
   WHERE id = p_new_friend_id;

  -- 등반완료 알림 (멱등: 새친구당 1회/수신자)
  v_link  := '/departments/d/' || v_dept::text || '/attendance';
  v_dedup := 'promo_done:' || p_new_friend_id::text;
  v_body  := COALESCE(v_name, '새친구') || ' 학생이 4주 등반하였습니다.';

  SELECT t.user_id INTO v_teacher_user
  FROM public.edu_students s
  JOIN public.edu_teachers t ON t.id = s.teacher_id
  WHERE s.id = v_student;

  IF v_teacher_user IS NOT NULL THEN
    PERFORM public._emit_promo_notif(v_teacher_user, 'edu_promotion_done', '🎖️ 새친구 등반', v_body, v_link, v_dedup);
  END IF;

  FOR r IN
    SELECT dm.user_id
    FROM public.department_members dm
    WHERE dm.department_id = v_dept
      AND dm.status = 'approved'
      AND dm.grade <= 2
      AND dm.user_id IS NOT NULL
  LOOP
    PERFORM public._emit_promo_notif(r.user_id, 'edu_promotion_done', '🎖️ 새친구 등반', v_body, v_link, v_dedup);
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_confirm_promotion(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 4. 출석부 프롬프트용 보드 — ready('출'>=4) / upcoming('출'==3), 정상·미등반만
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_promotion_board(uuid);
CREATE OR REPLACE FUNCTION public.edu_promotion_board(p_dept_id uuid)
RETURNS TABLE (
  new_friend_id      uuid,
  student_id         uuid,
  name               text,
  class_no           text,
  grade_year         smallint,
  teacher_id         uuid,
  attend_count       int,
  state              text,
  guide_kind         text,
  guide_student_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    f.id, f.student_id, s.name, s.class_no, s.grade_year, s.teacher_id,
    cnt.c::int,
    CASE WHEN cnt.c >= 4 THEN 'ready' ELSE 'upcoming' END,
    f.guide_kind, gs.name
  FROM public.edu_new_friends f
  JOIN public.edu_students s ON s.id = f.student_id AND s.is_active = true
  LEFT JOIN public.edu_students gs ON gs.id = f.guide_student_id
  JOIN LATERAL (
    SELECT COUNT(*) AS c
    FROM public.edu_student_attendance a
    WHERE a.student_id = f.student_id AND a.attend_status = '출'
  ) cnt ON true
  WHERE f.department_id = p_dept_id
    AND f.promoted = false
    AND s.mgmt_status = '정상'
    AND cnt.c >= 3
    AND public.is_edu_member_or_admin(p_dept_id)
  ORDER BY cnt.c DESC, s.name;
$$;
GRANT EXECUTE ON FUNCTION public.edu_promotion_board(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 5. 출석부 등반전/등반 뱃지용 플래그
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.edu_new_friend_flags(uuid);
CREATE OR REPLACE FUNCTION public.edu_new_friend_flags(p_dept_id uuid)
RETURNS TABLE (student_id uuid, promoted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.student_id, f.promoted
  FROM public.edu_new_friends f
  WHERE f.department_id = p_dept_id
    AND f.student_id IS NOT NULL
    AND public.is_edu_member_or_admin(p_dept_id);
$$;
GRANT EXECUTE ON FUNCTION public.edu_new_friend_flags(uuid) TO authenticated;


-- ─────────────────────────────────────────
-- 6. 등반예정 사전알림 (주말 푸시) — 신규 새친구당 최대 2주말
--    cron 이 service_role 로 slot('sat_am'|'sat_pm'|'sun_am')과 week(해당 주 토요일 KST 날짜) 전달.
-- ─────────────────────────────────────────
ALTER TABLE public.edu_new_friends
  ADD COLUMN IF NOT EXISTS upcoming_push_weeks smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_upcoming_week  date;

CREATE OR REPLACE FUNCTION public.edu_emit_promotion_upcoming(p_slot text, p_week date)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f              record;
  r              record;
  v_cnt          int;
  v_active       boolean;
  v_teacher_user uuid;
  v_link         text;
  v_dedup        text;
  v_body         text;
  v_sent         int := 0;
BEGIN
  FOR f IN
    SELECT nf.id, nf.department_id, nf.student_id, s.name, s.teacher_id,
           nf.upcoming_push_weeks, nf.last_upcoming_week
    FROM public.edu_new_friends nf
    JOIN public.edu_students s ON s.id = nf.student_id AND s.is_active = true
    WHERE nf.promoted = false
      AND s.mgmt_status = '정상'
  LOOP
    SELECT COUNT(*) INTO v_cnt
    FROM public.edu_student_attendance a
    WHERE a.student_id = f.student_id AND a.attend_status = '출';
    IF v_cnt <> 3 THEN CONTINUE; END IF;   -- 4회 임박(정확히 3회)만

    -- 주말 활성화/예산(2주말) 처리
    v_active := (f.last_upcoming_week IS NOT DISTINCT FROM p_week);
    IF NOT v_active THEN
      IF f.upcoming_push_weeks < 2 THEN
        UPDATE public.edu_new_friends
           SET last_upcoming_week = p_week,
               upcoming_push_weeks = upcoming_push_weeks + 1
         WHERE id = f.id;
        v_active := true;
      END IF;
    END IF;
    IF NOT v_active THEN CONTINUE; END IF;  -- 예산 소진 → 푸시 없음(앱 배너로만)

    v_link  := '/departments/d/' || f.department_id::text || '/attendance';
    v_dedup := 'promo_upc:' || f.id::text || ':' || to_char(p_week, 'YYYYMMDD') || ':' || p_slot;
    v_body  := COALESCE(f.name, '새친구') || ' 학생이 이번 주 4주 등반 예정입니다.';

    SELECT t.user_id INTO v_teacher_user FROM public.edu_teachers t WHERE t.id = f.teacher_id;
    IF v_teacher_user IS NOT NULL THEN
      PERFORM public._emit_promo_notif(v_teacher_user, 'edu_promotion_upcoming', '⏳ 등반 예정', v_body, v_link, v_dedup);
      v_sent := v_sent + 1;
    END IF;

    FOR r IN
      SELECT dm.user_id
      FROM public.department_members dm
      WHERE dm.department_id = f.department_id
        AND dm.status = 'approved'
        AND dm.grade <= 2
        AND dm.user_id IS NOT NULL
    LOOP
      PERFORM public._emit_promo_notif(r.user_id, 'edu_promotion_upcoming', '⏳ 등반 예정', v_body, v_link, v_dedup);
      v_sent := v_sent + 1;
    END LOOP;
  END LOOP;
  RETURN v_sent;
END;
$$;
GRANT EXECUTE ON FUNCTION public.edu_emit_promotion_upcoming(text, date) TO authenticated, service_role;
