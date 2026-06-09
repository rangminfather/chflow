"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import NotificationBell from "@/components/NotificationBell";
import { supabase } from "@/lib/supabase";

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/signup",
  "/find-id",
  "/find-password",
  "/reset-password",
  "/install",
];

export default function GlobalNotifications() {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);
  const hidden = useMemo(
    () => HIDDEN_PATH_PREFIXES.some((prefix) => pathname?.startsWith(prefix)),
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
      <NotificationBell userId={userId} placement="dock" />
    </div>
  );
}
