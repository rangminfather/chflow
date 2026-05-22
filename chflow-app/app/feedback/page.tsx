"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

type FeedbackStatus = "submitted" | "received" | "reviewing" | "resolved" | "rejected";

type FeedbackListItem = {
  id: string;
  seq: number;
  title: string;
  status: FeedbackStatus;
  is_private: boolean;
  is_locked: boolean;
  is_mine: boolean;
  author_name: string | null;
  author_sub_role: string | null;
  comment_count: number;
  attachment_count: number;
  created_at: string;
  updated_at: string;
};

const STATUS_META: Record<FeedbackStatus, { label: string; bg: string; fg: string }> = {
  submitted: { label: "미접수", bg: "#fee2e2", fg: "#b91c1c" },
  received:  { label: "접수",   bg: "#fef3c7", fg: "#92400e" },
  reviewing: { label: "검토중", bg: "#dbeafe", fg: "#1e40af" },
  resolved:  { label: "처리완료", bg: "#dcfce7", fg: "#166534" },
  rejected:  { label: "처리불가", bg: "#e2e8f0", fg: "#475569" },
};

const FILTERS: { value: FeedbackStatus | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "submitted", label: "미접수" },
  { value: "received", label: "접수" },
  { value: "reviewing", label: "검토중" },
  { value: "resolved", label: "처리완료" },
  { value: "rejected", label: "처리불가" },
];

const PER_PAGE = 15;

export default function FeedbackListPage() {
  const router = useRouter();
  const [items, setItems] = useState<FeedbackListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("all");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
    })();
  }, [router]);

  // 뒤로가기 → 홈으로
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ chflowFeedbackList: true }, "");
    const onPop = () => router.replace("/home");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [router]);

  useEffect(() => { load(scope, statusFilter, page); /* eslint-disable-next-line */ }, [scope, statusFilter, page]);

  // 필터 바뀌면 1페이지로
  useEffect(() => { setPage(1); }, [scope, statusFilter]);

  async function load(s: "all" | "mine", st: FeedbackStatus | "all", p: number) {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_feedback_posts", {
      p_limit: PER_PAGE,
      p_offset: (p - 1) * PER_PAGE,
      p_status: st === "all" ? null : st,
      p_scope: s,
    });
    if (error) {
      console.error(error);
      setItems([]);
      setTotal(0);
    } else {
      const payload = data as { total: number; rows: FeedbackListItem[] } | null;
      setItems(payload?.rows || []);
      setTotal(payload?.total || 0);
    }
    setLoading(false);
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      <style>{`
        @media (max-width: 760px) {
          .fb-header { flex-direction: column; align-items: flex-start !important; }
          .fb-actions { width: 100%; }
          .fb-row { padding: 12px 10px !important; }
          .fb-seq { min-width: 36px !important; font-size: 11px !important; }
        }
      `}</style>

      <header className="fb-header" style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <HeaderLogo />
          <div style={{ minWidth: 0 }}>
            <h1 style={titleStyle}>💡 불편신고 / 건의</h1>
            <div style={subtitleStyle}>사용하시면서 불편한 점이나 건의사항을 남겨주세요</div>
          </div>
        </div>
        <div className="fb-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={ghostButtonStyle} onClick={() => router.replace("/home")}>홈</button>
          <button style={primaryButtonStyle} onClick={() => router.push("/feedback/new")}>글쓰기</button>
        </div>
      </header>

      <section style={panelStyle}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button onClick={() => setScope("all")} style={scope === "all" ? pillActive : pill}>전체</button>
          <button onClick={() => setScope("mine")} style={scope === "mine" ? pillActive : pill}>내 글</button>
          <div style={{ flex: 1 }} />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FeedbackStatus | "all")}
            style={selectStyle}
          >
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>로딩 중...</div>
        ) : items.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
            <div style={{ fontSize: 14, color: "#64748b" }}>아직 등록된 글이 없습니다</div>
          </div>
        ) : (
          <>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((p) => <FeedbackRow key={p.id} item={p} onClick={() => router.push(`/feedback/${p.id}`)} />)}
            </ul>

            <Pager page={page} totalPages={totalPages} total={total} onChange={setPage} />
          </>
        )}
      </section>
    </div>
  );
}

function FeedbackRow({ item, onClick }: { item: FeedbackListItem; onClick: () => void }) {
  const meta = STATUS_META[item.status];
  const titleDisplay = item.is_locked ? "🔒 비공개 글입니다" : item.title;
  return (
    <li>
      <button onClick={onClick} className="fb-row" style={rowStyle}>
        <span className="fb-seq" style={seqStyle}>#{item.seq}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
          {item.is_private && <span style={lockBadge} title="비공개">🔒</span>}
          {item.is_mine && <span style={mineBadge}>내 글</span>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={rowTitleStyle}>{titleDisplay}</div>
            <div style={rowMetaStyle}>
              {item.author_name || "익명"} · {formatDate(item.created_at)}
              {item.comment_count > 0 && <> · 💬 {item.comment_count}</>}
              {item.attachment_count > 0 && <> · 📎 {item.attachment_count}</>}
            </div>
          </div>
        </div>
        <span style={{
          padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
          background: meta.bg, color: meta.fg, flexShrink: 0, whiteSpace: "nowrap",
        }}>{meta.label}</span>
      </button>
    </li>
  );
}

function Pager({ page, totalPages, total, onChange }:
  { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) {
    return <div style={pagerInfoStyle}>전체 {total}건</div>;
  }
  // 모바일 친화 페이지 범위: 현재 페이지 기준 ±2개 + 첫/끝
  const pages = pageWindow(page, totalPages);
  return (
    <div style={pagerWrapStyle}>
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1} style={pagerNavBtn}>‹</button>
      {pages.map((p, idx) =>
        p === "..." ? (
          <span key={`gap-${idx}`} style={pagerGapStyle}>…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p as number)}
            style={p === page ? pagerBtnActive : pagerBtn}
          >{p}</button>
        )
      )}
      <button onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} style={pagerNavBtn}>›</button>
      <div style={pagerInfoStyle}>전체 {total}건</div>
    </div>
  );
}

