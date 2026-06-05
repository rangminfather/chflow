"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

export default function NoticesPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router]);

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={titleStyle}>📢 공통</div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="text-[20px] font-extrabold text-slate-900">공통</div>
            <div className="mt-1 text-[15px] font-semibold text-slate-500">부서 공지, 교육계획서, 주보를 확인합니다.</div>
          </div>

          <div className="grid gap-3 p-5 md:grid-cols-2">
            <button
              type="button"
              onClick={() => router.push(`/departments/d/${deptId}/bulletin`)}
              className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-left"
            >
              <div className="text-[30px]">📰</div>
              <div className="mt-2 text-[18px] font-extrabold text-slate-900">주보 보기</div>
              <div className="mt-1 text-[15px] leading-6 text-slate-500">UMS 사무실 게시판의 초등1부 주보를 확인합니다.</div>
            </button>

            <button
              type="button"
              onClick={() => router.push(`/departments/d/${deptId}/monthly-plan`)}
              className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-left"
            >
              <div className="text-[30px]">🗓️</div>
              <div className="mt-2 text-[18px] font-extrabold text-slate-900">월간 교육계획서</div>
              <div className="mt-1 text-[15px] leading-6 text-slate-500">등록된 월간 계획 파일을 조회합니다.</div>
            </button>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-[30px]">📌</div>
              <div className="mt-2 text-[18px] font-extrabold text-slate-900">일반 공지</div>
              <div className="mt-1 text-[15px] leading-6 text-slate-500">일반 공지글 작성 기능은 다음 단계에서 게시판으로 확장됩니다.</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "#1e293b" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 14, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const loadingStyle: React.CSSProperties = { ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" };
