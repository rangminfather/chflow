"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";

type Kind = "all" | "feedback_post" | "feedback_comment" | "dept_notice" | "dept_notice_comment" | "verse_memory";

interface WithdrawnMember {
  id: string;
  name: string;
  phone: string | null;
  withdrawn_at: string | null;
  account_deleted_at: string | null;
  content_count: number;
}

interface ContentRow {
  content_kind: Exclude<Kind, "all">;
  content_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  member_id: string | null;
  department_name: string | null;
  title: string | null;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
}

const kindLabels: Record<Kind, string> = {
  all: "전체 콘텐츠",
  feedback_post: "게시글",
  feedback_comment: "게시글 댓글",
  dept_notice: "부서 공지",
  dept_notice_comment: "부서 공지 댓글",
  verse_memory: "암송 생성물",
};

export default function AdminMemberContentPageWrapper() {
  return (
    <Suspense fallback={<LoadingView full />}>
      <AdminMemberContentPage />
    </Suspense>
  );
}

function AdminMemberContentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authChecked, setAuthChecked] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [members, setMembers] = useState<WithdrawnMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState(searchParams.get("member_id") || "");
  const [kind, setKind] = useState<Kind>("all");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_list_withdrawn_members", {
      p_query: memberQuery.trim() || null,
    });
    if (error) {
      alert(`탈퇴 회원 조회 실패: ${error.message}`);
      return;
    }
    setMembers((data || []) as WithdrawnMember[]);
  }, [memberQuery]);

  const loadContent = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_member_content", {
      p_member_id: selectedMemberId || null,
      p_kind: kind,
      p_include_deleted: includeDeleted,
      p_limit: 1000,
    });
    if (error) {
      alert(`콘텐츠 조회 실패: ${error.message}`);
      setRows([]);
    } else {
      setRows((data || []) as ContentRow[]);
      setSelectedKeys(new Set());
    }
    setLoading(false);
  }, [includeDeleted, kind, selectedMemberId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("get_my_status");
      if (!data?.[0] || !["admin", "office", "pastor"].includes(data[0].role)) {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
    })();
  }, [router]);

  useEffect(() => {
    if (authChecked) {
      void loadMembers();
      void loadContent();
    }
  }, [authChecked, loadContent, loadMembers]);

  const selectedCount = selectedKeys.size;
  const allVisibleSelected = rows.length > 0 && rows.every((row) => selectedKeys.has(`${row.content_kind}:${row.content_id}`));
  const selectedMember = useMemo(() => members.find((member) => member.id === selectedMemberId), [members, selectedMemberId]);

  const toggleRow = (row: ContentRow) => {
    const key = `${row.content_kind}:${row.content_id}`;
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(rows.map((row) => `${row.content_kind}:${row.content_id}`)));
  };

  const deleteSelected = async () => {
    if (!selectedCount) return;
    if (!window.confirm(`선택한 ${selectedCount}개 콘텐츠를 삭제 상태로 바꾸시겠습니까? 원본 행과 파생 연결은 보존됩니다.`)) return;
    setSaving(true);
    const items = rows
      .filter((row) => selectedKeys.has(`${row.content_kind}:${row.content_id}`))
      .map((row) => ({ kind: row.content_kind, id: row.content_id }));
    const { error } = await supabase.rpc("admin_delete_member_content", {
      p_items: items,
      p_reason: reason.trim() || null,
    });
    if (error) {
      alert(`콘텐츠 삭제 실패: ${error.message}`);
    } else {
      setReason("");
      await loadContent();
    }
    setSaving(false);
  };

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", padding: 16, fontFamily: "'Noto Sans KR', sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)" }}>회원 작성 콘텐츠 관리</div>
              <div style={{ marginTop: 5, fontSize: 12, color: "var(--ink-faint)" }}>탈퇴 회원의 글·댓글·생성물을 원본 보존 상태로 관리합니다.</div>
            </div>
            <button onClick={() => router.push("/admin/members")} style={buttonStyle}>← 회원 관리</button>
          </div>
        </div>

        <div style={{ ...cardStyle, marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void loadMembers()} placeholder="탈퇴 회원 이름/전화번호" style={inputStyle} />
            <button onClick={() => void loadMembers()} style={buttonStyle}>회원 검색</button>
            <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)} style={selectStyle}>
              <option value="">탈퇴 회원 전체</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.name} · 콘텐츠 {member.content_count}건</option>)}
            </select>
            {selectedMember && <span style={{ alignSelf: "center", fontSize: 12, color: "var(--ink-mid)" }}>탈퇴일: {formatDate(selectedMember.withdrawn_at)}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <select value={kind} onChange={(event) => setKind(event.target.value as Kind)} style={selectStyle}>
              {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-mid)" }}>
              <input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} /> 삭제된 콘텐츠 포함
            </label>
            <button onClick={() => void loadContent()} style={buttonStyle}>새로고침</button>
          </div>
        </div>

        <div style={{ ...cardStyle, marginTop: 12, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--hairline)" }}>
            <button onClick={toggleAll} disabled={!rows.length} style={buttonStyle}>{allVisibleSelected ? "전체 선택 해제" : "현재 목록 전체 선택"}</button>
            <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="삭제 사유 (선택)" maxLength={300} style={{ ...inputStyle, maxWidth: 260 }} />
            <button onClick={() => void deleteSelected()} disabled={!selectedCount || saving} style={{ ...buttonStyle, background: selectedCount ? "var(--danger)" : "var(--bg-soft)", color: selectedCount ? "#fff" : "var(--ink-faint)" }}>
              {saving ? "처리 중…" : `선택 삭제 ${selectedCount ? `(${selectedCount})` : ""}`}
            </button>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-faint)" }}>{loading ? "조회 중…" : `${rows.length}건`}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "var(--bg-soft)" }}>
                <th style={thStyle}><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} disabled={!rows.length} /></th>
                <th style={thStyle}>종류</th><th style={thStyle}>작성자</th><th style={thStyle}>부서</th><th style={thStyle}>원문</th><th style={thStyle}>작성일</th><th style={thStyle}>상태</th>
              </tr></thead>
              <tbody>
                {rows.map((row) => {
                  const key = `${row.content_kind}:${row.content_id}`;
                  return <tr key={key} style={{ borderTop: "1px solid var(--hairline)", opacity: row.deleted_at ? 0.55 : 1 }}>
                    <td style={tdStyle}><input type="checkbox" checked={selectedKeys.has(key)} onChange={() => toggleRow(row)} /></td>
                    <td style={tdStyle}>{kindLabels[row.content_kind]}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", fontWeight: 700 }}>{row.author_name}</td>
                    <td style={tdStyle}>{row.department_name || "-"}</td>
                    <td style={{ ...tdStyle, minWidth: 260, maxWidth: 520 }}><div style={{ fontWeight: 700, color: "var(--ink)" }}>{row.title || "댓글/생성물"}</div><div style={{ marginTop: 3, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.body || "-"}</div></td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: row.deleted_at ? "var(--danger)" : "var(--success)" }}>{row.deleted_at ? "삭제됨" : "보존 중"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {!rows.length && !loading && <div style={{ padding: 40, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>조건에 맞는 콘텐츠가 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "-";
}

const cardStyle: React.CSSProperties = { background: "var(--card)", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" };
const buttonStyle: React.CSSProperties = { border: "none", borderRadius: 8, padding: "9px 12px", background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const inputStyle: React.CSSProperties = { minWidth: 220, flex: 1, border: "1px solid var(--hairline)", borderRadius: 8, padding: "9px 11px", background: "var(--card)", color: "var(--ink)", font: "inherit", fontSize: 12 };
const selectStyle: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 8, padding: "9px 11px", background: "var(--card)", color: "var(--ink)", font: "inherit", fontSize: 12 };
const thStyle: React.CSSProperties = { textAlign: "left", padding: "10px 12px", color: "var(--ink-mid)", fontWeight: 700, whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "10px 12px", color: "var(--ink-mid)", verticalAlign: "top" };
