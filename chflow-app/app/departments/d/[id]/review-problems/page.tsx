"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import ModalBackdrop from "@/components/ModalBackdrop";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { BookOpen, FileText, RefreshCw, X, ChevronRight } from "lucide-react";

interface ReviewFile {
  path: string;
  jsonPath: string;
  title: string;
  lessonNum: string;
  specialTitle: string;
  quizCount: number;
  created_at: string | null;
  size: number | null;
}

interface Quiz {
  type: "subjective" | "mc3" | "mc4" | "mc5";
  question: string;
  choices: string[];
  answerIndex?: number;
  answerText?: string;
}

interface ReviewDetail {
  title: string;
  lessonNum: string;
  specialTitle: string;
  quizzes: Quiz[];
}

// 스토리지 slug 패턴(영문+타임스탬프) 제거하고 읽기 좋은 제목 반환
function displayTitle(file: ReviewFile): string {
  if (file.lessonNum) return `${file.lessonNum}과 복습문제`;
  if (file.specialTitle) return file.specialTitle;
  // JSON 없이 item.name이 그대로 들어온 경우 → slug 앞부분 제거
  return file.title
    .replace(/^[a-z0-9-]+_\d{10,}_/i, "")  // "special_1685000000_" 제거
    .replace(/\.pptx$/i, "")
    .replace(/-/g, " ")
    .trim() || file.title;
}

