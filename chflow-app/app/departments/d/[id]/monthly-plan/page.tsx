"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

interface PlanFile {
  name: string;
  url: string;
  year: number | null;
  month: number | null;
  originalName: string;
  created_at: string | null;
  size: number | null;
}

export default function MonthlyPlanPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<PlanFile[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
      await loadFiles(session.access_token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, deptId]);

  async function loadFiles(token: string) {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/edu/monthly-plans?dept_id=${deptId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok || !result.ok) {
      setError(result.error || "조회 실패");
      return;
    }
    setFiles(result.files || []);
  }

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  return (
    <div style={pageStyle}>

      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={titleStyle}>🗓️ 월간 교육계획서</div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="text-[20px] font-extrabold text-slate-900">월간 교육계획서</div>
            <div className="mt-1 text-[15px] font-semibold text-slate-500">
              등록된 월간 계획 파일을 선생님들이 확인하는 공간입니다.
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-center text-[16px] font-bold text-slate-400">불러오는 중...</div>
          ) : error ? (
            <div className="px-5 py-12 text-center text-[16px] font-bold text-red-500">{error}</div>
          ) : files.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="text-[48px]">📭</div>
              <div className="mt-4 text-[18px] font-extrabold text-slate-800">
                등록된 월간 교육계획서가 없습니다
              </div>
              <div className="mx-auto mt-2 max-w-md text-[15px] leading-6 text-slate-500">
                월간교육등록에서 파일을 올리면 이 화면에 표시됩니다.
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-5">
              {files.map((file) => (
                <a
                  key={file.name}
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="text-[14px] font-bold text-blue-600">
                    {file.year && file.month ? `${file.year}년 ${file.month}월` : "월간 교육계획서"}
                  </div>
                  <div className="mt-1 text-[18px] font-extrabold text-slate-900">{file.originalName}</div>
                  <div className="mt-2 text-[13px] font-semibold text-slate-400">
                    눌러서 파일 열기
                  </div>
                </a>
              ))}
            </div>
          )}
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
