"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Megaphone, Pin, MessageSquare, Paperclip, PencilLine, ChevronRight, Lock } from "lucide-react";

type NoticeRow = {
  id: string;
  notice_no: number;
  title: string;
  is_pinned: boolean;
  teachers_only: boolean;
  is_mine: boolean;
  author_name: string | null;
  author_sub_role: string | null;
  comment_count: number;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

const PAGE_SIZE = 30;

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${d.getFullYear() % 100}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export default function NoticeBoardPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const currentYear = new Date().getFullYear();
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<NoticeRow[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const yearOptions = Array.from({ length: currentYear - 2024 + 1 }, (_, i) => currentYear - i);

  const load = useCallback(async (year: number) => {
    setLoading(true);
    setError("");
    setHasMore(false);
    const [{ data: notices, error: listErr }, { data: grade }] = await Promise.all([
      supabase.rpc("list_dept_notices", { p_department_id: deptId, p_limit: PAGE_SIZE, p_offset: 0, p_year: year }),
      supabase.rpc("get_user_grade", { p_dept_id: deptId }),
    ]);
    if (listErr) {
      setError(listErr.message);
      setItems([]);
    } else {
      const rows = (notices as NoticeRow[]) || [];
      setItems(rows);
      setHasMore(rows.length === PAGE_SIZE);
    }
    setCanWrite(typeof grade === "number" && grade <= 3);
    setLoading(false);
  }, [deptId]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const { data, error: listErr } = await supabase.rpc("list_dept_notices", {
      p_department_id: deptId, p_limit: PAGE_SIZE, p_offset: items.length, p_year: selectedYear,
    });
    if (!listErr) {
      const rows = (data as NoticeRow[]) || [];
      setItems((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }, [deptId, items.length, selectedYear]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
      await load(currentYear);
    })();
  }, [router, load, currentYear]);

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={pageStyle}>
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Megaphone size={18} strokeWidth={1.8} /> 공지 게시판
        </div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-hairline bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <div className="min-w-0">
              <div className="text-[20px] font-extrabold text-ink">공지 게시판</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                value={selectedYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setSelectedYear(y);
                  load(y);
                }}
                className="rounded-lg border border-hairline px-3 py-2 text-[14px] font-semibold text-ink"
                style={{ background: "var(--surface)" }}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
              {canWrite && selectedYear === currentYear && (
                <button
                  type="button"
                  onClick={() => router.push(`/departments/d/${deptId}/notices/board/new`)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[14px] font-bold text-white"
                  style={{ background: "var(--accent)" }}
                >
                  <PencilLine size={16} strokeWidth={2} /> 글쓰기
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="p-3 sm:p-4"><LoadingView padding={48} /></div>
          ) : error ? (
            <div className="p-3 sm:p-4"><EmptyState message="목록을 불러오지 못했습니다" hint={error} padding={48} /></div>
          ) : items.length === 0 ? (
            <div className="p-3 sm:p-4">
              <EmptyState
                icon={<Megaphone size={28} strokeWidth={1.6} />}
                message="아직 등록된 공지가 없습니다"
                hint={canWrite ? "첫 공지를 작성해보세요." : undefined}
                padding={56}
              />
            </div>
          ) : (
            <>
              {/* 목록 헤더 (넓은 화면에서만) */}
              <div className="hidden border-b border-hairline px-4 py-2.5 text-[12px] font-semibold text-ink-faint sm:flex sm:items-center sm:gap-3">
                <span className="w-10 shrink-0 text-center">번호</span>
                <span className="flex-1">제목</span>
                <span className="shrink-0 pr-7">작성자 · 작성일</span>
              </div>

              <ul>
                {items.map((n) => (
                  <li key={n.id} className="border-b border-hairline last:border-b-0">
                    <button
                      type="button"
                      onClick={() => router.push(`/departments/d/${deptId}/notices/board/${n.id}`)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface sm:px-4"
                    >
                      <span className="w-9 shrink-0 text-center text-[13px] font-semibold tabular-nums text-ink-faint sm:w-10">
                        {n.notice_no}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {n.is_pinned && (
                            <Pin size={13} strokeWidth={2} fill="currentColor" className="shrink-0 text-accent" />
                          )}
                          <span className="truncate text-[15px] font-bold text-ink">{n.title}</span>
                          {n.teachers_only && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-accent" style={{ background: "var(--accent-soft)" }}>
                              <Lock size={9} strokeWidth={2.5} /> 선생님만
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] font-medium text-ink-soft">
                          <span>{n.author_name || "작성자"}</span>
                          {n.author_sub_role && <span className="text-ink-faint">· {n.author_sub_role}</span>}
                          <span className="text-ink-faint">· {formatDate(n.created_at)}</span>
                          {n.attachment_count > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-ink-faint"><Paperclip size={12} strokeWidth={2} />{n.attachment_count}</span>
                          )}
                          {n.comment_count > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-ink-faint"><MessageSquare size={12} strokeWidth={2} />{n.comment_count}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {n.is_mine && (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-accent" style={{ background: "var(--accent-soft)" }}>내 글</span>
                        )}
                        <ChevronRight size={16} strokeWidth={2} className="text-ink-faint" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              {hasMore && (
                <div className="flex justify-center px-3 py-3 sm:px-4">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-lg border border-hairline px-5 py-2.5 text-[14px] font-bold text-ink-soft transition-colors hover:border-accent-line disabled:opacity-60"
                    style={{ background: "var(--surface)" }}
                  >
                    {loadingMore ? "불러오는 중…" : "더보기"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
