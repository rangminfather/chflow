"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, formatPhone } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import MemberCardModal from "@/components/MemberCardModal";

interface PastureNode {
  plain_id: string; plain_name: string; plain_order: number;
  grassland_id: string | null; grassland_name: string | null; grassland_order: number | null;
  pasture_id: string | null; pasture_name: string | null; pasture_order: number | null;
  total_count: number;
  verified_count: number;
  needs_check_count: number;
  unreviewed_count: number;
}

interface ReviewMember {
  id: string;
  name: string;
  phone: string | null;
  gender: string | null;
  is_child: boolean;
  sub_role: string | null;
  family_church: string | null;
  spouse_name: string | null;
  birth_date: string | null;
  address: string | null;
  household_id: string | null;
  household_order: number | null;
  photo_url: string | null;
  photo_status: string | null;
  source_page: number | null;
  photo_page: number | null;
  review_status: "unreviewed" | "verified" | "needs_check";
  review_note: string | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  flags: string[] | null;
  child_names: string[] | null;
  parent_names: string[] | null;
}

interface Summary {
  total: number;
  verified: number;
  needs_check: number;
  unreviewed: number;
  flagged: number;
}

const FLAG_LABEL: Record<string, { label: string; color: string }> = {
  no_photo: { label: "사진없음", color: "#f59e0b" },
  bad_phone: { label: "번호이상", color: "#ef4444" },
  spouse_mismatch: { label: "배우자불일치", color: "#dc2626" },
  orphan_child: { label: "부모미연결", color: "#a855f7" },
  no_household: { label: "가구미배정", color: "#6b7280" },
  no_page: { label: "원본페이지없음", color: "#94a3b8" },
};

const PDF_PATH = "yoram_2026.pdf";

