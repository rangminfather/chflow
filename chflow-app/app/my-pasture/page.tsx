"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { T, PageShell, PageContent } from "@/components/Layout";
import { LoadingView } from "@/components/StatusViews";
import { CellShepherdSection } from "@/components/MyGroupsSections";
import {
  parseHomeMenuConfig, EMPTY_HOME_MENU_CONFIG, type HomeMenuConfig,
} from "@/lib/homeMenuConfig";
import type { UserInfo } from "@/app/home/page";

export default function MyPasturePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [menuConfig, setMenuConfig] = useState<HomeMenuConfig>(EMPTY_HOME_MENU_CONFIG);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("get_my_full_info");
      const profile = data?.[0];
      if (!profile || profile.status !== "active") {
        await supabase.auth.signOut();
        router.replace("/login?notice=pending");
        return;
      }
      setUser(profile);
      setAuthChecked(true);

      const { data: menuCfg, error: menuCfgError } = await supabase.rpc("get_home_menu_config");
      if (!menuCfgError && menuCfg) setMenuConfig(parseHomeMenuConfig(menuCfg));
    })();
  }, [router]);

  if (!authChecked || !user) {
    return (
      <PageShell style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LoadingView />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px clamp(12px, 4vw, 20px)",
        borderBottom: `1px solid ${T.border}`, background: T.bgCard,
      }}>
        <button
          onClick={() => router.back()}
          aria-label="뒤로"
          style={{
            width: 36, height: 36, borderRadius: 9, flexShrink: 0,
            border: `1px solid ${T.border}`, background: T.bgPage,
            display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}
        >
          <ChevronLeft size={19} strokeWidth={1.8} color={T.text} />
        </button>
        <div style={{ fontFamily: "var(--app-serif)", fontSize: 17, fontWeight: 700, color: T.text }}>
          목장 메뉴
        </div>
      </div>

      <PageContent maxWidth={720}>
        <CellShepherdSection
          user={user}
          router={router}
          canEditMenu={user.role === "admin"}
          menuConfig={menuConfig}
          onMenuConfigChange={setMenuConfig}
        />
      </PageContent>
    </PageShell>
  );
}
