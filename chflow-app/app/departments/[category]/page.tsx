"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { T, PageShell, PageContent } from "@/components/Layout";

interface Department {
  id: string;
  category: string;
  name: string;
  description: string | null;
  icon: string | null;
  order_no: number;
  member_count: number;
  my_status: string | null;
}

export default function CategoryPage() {
  const router = useRouter();
  const params = useParams();
  const category = decodeURIComponent(params.category as string);

  const [authChecked, setAuthChecked] = useState(false);
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDept, setConfirmDept] = useState<Department | null>(null);
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_departments_by_category", { p_category: category });
    if (!error) setDepts(data || []);
    setLoading(false);
  }, [category]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      load();
    })();
  }, [load, router]);

  const handleRequest = async () => {
    if (!confirmDept) return;
    setRequesting(true);
    const { error } = await supabase.rpc("request_department_join", { p_dept_id: confirmDept.id });
    setRequesting(false);
    if (error) {
      alert(`신청 실패: ${error.message}`);
      return;
    }
    setConfirmDept(null);
    alert("✅ 가입 신청이 완료되었습니다!\n관리자 승인 후 이용하실 수 있습니다.");
    load();
  };

  const statusBadge = (status: string | null) => {
    if (status === "approved") return { label: "✓ 가입됨", bg: "#dcfce7", color: "#15803d" };
    if (status === "pending") return { label: "⏳ 승인 대기", bg: "#fef3c7", color: "#92400e" };
    if (status === "rejected") return { label: "거절됨", bg: "#fee2e2", color: "#b91c1c" };
    return null;
  };

  if (!authChecked) {
    return (
      <PageShell style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 13, color: T.textMuted }}>로딩 중...</div>
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
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{category}</div>
          <div style={{ fontSize: 10, color: T.textMuted }}>가입할 부서를 선택하세요</div>
        </div>
        <button onClick={() => router.push("/departments")} style={{
          padding: "7px 14px", background: T.bgPage, border: `1px solid ${T.border}`,
          borderRadius: 8, fontSize: 12, color: T.textMuted, cursor: "pointer", fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}>← 뒤로</button>
      </div>

      <PageContent maxWidth={860}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: T.textMuted }}>로딩 중...</div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
          }}>
            {depts.map((d) => {
              const badge = statusBadge(d.my_status);
              const disabled = d.my_status === "approved" || d.my_status === "pending";
              const borderColor =
                d.my_status === "approved" ? "#4ade80"
                : d.my_status === "pending" ? "#fbbf24"
                : T.border;
              return (
                <div
                  key={d.id}
                  onClick={() => !disabled && setConfirmDept(d)}
                  style={{
                    background: T.bgCard,
                    border: `1.5px solid ${borderColor}`,
                    borderRadius: 16,
                    padding: "20px 18px",
                    cursor: disabled ? "default" : "pointer",
                    position: "relative",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                    transition: "box-shadow 0.15s, transform 0.15s",
                  }}
                  onMouseOver={(e) => {
                    if (disabled) return;
                    e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.1)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseOut={(e) => {
                    if (disabled) return;
                    e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  {badge && (
                    <div style={{
                      position: "absolute", top: 12, right: 12,
                      padding: "3px 10px",
                      background: badge.bg, color: badge.color,
                      borderRadius: 6, fontSize: 10, fontWeight: 700,
                    }}>{badge.label}</div>
                  )}
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: T.ministryBg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 26, marginBottom: 12,
                  }}>
                    {d.icon || "📁"}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.text, marginBottom: 4 }}>{d.name}</div>
                  {d.description && (
                    <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.5, marginBottom: 6 }}>{d.description}</div>
                  )}
                  <div style={{ fontSize: 11, color: T.ministryPoint, fontWeight: 600, marginTop: 4 }}>
                    👥 {d.member_count}명 활동 중
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageContent>

      {/* === 가입 확인 모달 === */}
      {confirmDept && (
        <div onClick={() => !requesting && setConfirmDept(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: T.bgCard,
            borderRadius: 20,
            padding: "28px 24px",
            maxWidth: 380,
            width: "100%",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            textAlign: "center",
            fontFamily: "'Noto Sans KR', sans-serif",
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: T.ministryBg,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 36, margin: "0 auto 16px",
            }}>{confirmDept.icon || "🏢"}</div>
            <div style={{ fontSize: 11, color: T.ministryPoint, fontWeight: 700, marginBottom: 4 }}>{confirmDept.category}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: T.text, marginBottom: 6 }}>{confirmDept.name}</div>
            {confirmDept.description && (
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16, lineHeight: 1.5 }}>{confirmDept.description}</div>
            )}
            <div style={{
              padding: "14px 16px",
              background: T.ministryBg,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              fontSize: 13, color: T.ministryPoint,
              marginBottom: 16, fontWeight: 700,
            }}>
              가입 신청 하시겠습니까?
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 20, lineHeight: 1.6 }}>
              신청 후 관리자 승인이 필요합니다.<br />
              승인되면 알림을 받으실 수 있습니다.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmDept(null)}
                disabled={requesting}
                style={{
                  flex: 1, padding: "12px",
                  background: T.bgPage, color: T.textMuted,
                  border: `1px solid ${T.border}`, borderRadius: 10,
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >취소</button>
              <button
                onClick={handleRequest}
                disabled={requesting}
                style={{
                  flex: 1, padding: "12px",
                  background: T.ministryPoint, color: "#fff",
                  border: "none", borderRadius: 10,
                  fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  boxShadow: `0 4px 12px rgba(62,90,74,0.3)`,
                }}
              >{requesting ? "신청 중..." : "신청"}</button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
