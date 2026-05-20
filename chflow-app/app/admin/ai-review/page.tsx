"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

type MemberRow = {
  id: string;
  name: string;
  phone: string | null;
  home_phone: string | null;
  sub_role: string | null;
  family_church: string | null;
  spouse_name: string | null;
  source_page: number | null;
  status: string;
  total_count: number;
};

type Candidate = {
  id: number;
  member_id: string;
  member_name: string;
  member_phone: string | null;
  member_home_phone: string | null;
  member_source_page: number | null;
  member_status: string;
  evidence_image_url: string;
  evidence_note: string | null;
  model: string;
  status: "pending" | "approved" | "ignored" | "needs_review" | "error";
  db_name: string | null;
  db_sub_role: string | null;
  db_family_church: string | null;
  db_spouse_name: string | null;
  db_phone: string | null;
  db_home_phone: string | null;
  db_source_page: number | null;
  ai_name: string | null;
  ai_sub_role: string | null;
  ai_family_church: string | null;
  ai_spouse_name: string | null;
  ai_phone: string | null;
  ai_home_phone: string | null;
  ai_confidence: number | null;
  ai_warnings: string[] | null;
  recommendation: string | null;
  applied_fields: string[] | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  total_count: number;
};

const PAGE_SIZE = 20;

export default function AdminAiReviewPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateStatus, setCandidateStatus] = useState<"pending" | "all" | "approved" | "ignored" | "needs_review" | "error">("pending");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) || null,
    [members, selectedMemberId],
  );

  const searchMembers = useCallback(async (query: string) => {
    const { data, error: searchError } = await supabase.rpc("admin_search_members_paged", {
      p_query: query || null,
      p_plain: null,
      p_grassland: null,
      p_pasture: null,
      p_offset: 0,
      p_limit: 25,
      p_show_children: false,
      p_show_parents: true,
      p_member_status: "active",
    });
    if (searchError) {
      setError(searchError.message);
      setMembers([]);
      return;
    }
    const rows = (data || []) as MemberRow[];
    setMembers(rows);
    setSelectedMemberId((current) => current || rows[0]?.id || "");
  }, []);

  const loadCandidates = useCallback(async (
    nextPage: number,
    nextStatus: "pending" | "all" | "approved" | "ignored" | "needs_review" | "error",
    nextQuery: string,
  ) => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("admin_ai_member_review_candidates", {
      p_status: nextStatus,
      p_query: nextQuery || null,
      p_offset: (nextPage - 1) * PAGE_SIZE,
      p_limit: PAGE_SIZE,
    });
    if (rpcError) {
      setError(rpcError.message);
      setCandidates([]);
      setTotal(0);
    } else {
      const rows = (data || []) as Candidate[];
      setCandidates(rows);
      setTotal(Number(rows[0]?.total_count || 0));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
      await Promise.all([searchMembers(""), loadCandidates(1, "pending", "")]);
    })();
  }, [router, searchMembers, loadCandidates]);

  async function runAiReview() {
    if (!selectedMemberId || !evidenceUrl.trim()) {
      setError("회원과 PDF 근거 이미지 URL을 모두 입력하세요.");
      return;
    }
    setRunning(true);
    setError("");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    const response = await fetch("/api/admin/ai-member-review/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        member_id: selectedMemberId,
        evidence_image_url: evidenceUrl.trim(),
        evidence_note: evidenceNote.trim() || null,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setError(result.error || "AI 검수 실행에 실패했습니다.");
    } else {
      setEvidenceUrl("");
      setEvidenceNote("");
      setCandidateStatus("pending");
      setPage(1);
      await loadCandidates(1, "pending", candidateQuery);
    }
    setRunning(false);
  }

  async function decide(candidate: Candidate, decision: "approved" | "ignored" | "needs_review", applyName = false, applyRole = false) {
    const label = decision === "approved" ? "승인" : decision === "ignored" ? "무시" : "보류";
    if (!confirm(`${candidate.member_name} AI 후보를 ${label} 처리할까요?`)) return;
    setLoading(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("admin_ai_member_review_decide", {
      p_candidate_id: candidate.id,
      p_decision: decision,
      p_apply_name: applyName,
      p_apply_sub_role: applyRole,
      p_note: null,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      await loadCandidates(page, candidateStatus, candidateQuery);
    }
    setLoading(false);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!authChecked) {
    return <div style={loadingPageStyle}>권한 확인 중...</div>;
  }

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={wrapStyle}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <h1 style={titleStyle}>AI 요람 검수</h1>
              <div style={subTitleStyle}>원본 PDF 근거 이미지에서 이름과 직분 후보를 추출하고 사람이 승인합니다.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => router.push("/admin/members")} style={ghostButtonStyle}>회원관리</button>
            <button onClick={() => router.push("/home")} style={ghostButtonStyle}>홈</button>
          </div>
        </header>

        {error && <div style={errorStyle}>{error}</div>}

        <section style={runPanelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>AI 추출 실행</h2>
            <span style={mutedStyle}>PDF row crop 또는 검수용 스크린샷의 공개 URL을 넣습니다.</span>
          </div>
          <div style={formGridStyle}>
            <div style={fieldStyle}>
              <label style={labelStyle}>회원 검색</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && searchMembers(memberQuery)}
                  placeholder="이름 또는 전화번호"
                  style={inputStyle}
                />
                <button onClick={() => searchMembers(memberQuery)} style={buttonStyle}>검색</button>
              </div>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>대상 회원</label>
              <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)} style={selectStyle}>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} / {member.sub_role || "직분 없음"} / p.{member.source_page || "-"} / {member.phone || member.home_phone || "전화 없음"}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
              <label style={labelStyle}>PDF 근거 이미지 URL</label>
              <input
                value={evidenceUrl}
                onChange={(event) => setEvidenceUrl(event.target.value)}
                placeholder="https://.../page110_member_crop.png"
                style={inputStyle}
              />
            </div>
            <div style={{ ...fieldStyle, gridColumn: "1 / -1" }}>
              <label style={labelStyle}>메모</label>
              <input
                value={evidenceNote}
                onChange={(event) => setEvidenceNote(event.target.value)}
                placeholder="예: 110페이지 강범석 row crop"
                style={inputStyle}
              />
            </div>
          </div>
          <div style={runFooterStyle}>
            <div style={selectedSummaryStyle}>
              {selectedMember ? (
                <>
                  <strong>{selectedMember.name}</strong>
                  <span>DB 직분 {selectedMember.sub_role || "-"}</span>
                  <span>요람 page {selectedMember.source_page || "-"}</span>
                </>
              ) : (
                <span>회원을 선택하세요.</span>
              )}
            </div>
            <button onClick={runAiReview} disabled={running} style={primaryButtonStyle}>
              {running ? "AI 추출 중..." : "AI 추출 저장"}
            </button>
          </div>
        </section>

        <section style={listPanelStyle}>
          <div style={sectionHeaderStyle}>
            <h2 style={sectionTitleStyle}>검수 후보</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={candidateQuery}
                onChange={(event) => setCandidateQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    setPage(1);
                    loadCandidates(1, candidateStatus, candidateQuery);
                  }
                }}
                placeholder="후보 검색"
                style={{ ...inputStyle, width: 180 }}
              />
              <select
                value={candidateStatus}
                onChange={(event) => {
                  const next = event.target.value as typeof candidateStatus;
                  setCandidateStatus(next);
                  setPage(1);
                  loadCandidates(1, next, candidateQuery);
                }}
                style={{ ...selectStyle, width: 140 }}
              >
                <option value="pending">대기</option>
                <option value="needs_review">보류</option>
                <option value="approved">승인됨</option>
                <option value="ignored">무시됨</option>
                <option value="error">오류</option>
                <option value="all">전체</option>
              </select>
              <button onClick={() => loadCandidates(1, candidateStatus, candidateQuery)} disabled={loading} style={buttonStyle}>
                새로고침
              </button>
            </div>
          </div>

          {candidates.length === 0 ? (
            <div style={emptyStyle}>{loading ? "불러오는 중..." : "표시할 AI 검수 후보가 없습니다."}</div>
          ) : (
            <div style={candidateListStyle}>
              {candidates.map((candidate) => (
                <CandidateRow key={candidate.id} candidate={candidate} onDecide={decide} />
              ))}
            </div>
          )}

          <div style={paginationStyle}>
            <button
              onClick={() => {
                const next = Math.max(1, page - 1);
                setPage(next);
                loadCandidates(next, candidateStatus, candidateQuery);
              }}
              disabled={page <= 1}
              style={ghostButtonStyle}
            >
              이전
            </button>
            <span style={mutedStyle}>{page} / {totalPages} 페이지, 총 {total.toLocaleString()}건</span>
            <button
              onClick={() => {
                const next = Math.min(totalPages, page + 1);
                setPage(next);
                loadCandidates(next, candidateStatus, candidateQuery);
              }}
              disabled={page >= totalPages}
              style={ghostButtonStyle}
            >
              다음
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function CandidateRow({ candidate, onDecide }: {
  candidate: Candidate;
  onDecide: (candidate: Candidate, decision: "approved" | "ignored" | "needs_review", applyName?: boolean, applyRole?: boolean) => void;
}) {
  const nameChanged = clean(candidate.db_name) !== clean(candidate.ai_name);
  const roleChanged = clean(candidate.db_sub_role) !== clean(candidate.ai_sub_role);
  const confidence = Number(candidate.ai_confidence || 0);

  return (
    <article style={candidateStyle}>
      <div style={imageWrapStyle}>
        <img src={candidate.evidence_image_url} alt={`${candidate.member_name} PDF 근거`} style={imageStyle} />
      </div>
      <div style={candidateBodyStyle}>
        <div style={candidateTopStyle}>
          <div>
            <div style={candidateTitleStyle}>{candidate.member_name}</div>
            <div style={mutedStyle}>
              page {candidate.member_source_page || candidate.db_source_page || "-"} · {candidate.member_phone || candidate.member_home_phone || "전화 없음"} · {candidate.model}
            </div>
          </div>
          <span style={{ ...statusBadgeStyle, ...statusTone(candidate.status) }}>{statusLabel(candidate.status)}</span>
        </div>

        <div style={compareGridStyle}>
          <CompareCell label="DB 이름" value={candidate.db_name} />
          <CompareCell label="AI 이름" value={candidate.ai_name} changed={nameChanged} />
          <CompareCell label="DB 직분" value={candidate.db_sub_role} />
          <CompareCell label="AI 직분" value={candidate.ai_sub_role} changed={roleChanged} />
          <CompareCell label="DB 배우자" value={candidate.db_spouse_name} />
          <CompareCell label="AI 배우자" value={candidate.ai_spouse_name} />
          <CompareCell label="DB 가정교회" value={candidate.db_family_church} />
          <CompareCell label="AI 가정교회" value={candidate.ai_family_church} />
        </div>

        <div style={metaLineStyle}>
          <span>신뢰도 {(confidence * 100).toFixed(0)}%</span>
          <span>추천 {candidate.recommendation || "-"}</span>
          {candidate.evidence_note && <span>{candidate.evidence_note}</span>}
        </div>
        {candidate.ai_warnings && candidate.ai_warnings.length > 0 && (
          <div style={warningStyle}>{candidate.ai_warnings.join(" / ")}</div>
        )}

        <div style={actionsStyle}>
          <button
            onClick={() => onDecide(candidate, "approved", true, false)}
            disabled={!nameChanged || candidate.status !== "pending"}
            style={buttonStyle}
          >
            이름만 적용
          </button>
          <button
            onClick={() => onDecide(candidate, "approved", false, true)}
            disabled={!roleChanged || candidate.status !== "pending"}
            style={buttonStyle}
          >
            직분만 적용
          </button>
          <button
            onClick={() => onDecide(candidate, "approved", nameChanged, roleChanged)}
            disabled={(!nameChanged && !roleChanged) || candidate.status !== "pending"}
            style={primaryButtonStyle}
          >
            차이 적용
          </button>
          <button
            onClick={() => onDecide(candidate, "needs_review")}
            disabled={candidate.status !== "pending"}
            style={ghostButtonStyle}
          >
            보류
          </button>
          <button
            onClick={() => onDecide(candidate, "ignored")}
            disabled={candidate.status !== "pending"}
            style={dangerButtonStyle}
          >
            무시
          </button>
        </div>
      </div>
    </article>
  );
}