export default function AdminReviewPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [tree, setTree] = useState<PastureNode[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>("");

  const [selectedPlain, setSelectedPlain] = useState<string>("");
  const [selectedPastureId, setSelectedPastureId] = useState<string>("");
  const [selectedPastureName, setSelectedPastureName] = useState<string>("");

  const [members, setMembers] = useState<ReviewMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [filterFlag, setFilterFlag] = useState<string>(""); // "" | flag | "unreviewed" | "verified" | "needs_check"

  // 인증 + 초기 로드
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data: prof } = await supabase.rpc("get_my_status");
      if (!prof?.[0] || !["admin", "office", "pastor"].includes(prof[0].role)) {
        router.replace("/home"); return;
      }
      setAuthChecked(true);
      await Promise.all([loadTree(), loadSummary(), loadPdfUrl()]);
    })();
  }, []);

  const loadTree = async () => {
    const { data } = await supabase.rpc("admin_review_pasture_tree");
    if (data) setTree(data);
  };
  const loadSummary = async () => {
    const { data } = await supabase.rpc("admin_review_summary");
    if (data?.[0]) setSummary(data[0]);
  };
  const loadPdfUrl = async () => {
    const { data, error } = await supabase.storage
      .from("directory-pdf")
      .createSignedUrl(PDF_PATH, 60 * 60); // 1시간
    if (!error && data) setPdfUrl(data.signedUrl);
  };

  const loadPasture = async (pastureId: string, pastureName: string) => {
    setSelectedPastureId(pastureId);
    setSelectedPastureName(pastureName);
    setLoading(true);
    setMembers([]);
    setActiveMemberId(null);
    setActivePage(null);
    const { data } = await supabase.rpc("admin_review_pasture_members", {
      p_pasture_id: pastureId,
    });
    if (data) {
      setMembers(data);
      const firstPage = data.find((m: ReviewMember) => m.source_page)?.source_page;
      if (firstPage) setActivePage(firstPage);
    }
    setLoading(false);
  };

  const setStatus = async (memberId: string, status: "verified" | "needs_check" | "unreviewed", note?: string | null) => {
    const { error } = await supabase.rpc("admin_review_set_status", {
      p_member_id: memberId,
      p_status: status,
      p_note: note ?? null,
    });
    if (error) { alert(`상태 변경 실패: ${error.message}`); return; }
    // 로컬 갱신
    setMembers(prev => prev.map(m => m.id === memberId
      ? { ...m, review_status: status, review_note: note ?? m.review_note, reviewed_at: status === "unreviewed" ? null : new Date().toISOString() }
      : m));
    // 트리/요약 갱신
    loadTree();
    loadSummary();
  };

  const saveNote = async (memberId: string) => {
    const m = members.find(x => x.id === memberId);
    if (!m) return;
    await setStatus(memberId, m.review_status, noteDraft);
    setNoteEditing(null);
  };

  // 평원 → 목장 그룹핑
  const plainOptions = useMemo(() => {
    const set = new Map<string, number>();
    tree.forEach(t => {
      if (t.plain_name && !set.has(t.plain_name)) set.set(t.plain_name, t.plain_order);
    });
    return Array.from(set.entries()).sort((a, b) => a[1] - b[1]).map(([n]) => n);
  }, [tree]);

  const pasturesInPlain = useMemo(() => {
    return tree.filter(t => t.plain_name === selectedPlain && t.pasture_id);
  }, [tree, selectedPlain]);

  // 회원 필터
  const filteredMembers = useMemo(() => {
    if (!filterFlag) return members;
    if (["unreviewed", "verified", "needs_check"].includes(filterFlag)) {
      return members.filter(m => m.review_status === filterFlag);
    }
    return members.filter(m => (m.flags || []).includes(filterFlag));
  }, [members, filterFlag]);

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9" }}>로딩 중...</div>;
  }

  const pct = (n: number, total: number) => total === 0 ? 0 : Math.round(n / total * 100);

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "#fff", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HeaderLogo />
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>회원 데이터 검수</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>원본 교회요람 PDF와 비교하여 정합성 확인</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {summary && (
            <>
              <span style={{ fontSize: 12, color: "#475569" }}>
                전체 <b>{summary.total}</b>명 ·
                <span style={{ color: "#15803d", marginLeft: 6 }}>✅ {summary.verified}</span> ·
                <span style={{ color: "#b45309", marginLeft: 6 }}>⚠️ {summary.needs_check}</span> ·
                <span style={{ color: "#64748b", marginLeft: 6 }}>미검수 {summary.unreviewed}</span> ·
                <span style={{ color: "#dc2626", marginLeft: 6 }}>🚩 {summary.flagged}</span>
              </span>
              <div style={{ width: 160, height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden", display: "flex" }}>
                <div style={{ width: `${pct(summary.verified, summary.total)}%`, background: "#22c55e" }} />
                <div style={{ width: `${pct(summary.needs_check, summary.total)}%`, background: "#f59e0b" }} />
              </div>
            </>
          )}
          <button onClick={() => router.push("/admin/members")} style={btnGhost}>회원관리</button>
          <button onClick={() => router.push("/home")} style={btnGhost}>← 홈</button>
        </div>
      </div>

      {/* Body: Left (목장 + 회원) | Right (PDF) */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(420px, 45%) 1fr", height: "calc(100vh - 64px)" }}>
        {/* === Left Panel === */}
        <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid #e2e8f0", overflow: "hidden" }}>
          {/* 평원/목장 선택 */}
          <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {plainOptions.map(p => (
                <button key={p}
                  onClick={() => { setSelectedPlain(p); setSelectedPastureId(""); }}
                  style={{
                    padding: "4px 10px", borderRadius: 6, border: "1px solid",
                    borderColor: selectedPlain === p ? "#6366f1" : "#cbd5e1",
                    background: selectedPlain === p ? "#6366f1" : "#fff",
                    color: selectedPlain === p ? "#fff" : "#475569",
                    fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>
                  {p === "미정" ? "미정" : (p.endsWith("평원") ? p : `${p}평원`)}
                </button>
              ))}
            </div>
            {selectedPlain && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxHeight: 180, overflowY: "auto" }}>
                {pasturesInPlain.map(p => {
                  const sel = selectedPastureId === p.pasture_id;
                  const remaining = (p.total_count || 0) - (p.verified_count || 0);
                  return (
                    <button key={p.pasture_id}
                      onClick={() => loadPasture(p.pasture_id!, p.pasture_name!)}
                      style={{
                        padding: "4px 8px", borderRadius: 6, border: "1px solid",
                        borderColor: sel ? "#10b981" : "#e2e8f0",
                        background: sel ? "#10b981" : remaining === 0 ? "#dcfce7" : "#fff",
                        color: sel ? "#fff" : remaining === 0 ? "#15803d" : "#475569",
                        fontSize: 11, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
                      }}
                      title={`${p.grassland_name} / ${p.pasture_name} (${p.verified_count}/${p.total_count} 완료)`}>
                      <span>{p.pasture_name}</span>
                      <span style={{ opacity: 0.7, fontSize: 10 }}>
                        {p.verified_count}/{p.total_count}
                        {p.needs_check_count > 0 && <span style={{ color: sel ? "#fef3c7" : "#b45309" }}> ⚠️{p.needs_check_count}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 필터 */}
          {selectedPastureId && (
            <div style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#64748b" }}>필터:</span>
              {[
                ["", "전체"],
                ["unreviewed", "미검수"],
                ["needs_check", "보류"],
                ["verified", "확인완료"],
                ["no_photo", "사진없음"],
                ["bad_phone", "번호이상"],
                ["spouse_mismatch", "배우자"],
                ["orphan_child", "부모X"],
              ].map(([v, label]) => (
                <button key={v} onClick={() => setFilterFlag(v)}
                  style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 11,
                    border: "1px solid",
                    borderColor: filterFlag === v ? "#6366f1" : "#e2e8f0",
                    background: filterFlag === v ? "#6366f1" : "#fff",
                    color: filterFlag === v ? "#fff" : "#475569",
                    cursor: "pointer",
                  }}>{label}</button>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>{filteredMembers.length}/{members.length}</span>
            </div>
          )}

          {/* 회원 카드 리스트 */}
          <div style={{ flex: 1, overflowY: "auto", padding: 8, background: "#f1f5f9" }}>
            {!selectedPastureId && (
              <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", fontSize: 13 }}>
                위에서 평원과 목장을 선택해주세요
              </div>
            )}
            {loading && <div style={{ textAlign: "center", padding: 20, color: "#64748b" }}>회원 불러오는 중...</div>}
            {!loading && selectedPastureId && filteredMembers.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>해당 조건의 회원이 없습니다</div>
            )}
            {filteredMembers.map((m) => {
              const isActive = activeMemberId === m.id;
              const cardBg = m.review_status === "verified" ? "#f0fdf4"
                : m.review_status === "needs_check" ? "#fffbeb"
                : "#fff";
              const cardBorder = isActive ? "#6366f1"
                : m.review_status === "verified" ? "#86efac"
                : m.review_status === "needs_check" ? "#fcd34d"
                : "#e2e8f0";
              return (
                <div key={m.id}
                  onClick={() => {
                    setActiveMemberId(m.id);
                    if (m.source_page) setActivePage(m.source_page);
                  }}
                  style={{
                    background: cardBg, border: `2px solid ${cardBorder}`, borderRadius: 8,
                    padding: 10, marginBottom: 8, cursor: "pointer",
                  }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    {/* 사진 */}
                    <div style={{ flexShrink: 0 }}>
                      {m.photo_url
                        ? <img src={m.photo_url} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", background: "#e2e8f0" }} />
                        : <div style={{ width: 56, height: 56, borderRadius: 8, background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{m.gender === "F" ? "👩" : "👨"}</div>}
                    </div>
                    {/* 본문 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{m.name}</span>
                        {m.is_child && <span style={{ fontSize: 11 }}>👶</span>}
                        {m.gender && <span style={{ fontSize: 10, color: "#64748b" }}>{m.gender === "M" ? "남" : "여"}</span>}
                        {m.family_church && (
                          <span style={{
                            padding: "1px 6px", borderRadius: 3, fontSize: 10,
                            background: m.family_church === "목자" ? "#dbeafe" : m.family_church === "목녀" ? "#fce7f3" : "#f1f5f9",
                            color: m.family_church === "목자" ? "#1e40af" : m.family_church === "목녀" ? "#9d174d" : "#475569",
                          }}>{m.family_church}</span>
                        )}
                        {m.sub_role && <span style={{ fontSize: 10, color: "#64748b" }}>{m.sub_role}</span>}
                        {m.source_page && <span style={{ fontSize: 10, color: "#94a3b8" }}>📄p.{m.source_page}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 3, lineHeight: 1.5 }}>
                        {m.phone && <span>📱 {formatPhone(m.phone)}</span>}
                        {m.birth_date && <span style={{ marginLeft: 8 }}>🎂 {m.birth_date}</span>}
                      </div>
                      {m.address && (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          🏠 {m.address}
                        </div>
                      )}
                      {(m.spouse_name || m.parent_names?.length || m.child_names?.length) && (
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                          {m.spouse_name && <span>💑 {m.spouse_name}</span>}
                          {m.parent_names?.length && <span style={{ marginLeft: 6 }}>👪 {m.parent_names.join(", ")}</span>}
                          {m.child_names?.length && <span style={{ marginLeft: 6 }}>👶 {m.child_names.join(", ")}</span>}
                        </div>
                      )}
                      {/* 의심플래그 */}
                      {m.flags && m.flags.length > 0 && (
                        <div style={{ marginTop: 4, display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {m.flags.map(f => (
                            <span key={f} style={{
                              padding: "1px 6px", borderRadius: 3, fontSize: 10,
                              background: FLAG_LABEL[f]?.color || "#94a3b8",
                              color: "#fff", fontWeight: 600,
                            }}>{FLAG_LABEL[f]?.label || f}</span>
                          ))}
                        </div>
                      )}
                      {/* 메모 */}
                      {(m.review_note || noteEditing === m.id) && (
                        <div style={{ marginTop: 4 }}>
                          {noteEditing === m.id ? (
                            <div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}>
                              <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") saveNote(m.id); }}
                                placeholder="검수 메모"
                                style={{ flex: 1, padding: "3px 6px", fontSize: 11, border: "1px solid #cbd5e1", borderRadius: 4 }} />
                              <button onClick={() => saveNote(m.id)} style={{ ...btnMini, background: "#6366f1", color: "#fff" }}>저장</button>
                              <button onClick={() => setNoteEditing(null)} style={{ ...btnMini, background: "#f1f5f9" }}>취소</button>
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: "#92400e", background: "#fef3c7", padding: "2px 6px", borderRadius: 4 }}>
                              📝 {m.review_note}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* 액션 버튼 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => setStatus(m.id, m.review_status === "verified" ? "unreviewed" : "verified")}
                        style={{
                          ...btnMini, fontSize: 13,
                          background: m.review_status === "verified" ? "#22c55e" : "#f0fdf4",
                          color: m.review_status === "verified" ? "#fff" : "#15803d",
                          border: "1px solid #86efac",
                        }} title="확인완료">✅</button>
                      <button onClick={() => setStatus(m.id, m.review_status === "needs_check" ? "unreviewed" : "needs_check")}
                        style={{
                          ...btnMini, fontSize: 13,
                          background: m.review_status === "needs_check" ? "#f59e0b" : "#fffbeb",
                          color: m.review_status === "needs_check" ? "#fff" : "#b45309",
                          border: "1px solid #fcd34d",
                        }} title="보류">⚠️</button>
                      <button onClick={() => setEditingMemberId(m.id)}
                        style={{ ...btnMini, fontSize: 13, background: "#eef2ff", color: "#4338ca", border: "1px solid #c7d2fe" }} title="수정">✏️</button>
                      <button onClick={() => { setNoteEditing(m.id); setNoteDraft(m.review_note || ""); }}
                        style={{ ...btnMini, fontSize: 13, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }} title="메모">📝</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* === Right Panel: PDF === */}
        <div style={{ background: "#374151", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 12px", color: "#fff", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center", background: "#1f2937" }}>
            <span>
              📖 {selectedPastureName ? `${selectedPastureName} 검수` : "교회요람 (회원을 클릭하면 해당 페이지로 이동)"}
              {activePage && <span style={{ marginLeft: 8, color: "#fbbf24" }}>p.{activePage}</span>}
            </span>
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: "#93c5fd", fontSize: 11, textDecoration: "underline" }}>새 탭에서 열기</a>
            )}
          </div>
          <div style={{ flex: 1, background: "#1f2937" }}>
            {pdfUrl ? (
              <iframe
                key={`${pdfUrl}#page=${activePage || 1}`}
                src={`${pdfUrl}#page=${activePage || 1}&toolbar=1&view=FitH`}
                style={{ width: "100%", height: "100%", border: 0 }}
                title="요람 PDF" />
            ) : (
              <div style={{ color: "#9ca3af", textAlign: "center", padding: 40 }}>PDF 로딩 중...</div>
            )}
          </div>
        </div>
      </div>

      {/* 회원 수정 모달 (기존 MemberCardModal 재활용) */}
      {editingMemberId && (
        <MemberCardModal
          memberId={editingMemberId}
          onClose={() => setEditingMemberId(null)}
          onChanged={() => {
            // 수정 후 목장 다시 로드
            if (selectedPastureId) loadPasture(selectedPastureId, selectedPastureName);
            loadTree();
            loadSummary();
          }}
        />
      )}
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  padding: "6px 12px", border: "1px solid #cbd5e1", background: "#fff", color: "#475569",
  borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
};
const btnMini: React.CSSProperties = {
  padding: "3px 8px", border: 0, borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer",
};