export default function ReviewProblemsPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [error, setError] = useState("");

  const [selected, setSelected] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await loadFiles(session.access_token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, deptId]);

  async function loadFiles(token?: string) {
    setLoading(true);
    setError("");
    const accessToken = token || (await supabase.auth.getSession()).data.session?.access_token;
    if (!accessToken) { router.replace("/login"); return; }

    const response = await fetch(`/api/edu/review-problems?dept_id=${deptId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok || !result.ok) { setError(result.error || "복습문제를 불러오지 못했습니다"); return; }
    setFiles(result.problems || []);
  }

  async function openDetail(file: ReviewFile) {
    setDetailLoading(true);
    setDetailError("");
    setSelected({ title: file.title, lessonNum: file.lessonNum, specialTitle: file.specialTitle, quizzes: [] });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setDetailError("로그인이 필요합니다"); setDetailLoading(false); return; }

    const response = await fetch(
      `/api/edu/review-problems?dept_id=${deptId}&file=${encodeURIComponent(file.jsonPath)}`,
      { headers: { Authorization: `Bearer ${session.access_token}` } }
    );
    const result = await response.json();
    setDetailLoading(false);
    if (!response.ok || !result.ok) { setDetailError(result.error || "문제를 불러오지 못했습니다"); return; }
    const p = result.problem;
    setSelected({ title: p.title, lessonNum: p.lessonNum, specialTitle: p.specialTitle, quizzes: p.quizzes || [] });
  }

  if (!authChecked) return <LoadingView full />;

  const lessonFiles = files.filter((f) => f.lessonNum);
  const specialFiles = files.filter((f) => !f.lessonNum);

  return (
    <div style={pageStyle}>
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <BookOpen size={18} strokeWidth={1.8} /> 복습문제 보기
        </div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-hairline bg-card">
          <div className="border-b border-hairline px-5 py-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[20px] font-extrabold text-ink">복습문제 보기</div>
              <div className="mt-1 text-[14px] font-semibold text-ink-soft">
                파일을 선택하면 문제와 보기를 바로 확인할 수 있습니다.
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
                  <button
                    key={file.path}
                    onClick={() => openDetail(file)}
                    className="flex w-full items-center gap-3 rounded-lg border border-hairline bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft"
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
                        <span className="truncate text-[15px] font-extrabold text-ink">{displayTitle(file)}</span>
                      </div>
                      <div className="mt-1 text-[12px] font-semibold text-ink-faint">
                        {file.quizCount}문제
                        {file.created_at && ` · ${new Date(file.created_at).toLocaleDateString("ko-KR")}`}
                      </div>
                    </div>
                    <ChevronRight size={16} strokeWidth={2} className="flex-shrink-0 text-ink-faint" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* 문제 상세 모달 */}
      {selected && (
        <ModalBackdrop onClose={() => { setSelected(null); setDetailError(""); }} style={{
          position: "fixed", inset: 0,
          background: "rgba(43,39,34,0.55)",
          backdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 100, padding: 16,
        }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card)",
              borderRadius: 14,
              width: "100%",
              maxWidth: 560,
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            {/* 모달 헤더 */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "16px 20px",
              borderBottom: "1px solid var(--hairline)",
              flexShrink: 0,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  {selected.lessonNum && (
                    <span style={{
                      background: "var(--accent-soft)", color: "var(--accent-strong)",
                      borderRadius: 999, padding: "2px 8px",
                      fontSize: 11, fontWeight: 800,
                    }}>{selected.lessonNum}과</span>
                  )}
                  {selected.specialTitle && (
                    <span style={{
                      background: "var(--accent-soft)", color: "var(--accent-strong)",
                      borderRadius: 999, padding: "2px 8px",
                      fontSize: 11, fontWeight: 800,
                    }}>특별</span>
                  )}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", lineHeight: 1.3 }}>
                  {selected.specialTitle || selected.title}
                </div>
              </div>
              <button
                onClick={() => { setSelected(null); setDetailError(""); }}
                style={{
                  flexShrink: 0, width: 32, height: 32,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "none", background: "var(--bg-soft)", borderRadius: 8,
                  cursor: "pointer", color: "var(--ink-mid)",
                }}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            {/* 모달 본문 */}
            <div style={{ overflowY: "auto", padding: "16px 20px", flex: 1 }}>
              {detailLoading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--ink-faint)", fontSize: 14, fontWeight: 700 }}>
                  문제 불러오는 중...
                </div>
              ) : detailError ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#ef4444", fontSize: 14, fontWeight: 700 }}>
                  {detailError}
                </div>
              ) : selected.quizzes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "var(--ink-faint)", fontSize: 14, fontWeight: 700 }}>
                  추출된 문제가 없습니다
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {selected.quizzes.map((quiz, i) => (
                    <div key={i} style={{
                      background: "var(--bg-soft)",
                      border: "1px solid var(--hairline)",
                      borderRadius: 10,
                      padding: "14px 16px",
                    }}>
                      <div style={{
                        display: "flex", gap: 8, alignItems: "flex-start", marginBottom: quiz.choices.length > 0 ? 10 : 0,
                      }}>
                        <span style={{
                          flexShrink: 0,
                          width: 22, height: 22,
                          background: "var(--accent)", color: "#fff",
                          borderRadius: "50%",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 800, marginTop: 1,
                        }}>{i + 1}</span>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", lineHeight: 1.5 }}>
                          {quiz.question}
                        </div>
                      </div>
                      {quiz.choices.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 30 }}>
                          {quiz.choices.map((choice, j) => {
                            const isAnswer = quiz.answerIndex === j;
                            return (
                              <div key={j} style={{
                                display: "flex", gap: 8, alignItems: "flex-start",
                                fontSize: 13, lineHeight: 1.4,
                                background: isAnswer ? "rgba(234,88,12,0.08)" : "transparent",
                                borderRadius: isAnswer ? 6 : 0,
                                padding: isAnswer ? "4px 8px" : "0",
                                marginLeft: isAnswer ? -8 : 0,
                              }}>
                                <span style={{
                                  flexShrink: 0, fontWeight: 800, minWidth: 16,
                                  color: isAnswer ? "#ea580c" : "var(--accent-strong)",
                                }}>
                                  {["①", "②", "③", "④", "⑤"][j]}
                                </span>
                                <span style={{
                                  color: isAnswer ? "#ea580c" : "var(--ink-mid)",
                                  fontWeight: isAnswer ? 800 : 400,
                                }}>
                                  {choice}
                                </span>
                                {isAnswer && (
                                  <span style={{
                                    marginLeft: "auto", flexShrink: 0,
                                    fontSize: 10, fontWeight: 800,
                                    color: "#ea580c",
                                    background: "rgba(234,88,12,0.12)",
                                    borderRadius: 4, padding: "1px 6px",
                                  }}>정답</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {quiz.choices.length === 0 && (
                        <div style={{ paddingLeft: 30, fontSize: 13 }}>
                          {quiz.answerText ? (
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              background: "rgba(234,88,12,0.08)", borderRadius: 6,
                              padding: "4px 10px",
                            }}>
                              <span style={{ fontSize: 10, fontWeight: 800, color: "#ea580c", background: "rgba(234,88,12,0.12)", borderRadius: 4, padding: "1px 6px" }}>정답</span>
                              <span style={{ fontWeight: 800, color: "#ea580c" }}>{quiz.answerText}</span>
                            </span>
                          ) : (
                            <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}>주관식</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 모달 푸터 */}
            {!detailLoading && selected.quizzes.length > 0 && (
              <div style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--hairline)",
                flexShrink: 0,
                fontSize: 12, color: "var(--ink-faint)", fontWeight: 600, textAlign: "center",
              }}>
                총 {selected.quizzes.length}문제
              </div>
            )}
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