function CompareCell({ label, value, changed = false }: { label: string; value: string | null; changed?: boolean }) {
  return (
    <div style={{ ...compareCellStyle, borderColor: changed ? "#f59e0b" : "#e2e8f0", background: changed ? "#fffbeb" : "#fff" }}>
      <div style={compareLabelStyle}>{label}</div>
      <div style={compareValueStyle}>{value || "-"}</div>
    </div>
  );
}

function clean(value: string | null) {
  return (value || "").replace(/\s+/g, "");
}

function statusLabel(status: Candidate["status"]) {
  const labels: Record<Candidate["status"], string> = {
    pending: "대기",
    approved: "승인",
    ignored: "무시",
    needs_review: "보류",
    error: "오류",
  };
  return labels[status];
}

function statusTone(status: Candidate["status"]) {
  if (status === "approved") return { background: "#dcfce7", color: "#166534" };
  if (status === "ignored") return { background: "#f1f5f9", color: "#475569" };
  if (status === "needs_review") return { background: "#fef3c7", color: "#92400e" };
  if (status === "error") return { background: "#fee2e2", color: "#991b1b" };
  return { background: "#dbeafe", color: "#1d4ed8" };
}

const loadingPageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f4f6f8",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f4f6f8",
  fontFamily: "'Noto Sans KR', sans-serif",
  padding: 16,
};

