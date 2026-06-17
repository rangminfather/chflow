"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Megaphone, Pin, MessageSquare, Paperclip, PencilLine } from "lucide-react";

type NoticeRow = {
  id: string;
  title: string;
  is_pinned: boolean;
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

  const yearOptions = Array.from({ length: currentYear - 2024 + 1 }, (_, i) => currentYear - i);

  const load = useCallback(async (year: number) => {
    setLoading(true);
    setError("");
    const [{ data: notices, error: listErr }, { data: grade }] = await Promise.all([
      supabase.rpc("list_dept_notices", { p_department_id: deptId, p_limit: PAGE_SIZE, p_offset: 0, p_year: year }),
      supabase.rpc("get_user_grade", { p_dept_id: deptId }),
    ]);
    if (listErr) {
      setError(listErr.message);
      setItems([]);
    } else {
      setItems((notices as NoticeRow[]) || []);
    }
    setCanWrite(typeof grade === "number" && grade <= 3);
    setLoading(false);
  }, [deptId]);

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
      <div style={headerStyle}>
        <HeaderLogo />
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Megaphone size={18} strokeWidth={1.8} /> 공지 게시판
        </div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-hairline bg-white">
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

          <div className="p-3 sm:p-4">
            {loading ? (
              <LoadingView padding={48} />
            ) : error ? (
              <EmptyState message="목록을 불러오지 못했습니다" hint={error} padding={48} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Megaphone size={28} strokeWidth={1.6} />}
                message="아직 등록된 공지가 없습니다"
                hint={canWrite ? "첫 공지를 작성해보세요." : undefined}
                padding={56}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/departments/d/${deptId}/notices/board/${n.id}`)}
                      className="flex w-full items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-3 text-left transition-colors hover:border-accent-line"
                    >
                      {n.is_pinned && (
                        <span className="shrink-0 text-accent" title="고정됨">
                          <Pin size={16} strokeWidth={2} fill="currentColor" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[16px] font-bold text-ink">{n.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-ink-soft">
                          <span>{n.author_name || "작성자"}</span>
                          {n.author_sub_role && <span className="text-ink-faint">· {n.author_sub_role}</span>}
                          <span className="text-ink-faint">· {formatDate(n.created_at)}</span>
                          {n.is_mine && <span className="rounded px-1.5 py-0.5 text-[11px] font-bold text-accent" style={{ background: "var(--accent-soft)" }}>내 글</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5 text-[13px] font-semibold text-ink-soft">
                        {n.attachment_count > 0 && (
                          <span className="inline-flex items-center gap-0.5"><Paperclip size={13} strokeWidth={2} />{n.attachment_count}</span>
                        )}
                        {n.comment_count > 0 && (
                          <span className="inline-flex items-center gap-0.5"><MessageSquare size={13} strokeWidth={2} />{n.comment_count}</span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
