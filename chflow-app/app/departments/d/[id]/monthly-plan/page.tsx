"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { CalendarDays } from "lucide-react";

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

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={pageStyle}>

      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarDays size={18} strokeWidth={1.8} /> 월간 교육계획서</div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-hairline bg-white">
          <div className="border-b border-hairline px-5 py-4">
            <div className="text-[20px] font-extrabold text-ink">월간 교육계획서</div>
            <div className="mt-1 text-[15px] font-semibold text-ink-soft">
              등록된 월간 계획 파일을 선생님들이 확인하는 공간입니다.
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-center text-[16px] font-bold text-ink-faint">불러오는 중...</div>
          ) : error ? (
            <div className="px-5 py-12 text-center text-[16px] font-bold text-red-500">{error}</div>
          ) : files.length === 0 ? (
            <EmptyState message="등록된 월간 교육계획서가 없습니다" hint="월간교육등록에서 파일을 올리면 이 화면에 표시됩니다." />
          ) : (
            <div className="space-y-3 p-5">
              {files.map((file) => (
                <a
                  key={file.name}
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-hairline bg-surface p-4"
                >
                  <div className="text-[14px] font-bold text-accent">
                    {file.year && file.month ? `${file.year}년 ${file.month}월` : "월간 교육계획서"}
                  </div>
                  <div className="mt-1 text-[18px] font-extrabold text-ink">{file.originalName}</div>
                  <div className="mt-2 text-[13px] font-semibold text-ink-faint">
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

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit" };