const wrapStyle: React.CSSProperties = {
  maxWidth: 1440,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: "16px 18px",
  marginBottom: 14,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 800,
  color: "#111827",
};

const subTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  marginTop: 3,
};

const runPanelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 16,
  marginBottom: 14,
};

const listPanelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 16,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 800,
  color: "#111827",
};

const formGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 12,
};

const fieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 38,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  boxSizing: "border-box",
  background: "#fff",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  borderColor: "#2563eb",
  background: "#2563eb",
  color: "#fff",
};

const ghostButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#f8fafc",
};

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  borderColor: "#fecaca",
  background: "#fff1f2",
  color: "#be123c",
};

const runFooterStyle: React.CSSProperties = {
  marginTop: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
};

const selectedSummaryStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
  color: "#475569",
  fontSize: 13,
};

const errorStyle: React.CSSProperties = {
  background: "#fee2e2",
  color: "#991b1b",
  border: "1px solid #fecaca",
  borderRadius: 8,
  padding: 12,
  marginBottom: 14,
  fontSize: 13,
  fontWeight: 700,
};

const emptyStyle: React.CSSProperties = {
  minHeight: 120,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#64748b",
  background: "#f8fafc",
  borderRadius: 8,
};

const candidateListStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
};

const candidateStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
  gap: 14,
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 12,
  background: "#fff",
};

const imageWrapStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  background: "#f8fafc",
  minHeight: 160,
  overflow: "hidden",
};

const imageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  maxHeight: 240,
  objectFit: "contain",
  display: "block",
};

const candidateBodyStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const candidateTopStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  alignItems: "flex-start",
};

const candidateTitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  color: "#111827",
};

const statusBadgeStyle: React.CSSProperties = {
  borderRadius: 999,
  padding: "4px 9px",
  fontSize: 12,
  fontWeight: 800,
};

const compareGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 8,
};

const compareCellStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  padding: "8px 10px",
};

const compareLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#64748b",
  fontWeight: 700,
  marginBottom: 3,
};

const compareValueStyle: React.CSSProperties = {
  fontSize: 15,
  color: "#111827",
  fontWeight: 800,
  minHeight: 22,
};

const metaLineStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  fontSize: 12,
  color: "#475569",
};

const warningStyle: React.CSSProperties = {
  background: "#fffbeb",
  border: "1px solid #fde68a",
  color: "#92400e",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const mutedStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
};

const paginationStyle: React.CSSProperties = {
  marginTop: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  flexWrap: "wrap",
};
