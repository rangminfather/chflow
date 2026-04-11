"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Category {
  category: string;
  dept_count: number;
}

const CATEGORY_ICONS: Record<string, string> = {
  교육사역국: "📚",
  예배사역국: "🎵",
  선교사역국: "🌍",
  봉사사역국: "🤝",
  재정부: "💰",
  사무국: "🏢",
};

export default function DepartmentsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

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
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_department_categories");
    if (!error) setCategories(data || []);
    setLoading(false);
  };

  if (!authChecked) {
    return <div style={loadingStyle}>로딩 중...</div>;
  }

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        {/* Header */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>사역·부서 가입</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>관심 있는 사역에 가입 신청하세요</div>
          </div>
          <button onClick={() => router.push("/home")} style={backBtnStyle}>← 홈</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#1e293b" }}>사역국 / 부서</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            대분류를 선택하면 세부 부서가 표시됩니다
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>로딩 중...</div>
        ) : categories.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
            등록된 사역이 없습니다
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            {categories.map((cat) => (
              <div
                key={cat.category}
                onClick={() => router.push(`/departments/${encodeURIComponent(cat.category)}`)}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: "24px 20px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  transition: "all 0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = "#6366f1";
                  e.currentTarget.style.transform = "translateY(-3px)";
                  e.currentTarget.style.boxShadow = "0 12px 24px rgba(99, 102, 241, 0.15)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = "#e2e8f0";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
                }}
              >
                <div style={{
                  width: 60,
                  height: 60,
                  borderRadius: 14,
                  background: "linear-gradient(135deg, #eef2ff, #ede9fe)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 30,
                }}>
                  {CATEGORY_ICONS[cat.category] || "📁"}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>{cat.category}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{cat.dept_count}개 부서</div>
                </div>
                <div style={{ fontSize: 16, color: "#cbd5e1" }}>›</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const loadingStyle: React.CSSProperties = {
  ...pageStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "#475569",
  cursor: "pointer",
  fontFamily: "inherit",
};
