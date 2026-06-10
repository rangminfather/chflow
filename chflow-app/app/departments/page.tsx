"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { T, PageShell, PageContent } from "@/components/Layout";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { BookOpen, Music, Globe, Handshake, Coins, Building2, Folder } from "lucide-react";

interface Category {
  category: string;
  dept_count: number;
}

const CATEGORY_ICONS: Record<string, ReactNode> = {
  교육사역국: <BookOpen size={26} strokeWidth={1.8} />,
  예배사역국: <Music size={26} strokeWidth={1.8} />,
  선교사역국: <Globe size={26} strokeWidth={1.8} />,
  봉사사역국: <Handshake size={26} strokeWidth={1.8} />,
  재정부: <Coins size={26} strokeWidth={1.8} />,
  사무국: <Building2 size={26} strokeWidth={1.8} />,
};

const CATEGORY_COLORS: Record<string, { bg: string; point: string }> = {
  교육사역국: { bg: "rgba(234,239,232,0.72)", point: "#3E5A4A" },
  예배사역국: { bg: "rgba(234,241,255,0.72)", point: "var(--accent)" },
  선교사역국: { bg: "rgba(240,253,244,0.72)", point: "var(--success)" },
  봉사사역국: { bg: "rgba(255,247,237,0.72)", point: "#9C6230" },
  재정부:     { bg: "rgba(254,252,232,0.72)", point: "var(--warning)" },
  사무국:     { bg: "rgba(240, 235, 223,0.72)", point: "var(--ink-mid)" },
};

export default function DepartmentsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_department_categories");
    if (!error) setCategories(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: prof } = await supabase.rpc("get_my_status");
      if (!prof?.[0] || prof[0].status !== "active") {
        await supabase.auth.signOut();
        router.replace("/login?notice=pending");
        return;
      }
      setAuthChecked(true);
      load();
    })();
  }, [load, router]);

  if (!authChecked) {
    return (
      <PageShell style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <LoadingView />
      </PageShell>
    );
  }

  return (
    <PageShell>
      {/* 헤더 */}
      <div style={{
        background: T.bgCard,
        borderBottom: `1px solid ${T.border}`,
        padding: "10px clamp(12px, 4vw, 20px)",
        display: "flex", alignItems: "center", gap: 10,
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <HeaderLogo />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>사역·부서 가입</div>
          <div style={{ fontSize: 10, color: T.textMuted }}>관심 있는 사역에 가입 신청하세요</div>
        </div>
        <button onClick={() => router.push("/home")} style={{
          padding: "7px 14px", background: T.bgPage, border: `1px solid ${T.border}`,
          borderRadius: 8, fontSize: 12, color: T.textMuted, cursor: "pointer", fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}>← 홈</button>
      </div>

      <PageContent maxWidth={860}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>사역국 · 부서</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>
            대분류를 선택하면 세부 부서가 표시됩니다
          </div>
        </div>

        {loading ? (
          <LoadingView padding={40} />
        ) : categories.length === 0 ? (
          <EmptyState message="등록된 사역이 없습니다" />
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}>
            {categories.map((cat) => {
              const color = CATEGORY_COLORS[cat.category] ?? { bg: T.ministryBg, point: T.ministryPoint };
              return (
                <div
                  key={cat.category}
                  onClick={() => router.push(`/departments/${encodeURIComponent(cat.category)}`)}
                  style={{
                    background: T.bgCard,
                    border: `1px solid ${T.border}`,
                    borderRadius: 16,
                    padding: "20px 18px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                    transition: "box-shadow 0.15s, transform 0.15s",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.boxShadow = `0 6px 20px rgba(0,0,0,0.1)`;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <div style={{
                    width: 52, height: 52, borderRadius: 13,
                    background: color.bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 26, flexShrink: 0, color: color.point,
                  }}>
                    {CATEGORY_ICONS[cat.category] || <Folder size={26} strokeWidth={1.8} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{cat.category}</div>
                    <div style={{ fontSize: 11, color: color.point, marginTop: 2, fontWeight: 600 }}>
                      {cat.dept_count}개 부서
                    </div>
                  </div>
                  <div style={{ fontSize: 16, color: T.border }}>›</div>
                </div>
              );
            })}
          </div>
        )}
      </PageContent>
    </PageShell>
  );
}
