"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { BookOpen, ExternalLink, FileText, RefreshCw } from "lucide-react";

interface ReviewFile {
  path: string;
  title: string;
  lessonNum: string;
  specialTitle: string;
  quizCount: number;
  created_at: string | null;
  size: number | null;
  url: string;
}

export default function ReviewProblemsPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<ReviewFile[]>([]);
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

  async function loadFiles(token?: string) {
    setLoading(true);
    setError("");
    const accessToken = token || (await supabase.auth.getSession()).data.session?.access_token;
    if (!accessToken) {
      router.replace("/login");
      return;
    }

    const response = await fetch(`/api/edu/review-problems?dept_id=${deptId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok || !result.ok) {
      setError(result.error || "복습문제를 불러오지 못했습니다");
      return;
    }
    setFiles(result.problems || []);
  }

  if (!authChecked) return <LoadingView full />;

  const lessonFiles = files.filter((file) => file.lessonNum);
  const specialFiles = files.filter((file) => !file.lessonNum);

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <HeaderLogo />
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}><BookOpen size={18} strokeWidth={1.8} /> 복습문제 보기</div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-hairline bg-white">
          <div className="border-b border-hairline px-5 py-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[20px] font-extrabold text-ink">복습문제 보기</div>
              <div className="mt-1 text-[14px] font-semibold text-ink-soft">
                복습문제 관리에서 등록한 PPT 파일을 확인합니다.
              </div>
            </div>
            <button
              onClick={() => loadFiles()}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-3 py-1.5 text-[13px] font-bold text-ink-mid disabled:opacity-50"
            >
              <RefreshCw size={14} strokeWidth={1.8} /> {loading ? "확인 중" : "새로고침"}
            </button>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-center text-[16px] font-bold text-ink-faint">불러오는 중...</div>
          ) : error ? (
            <div className="px-5 py-12 text-center text-[16px] font-bold text-red-500">{error}</div>
          ) : files.length === 0 ? (
            <EmptyState message="등록된 복습문제가 없습니다" hint="복습문제 관리에서 PPTX 파일을 올리면 여기에 표시됩니다." />
          ) : (
            <div className="p-5">
              <div className="mb-3 text-[13px] font-bold text-ink-soft">
                공과 {lessonFiles.length}개 · 절기/특별 {specialFiles.length}개
              </div>
              <div className="space-y-3">
                {files.map((file) => (
                  <a
                    key={file.path}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-4"
                  >
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                      <FileText size={18} strokeWidth={1.8} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {file.lessonNum && (
                          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-extrabold text-accent-strong">
                            {file.lessonNum}과
                          </span>
                        )}
                        {file.specialTitle && (
                          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-extrabold text-accent-strong">
                            특별
                          </span>
                        )}
                        <span className="truncate text-[15px] font-extrabold text-ink">{file.title}</span>
                      </div>
                      <div className="mt-1 text-[12px] font-semibold text-ink-faint">
                        {file.quizCount}문제
                        {file.created_at && ` · ${new Date(file.created_at).toLocaleDateString("ko-KR")}`}
                        {file.size && ` · ${(file.size / 1024).toFixed(0)}KB`}
                      </div>
                    </div>
                    <div className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-hairline bg-white px-3 py-1.5 text-[12px] font-extrabold text-accent-strong">
                      PPT 열기 <ExternalLink size={13} strokeWidth={1.8} />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  flex: 1,
  minWidth: 0,
};
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", flexShrink: 0,
};
