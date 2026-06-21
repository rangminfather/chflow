"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import NotificationBell from "@/components/NotificationBell";
import FontScaleControl from "@/components/FontScaleControl";
import { supabase } from "@/lib/supabase";

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/find-id",
  "/find-password",
  "/reset-password",
  "/install",
  "/messenger",
  "/admin/messenger-reports",
];

export default function GlobalNotifications() {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const hidden = useMemo(
    () =>
      HIDDEN_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix)) ||
      // 주보 보기 화면(메인/부서)에서는 종 숨김
      !!pathname?.endsWith("/bulletin"),
    [pathname]
  );

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.session?.user.id ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (hidden || !userId) return null;

  return (
    <div className="global-notification-dock" aria-live="polite">
      <FontScaleControl />
      <NotificationBell userId={userId} placement="dock" />
    </div>
  );
}
