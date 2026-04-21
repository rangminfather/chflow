"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface Vote {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  is_active: boolean;
  created_at: string;
  candidate_count: number;
  ballot_count: number;
}

interface Candidate {
  id: string;
  vote_id: string;
  name: string;
  description: string | null;
  display_order: number;
}

interface MemberSearchResult {
  id: string;
  name: string;
  phone: string | null;
  pasture_name: string | null;
  grassland_name: string | null;
  plain_name: string | null;
}

interface ResultRow {
  candidate_id: string;
  candidate_name: string;
  display_order: number;
  vote_count: number;
  total_ballots: number;
  vote_rate_pct: number;
}

type Modal =
  | { type: "create" }
  | { type: "edit"; vote: Vote }
  | { type: "candidates"; vote: Vote }
  | { type: "results"; vote: Vote }
  | null;

function fmtKST(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalDatetimeInput(iso: string) {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - offset);
  return local.toISOString().slice(0, 16);
}

export default function AdminVotesPage() {
  const router = useRouter();
  const [authOk, setAuthOk] = useState(false);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>(null);

  // 폼 상태
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // 후보자 관리
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candName, setCandName] = useState("");
  const [candDesc, setCandDesc] = useState("");
  const [candSaving, setCandSaving] = useState(false);

  // 후보 이름 DB 검색
  const [memberResults, setMemberResults] = useState<MemberSearchResult[]>([]);
  const [memberSearched, setMemberSearched] = useState(false);
  const [memberSearching, setMemberSearching] = useState(false);
  const skipMemberSearchRef = useRef(false);

  // 결과
  const [results, setResults] = useState<ResultRow[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("get_my_status");
      const profile = data?.[0];
      if (!profile || !["admin", "office", "pastor"].includes(profile.role)) {
        router.replace("/home");
        return;
      }
      setAuthOk(true);
      await loadVotes();
    })();
  }, [router]);

  async function loadVotes() {
    setLoading(true);
    const { data } = await supabase.rpc("admin_get_votes");
    setVotes(data || []);
    setLoading(false);
  }

  function openCreate() {
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    setFormTitle("");
    setFormDesc("");
    setFormStart(toLocalDatetimeInput(now.toISOString()));
    setFormEnd(toLocalDatetimeInput(weekLater.toISOString()));
    setFormError("");
    setModal({ type: "create" });
  }

  function openEdit(vote: Vote) {
    setFormTitle(vote.title);
    setFormDesc(vote.description || "");
    setFormStart(toLocalDatetimeInput(vote.start_at));
    setFormEnd(toLocalDatetimeInput(vote.end_at));
    setFormError("");
    setModal({ type: "edit", vote });
  }

  async function openCandidates(vote: Vote) {
    setModal({ type: "candidates", vote });
    skipMemberSearchRef.current = true;
    setCandName("");
    setCandDesc("");
    setMemberResults([]);
    setMemberSearched(false);
    const { data } = await supabase
      .from("vote_candidates")
      .select("*")
      .eq("vote_id", vote.id)
      .order("display_order");
    setCandidates(data || []);
  }

  // 후보 이름 입력 → DB 검색 (debounce 250ms)
  useEffect(() => {
    if (modal?.type !== "candidates") return;
    if (skipMemberSearchRef.current) {
      skipMemberSearchRef.current = false;
      return;
    }
    const q = candName.trim();
    if (!q) {
      setMemberResults([]);
      setMemberSearched(false);
      setMemberSearching(false);
      return;
    }
    setMemberSearching(true);
    const handle = setTimeout(async () => {
      const { data } = await supabase.rpc("admin_search_members_paged", {
        p_query: q,
        p_plain: null,
        p_grassland: null,
        p_pasture: null,
        p_offset: 0,
        p_limit: 10,
        p_show_children: true,
        p_show_parents: true,
      });
      setMemberResults((data as MemberSearchResult[]) || []);
      setMemberSearched(true);
      setMemberSearching(false);
    }, 250);
    return () => clearTimeout(handle);
  }, [candName, modal]);

  function pickMember(m: MemberSearchResult) {
    skipMemberSearchRef.current = true;
    setCandName(m.name);
    setMemberResults([]);
    setMemberSearched(false);
    const scope = [m.plain_name, m.grassland_name, m.pasture_name].filter(Boolean).join(" / ");
    if (scope && !candDesc.trim()) setCandDesc(scope);
  }

  async function openResults(vote: Vote) {
    setModal({ type: "results", vote });
    setResultsLoading(true);
    const { data } = await supabase.rpc("admin_get_vote_results", { p_vote_id: vote.id });
    setResults(data || []);
    setResultsLoading(false);
  }

  async function handleSaveVote() {
    if (!formTitle.trim()) { setFormError("투표 제목을 입력하세요."); return; }
    if (!formStart || !formEnd) { setFormError("기간을 설정하세요."); return; }
    if (new Date(formStart) >= new Date(formEnd)) { setFormError("종료일이 시작일보다 늦어야 합니다."); return; }

    setFormSaving(true);
    setFormError("");
    try {
      if (modal?.type === "create") {
        await supabase.rpc("admin_create_vote", {
          p_title: formTitle.trim(),
          p_description: formDesc.trim() || null,
          p_start_at: new Date(formStart).toISOString(),
          p_end_at: new Date(formEnd).toISOString(),
        });
      } else if (modal?.type === "edit") {
        await supabase.rpc("admin_update_vote", {
          p_vote_id: modal.vote.id,
          p_title: formTitle.trim(),
          p_description: formDesc.trim() || null,
          p_start_at: new Date(formStart).toISOString(),
          p_end_at: new Date(formEnd).toISOString(),
          p_is_active: modal.vote.is_active,
        });
      }
      setModal(null);
      await loadVotes();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "저장 실패");
    }
    setFormSaving(false);
  }

  async function handleToggleActive(vote: Vote) {
    await supabase.rpc("admin_update_vote", {
      p_vote_id: vote.id,
      p_title: vote.title,
      p_description: vote.description,
      p_start_at: vote.start_at,
      p_end_at: vote.end_at,
      p_is_active: !vote.is_active,
    });
    await loadVotes();
  }

  async function handleDeleteVote(vote: Vote) {
    if (!confirm(`"${vote.title}" 투표를 삭제하시겠습니까?\n투표 기록도 모두 삭제됩니다.`)) return;
    await supabase.rpc("admin_delete_vote", { p_vote_id: vote.id });
    await loadVotes();
  }

  async function handleAddCandidate() {
    if (!candName.trim() || modal?.type !== "candidates") return;
    setCandSaving(true);
    const nextOrder = candidates.length;
    await supabase.rpc("admin_add_vote_candidate", {
      p_vote_id: modal.vote.id,
      p_name: candName.trim(),
      p_description: candDesc.trim() || null,
      p_display_order: nextOrder,
    });
    const { data } = await supabase
      .from("vote_candidates")
      .select("*")
      .eq("vote_id", modal.vote.id)
      .order("display_order");
    setCandidates(data || []);
    skipMemberSearchRef.current = true;
    setCandName("");
    setCandDesc("");
    setMemberResults([]);
    setMemberSearched(false);
    setCandSaving(false);
    await loadVotes();
  }

  async function handleDeleteCandidate(c: Candidate) {
    if (!confirm(`"${c.name}" 후보를 삭제하시겠습니까?`)) return;
    await supabase.rpc("admin_delete_vote_candidate", { p_candidate_id: c.id });
    setCandidates(prev => prev.filter(x => x.id !== c.id));
    await loadVotes();
  }

  if (!authOk) {
    return (
      <div style={centerStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ color: "#64748b", fontSize: 14 }}>로딩 중...</div>
      </div>
    );
  }

  const now = new Date();

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* 헤더 */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e2e8f0",
        padding: "14px 24px", display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={() => router.push("/home")} style={iconBtnStyle}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>🗳️ 투표 관리</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>항존직 선거 · 기타 투표</div>
        </div>
        <button onClick={openCreate} style={primaryBtnStyle}>
          + 새 투표 만들기
        </button>
      </div>

      {/* 투표 목록 */}
      <div style={{ maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>불러오는 중...</div>
        ) : votes.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 48, background: "#fff",
            borderRadius: 16, border: "1px solid #e2e8f0", color: "#94a3b8",
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗳️</div>
            <div style={{ fontWeight: 700 }}>등록된 투표가 없습니다</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>상단 <b style={{ color: "#6366f1" }}>+ 새 투표 만들기</b> 버튼으로 먼저 투표를 생성해 주세요.</div>
            <div style={{ fontSize: 12, marginTop: 6, color: "#64748b" }}>후보자 등록은 투표 만들기 후 등록 가능합니다.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {votes.map(vote => {
              const started = now >= new Date(vote.start_at);
              const ended = now > new Date(vote.end_at);
              const running = started && !ended && vote.is_active;

              let statusLabel = "대기";
              let statusColor = "#94a3b8";
              let statusBg = "#f1f5f9";
              if (!vote.is_active) {
                statusLabel = "비활성";
                statusColor = "#94a3b8";
                statusBg = "#f1f5f9";
              } else if (ended) {
                statusLabel = "종료";
                statusColor = "#6b7280";
                statusBg = "#f3f4f6";
              } else if (running) {
                statusLabel = "진행 중";
                statusColor = "#059669";
                statusBg = "#d1fae5";
              } else if (vote.is_active && !started) {
                statusLabel = "예정";
                statusColor = "#d97706";
                statusBg = "#fef3c7";
              }

              return (
                <div key={vote.id} style={{
                  background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0",
                  padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                          color: statusColor, background: statusBg,
                        }}>{statusLabel}</span>
                        <span style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>{vote.title}</span>
                      </div>
                      {vote.description && (
                        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{vote.description}</div>
                      )}
                      <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <span>📅 {fmtKST(vote.start_at)} ~ {fmtKST(vote.end_at)}</span>
                        <span>👤 후보 {vote.candidate_count}명</span>
                        <span>🗳️ 투표 {vote.ballot_count}표</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        onClick={() => handleToggleActive(vote)}
                        style={{
                          ...smallBtnStyle,
                          background: vote.is_active ? "#fef2f2" : "#f0fdf4",
                          color: vote.is_active ? "#b91c1c" : "#15803d",
                          border: `1px solid ${vote.is_active ? "#fecaca" : "#bbf7d0"}`,
                        }}
                      >
                        {vote.is_active ? "⏸ 비활성" : "▶ 활성화"}
                      </button>
                      <button onClick={() => openCandidates(vote)} style={smallBtnStyle}>
                        👤 후보관리
                      </button>
                      <button onClick={() => openResults(vote)} style={{ ...smallBtnStyle, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                        📊 결과보기
                      </button>
                      <button onClick={() => openEdit(vote)} style={smallBtnStyle}>
                        ✏️ 수정
                      </button>
                      <button onClick={() => handleDeleteVote(vote)} style={{ ...smallBtnStyle, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
                        🗑 삭제
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 투표 생성/수정 모달 */}
      {(modal?.type === "create" || modal?.type === "edit") && (
        <ModalOverlay onClose={() => setModal(null)}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 20 }}>
            {modal.type === "create" ? "새 투표 만들기" : "투표 수정"}
          </div>

          <label style={labelStyle}>투표 제목 *</label>
          <input
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
            placeholder="예) 2026년 항존직 선출 투표"
            style={inputStyle}
          />

          <label style={labelStyle}>설명 (선택)</label>
          <textarea
            value={formDesc}
            onChange={e => setFormDesc(e.target.value)}
            placeholder="투표 안내 사항을 입력하세요"
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>시작 일시 *</label>
              <input type="datetime-local" value={formStart} onChange={e => setFormStart(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>종료 일시 *</label>
              <input type="datetime-local" value={formEnd} onChange={e => setFormEnd(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {formError && <div style={{ color: "#b91c1c", fontSize: 12, marginBottom: 8 }}>{formError}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button onClick={() => setModal(null)} style={cancelBtnStyle}>취소</button>
            <button onClick={handleSaveVote} disabled={formSaving} style={primaryBtnStyle}>
              {formSaving ? "저장 중..." : "저장"}
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* 후보자 관리 모달 */}
      {modal?.type === "candidates" && (
        <ModalOverlay onClose={() => setModal(null)}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 4 }}>
            👤 후보자 관리
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>{modal.vote.title}</div>

          {/* 기존 후보 목록 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20, maxHeight: 260, overflowY: "auto" }}>
            {candidates.length === 0 ? (
              <div style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 13 }}>후보자가 없습니다</div>
            ) : (
              candidates.map((c, i) => (
                <div key={c.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", background: "#f8fafc", borderRadius: 10,
                  border: "1px solid #e2e8f0",
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#6366f1", width: 20 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</div>
                    {c.description && <div style={{ fontSize: 11, color: "#64748b" }}>{c.description}</div>}
                  </div>
                  <button
                    onClick={() => handleDeleteCandidate(c)}
                    style={{ ...smallBtnStyle, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", padding: "4px 10px" }}
                  >삭제</button>
                </div>
              ))
            )}
          </div>

          {/* 후보 추가 폼 */}
          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>후보 추가</div>
            <label style={labelStyle}>이름 *</label>
            <input
              value={candName}
              onChange={e => setCandName(e.target.value)}
              placeholder="후보자 이름 (DB에서 검색)"
              style={{ ...inputStyle, marginBottom: 4 }}
              onKeyDown={e => { if (e.key === "Enter") handleAddCandidate(); }}
            />

            {/* 검색 결과 / 검색 상태 */}
            {candName.trim() && (
              <div style={{ marginBottom: 12 }}>
                {memberSearching ? (
                  <div style={{ fontSize: 11, color: "#94a3b8", padding: "6px 4px" }}>검색 중...</div>
                ) : memberResults.length > 0 ? (
                  <div style={{
                    border: "1px solid #e2e8f0", borderRadius: 10,
                    maxHeight: 180, overflowY: "auto", background: "#fff",
                  }}>
                    {memberResults.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => pickMember(m)}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: "8px 12px", background: "transparent",
                          border: "none", borderBottom: "1px solid #f1f5f9",
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                          {m.name}
                          {m.phone && <span style={{ fontSize: 11, fontWeight: 400, color: "#94a3b8", marginLeft: 8 }}>{m.phone}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {[m.plain_name, m.grassland_name, m.pasture_name].filter(Boolean).join(" / ") || "-"}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : memberSearched ? (
                  <div style={{
                    fontSize: 12, color: "#94a3b8",
                    background: "#f8fafc", border: "1px solid #e2e8f0",
                    borderRadius: 8, padding: "8px 12px",
                  }}>
                    등록된 교인이 없습니다. 그래도 등록하시겠습니까?
                  </div>
                ) : null}
              </div>
            )}

            <label style={labelStyle}>설명 (선택)</label>
            <input
              value={candDesc}
              onChange={e => setCandDesc(e.target.value)}
              placeholder="예) 1목장 장로 후보"
              style={inputStyle}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setModal(null)} style={cancelBtnStyle}>닫기</button>
              <button onClick={handleAddCandidate} disabled={candSaving || !candName.trim()} style={primaryBtnStyle}>
                {candSaving ? "추가 중..." : "+ 후보 추가"}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* 결과 모달 */}
      {modal?.type === "results" && (
        <ModalOverlay onClose={() => setModal(null)}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b", marginBottom: 4 }}>
            📊 투표 결과
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>{modal.vote.title}</div>

          {resultsLoading ? (
            <div style={{ textAlign: "center", padding: 32, color: "#94a3b8" }}>집계 중...</div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "#94a3b8" }}>집계할 후보 또는 투표 기록이 없습니다.</div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                총 {results[0]?.total_ballots ?? 0}명 참여
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {results.map((r, i) => (
                  <div key={r.candidate_id} style={{
                    padding: "12px 14px", background: i === 0 ? "#eff6ff" : "#f8fafc",
                    borderRadius: 10, border: `1px solid ${i === 0 ? "#bfdbfe" : "#e2e8f0"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: i === 0 ? "#1d4ed8" : "#374151" }}>
                        {i + 1}위 {r.candidate_name}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "#6366f1" }}>
                        {r.vote_count}표 ({r.vote_rate_pct}%)
                      </span>
                    </div>
                    <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 4,
                        background: i === 0 ? "#3b82f6" : "#a5b4fc",
                        width: `${r.vote_rate_pct}%`,
                        transition: "width 0.6s ease",
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
            <button onClick={() => setModal(null)} style={cancelBtnStyle}>닫기</button>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 20,
          padding: 28, width: "100%", maxWidth: 540,
          maxHeight: "90vh", overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── 스타일 상수 ───────────────────────────────────────
const centerStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center",
  justifyContent: "center", background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const primaryBtnStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "10px 18px", borderRadius: 10,
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", cursor: "pointer",
  fontSize: 13, fontWeight: 700, fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "10px 18px", borderRadius: 10,
  background: "#f1f5f9", color: "#374151",
  border: "1px solid #e2e8f0", cursor: "pointer",
  fontSize: 13, fontWeight: 600, fontFamily: "inherit",
};

const smallBtnStyle: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 8,
  background: "#f8fafc", color: "#374151",
  border: "1px solid #e2e8f0", cursor: "pointer",
  fontSize: 12, fontWeight: 600, fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const iconBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 9,
  background: "#f1f5f9", border: "none",
  cursor: "pointer", fontSize: 16, color: "#475569",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 700,
  color: "#374151", marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10,
  border: "1.5px solid #e2e8f0", fontSize: 13,
  fontFamily: "inherit", outline: "none", marginBottom: 12,
  boxSizing: "border-box",
};