function pageWindow(current: number, total: number): (number | "...")[] {
  const result: (number | "...")[] = [];
  const add = (n: number | "...") => result.push(n);
  const window = 1; // 현재 페이지 양쪽 1개씩
  const left = Math.max(2, current - window);
  const right = Math.min(total - 1, current + window);
  add(1);
  if (left > 2) add("...");
  for (let i = left; i <= right; i++) add(i);
  if (right < total - 1) add("...");
  if (total > 1) add(total);
  return result;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}일 전`;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, #f0f9ff 0%, #fef3c7 100%)",
  padding: "20px 16px 60px",
  fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
};
const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  gap: 12, maxWidth: 920, margin: "0 auto 16px", padding: "0 4px",
};
const titleStyle: React.CSSProperties = { fontSize: 20, fontWeight: 900, color: "#1e293b", margin: 0 };
const subtitleStyle: React.CSSProperties = { fontSize: 12, color: "#64748b", marginTop: 2 };
const panelStyle: React.CSSProperties = {
  maxWidth: 920, margin: "0 auto",
  background: "rgba(255,255,255,0.92)",
  backdropFilter: "blur(20px)",
  borderRadius: 16, padding: 16,
  boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  border: "1px solid rgba(255,255,255,0.7)",
};
const ghostButtonStyle: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 10, background: "#fff",
  border: "1.5px solid #e2e8f0", fontSize: 12, fontWeight: 700,
  color: "#475569", cursor: "pointer", fontFamily: "inherit",
};
const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 10,
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", fontSize: 13, fontWeight: 800,
  cursor: "pointer", fontFamily: "inherit",
  boxShadow: "0 6px 16px rgba(99,102,241,0.3)",
};
const pill: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 999, border: "1px solid #e2e8f0",
  background: "#fff", color: "#475569", fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const pillActive: React.CSSProperties = {
  ...pill, background: "#eef2ff", borderColor: "#6366f1", color: "#4338ca",
};
const selectStyle: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 10, border: "1.5px solid #e2e8f0",
  background: "#fff", fontSize: 12, fontWeight: 600, color: "#334155",
  fontFamily: "inherit", cursor: "pointer",
};
const rowStyle: React.CSSProperties = {
  width: "100%", display: "flex", alignItems: "center", gap: 10,
  padding: "14px 14px", background: "#fff", border: "1px solid #e2e8f0",
  borderRadius: 12, cursor: "pointer", textAlign: "left",
  fontFamily: "inherit",
};
const seqStyle: React.CSSProperties = {
  minWidth: 44, fontSize: 12, fontWeight: 800, color: "#94a3b8",
  textAlign: "right", flexShrink: 0,
};
const rowTitleStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: "#1e293b",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const rowMetaStyle: React.CSSProperties = {
  fontSize: 11, color: "#94a3b8", marginTop: 3,
};
const lockBadge: React.CSSProperties = {
  fontSize: 14, flexShrink: 0,
};
const mineBadge: React.CSSProperties = {
  padding: "2px 6px", borderRadius: 6, background: "#fef3c7",
  color: "#92400e", fontSize: 10, fontWeight: 700, flexShrink: 0,
};
const emptyStyle: React.CSSProperties = {
  padding: "60px 20px", textAlign: "center",
};
const pagerWrapStyle: React.CSSProperties = {
  display: "flex", gap: 4, alignItems: "center", justifyContent: "center",
  marginTop: 16, flexWrap: "wrap",
};
const pagerBtn: React.CSSProperties = {
  minWidth: 32, height: 32, padding: "0 8px", borderRadius: 8,
  border: "1px solid #e2e8f0", background: "#fff", color: "#475569",
  fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const pagerBtnActive: React.CSSProperties = {
  ...pagerBtn, background: "#6366f1", color: "#fff", borderColor: "#6366f1",
};
const pagerNavBtn: React.CSSProperties = {
  ...pagerBtn, fontSize: 16, fontWeight: 800,
};
const pagerGapStyle: React.CSSProperties = {
  padding: "0 4px", color: "#94a3b8", fontSize: 12,
};
const pagerInfoStyle: React.CSSProperties = {
  marginLeft: 8, fontSize: 11, color: "#94a3b8", fontWeight: 600,
};
