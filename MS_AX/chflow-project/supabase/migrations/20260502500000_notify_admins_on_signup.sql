-- =============================================================
-- 가입 신청 발생 시 admin/office/pastor 전원에게 알림 자동 발송
--   - profiles 테이블에 status='pending' 으로 INSERT 되면 발동
--   - SECURITY DEFINER 로 신청자(non-admin) 가 INSERT 트리거를 발생시켜도
--     RLS의 notif_insert_admin 정책 우회
-- =============================================================

CREATE OR REPLACE FUNCTION public.notify_admins_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link_url, metadata)
    SELECT
      p.id,
      'signup_pending',
      '🆕 새 가입 신청',
      coalesce(NEW.name, NEW.username, '신규 사용자') || ' 님이 가입을 신청했습니다.',
      '/admin/pending',
      jsonb_build_object(
        'signup_user_id', NEW.id,
        'signup_name', NEW.name,
        'signup_username', NEW.username
      )
    FROM public.profiles p
    WHERE p.role IN ('admin','office','pastor')
      AND p.status = 'active'
      AND p.id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admins_on_signup ON public.profiles;
CREATE TRIGGER trg_notify_admins_on_signup
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.notify_admins_on_signup();

-- 별도 케이스: 기존 profile 이 pending 으로 변경되는 경우 (재신청 등)
CREATE OR REPLACE FUNCTION public.notify_admins_on_signup_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link_url, metadata)
    SELECT
      p.id,
      'signup_pending',
      '🆕 가입 재신청',
      coalesce(NEW.name, NEW.username, '신규 사용자') || ' 님이 가입을 재신청했습니다.',
      '/admin/pending',
      jsonb_build_object(
        'signup_user_id', NEW.id,
        'signup_name', NEW.name,
        'signup_username', NEW.username
      )
    FROM public.profiles p
    WHERE p.role IN ('admin','office','pastor')
      AND p.status = 'active'
      AND p.id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admins_on_signup_status ON public.profiles;
CREATE TRIGGER trg_notify_admins_on_signup_status
AFTER UPDATE OF status ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.notify_admins_on_signup_status();
