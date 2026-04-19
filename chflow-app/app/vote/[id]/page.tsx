"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface VoteRow {
  vote_id: string;
  vote_title: string;
  vote_desc: string | null;
  start_at: string;
  end_at: string;
  is_active: boolean;
  already_voted: boolean;
  my_candidate_id: string | null;
  candidate_id: string;
  candidate_name: string;
  candidate_desc: string | null;
  display_order: number;
}

interface Candidate {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
}

function fmtKST(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VoteBallotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: voteId } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [voteTitle, setVoteTitle] = useState("");
  const [voteDesc, setVoteDesc] = useState<string | null>(null);
  const [endAt, setEndAt] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [myCandidateId, setMyCandidateId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }

      const { data, error: rpcErr } = await supabase.rpc("get_vote_detail", { p_vote_id: voteId });

      if (rpcErr || !data || data.length === 0) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const rows: VoteRow[] = data;
      const first = rows[0];
      setVoteTitle(first.vote_title);
      setVoteDesc(first.vote_desc);
      setEndAt(first.end_at);
      setIsActive(first.is_active);
      setAlreadyVoted(first.already_voted);
      setMyCandidateId(first.my_candidate_id);

      const cands: Candidate[] = rows.map(r => ({
        id: r.candidate_id,
        name: r.candidate_name,
        description: r.candidate_desc,
        display_order: r.display_order,
      }));
      setCandidates(cands);
      setLoading(false);
    })();
  }, [voteId, router]);

  async function handleSubmit() {
    if (!selected) { setError("후보를 선택해주세요."); return; }
    setSubmitting(true);
    setError("");
    try {
      const { error: rpcErr } = await supabase.rpc("cast_vote", {
        p_vote_id: voteId,
        p_candidate_id: selected,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      setAlreadyVoted(true);
      setMyCandidateId(selected);
      setSuccess(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "투표 제출에 실패했습니다.");
    }
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div style={centerStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ color: "#64748b", fontSize: 14 }}>로딩 중...</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={centerStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32 }}>🔍</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginTop: 8 }}>투표를 찾을 수 없습니다</div>
          <button onClick={() => router.push("/vote")} style={{ ...primaryBtnStyle, marginTop: 16 }}>목록으로</button>
        </div>
      </div>
    );
  }

  const now = new Date();
  const ended = now > new Date(endAt);
  const canVote = isActive && !ended && !alreadyVoted;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* 헤더 */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e2e8f0",
        padding: "14px 24px", display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={() => router.push("/vote")} style={iconBtnStyle}>←</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>🗳️ 투표 참여</div>
      </div>

      <div style={{ maxWidth: 560, margin: "24px auto", padding: "0 16px" }}>

        {/* 투표 제목 카드 */}
        <div style={{
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          borderRadius: 20, padding: "24px 24px", marginBottom: 16, color: "#fff",
        }}>
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 6 }}>{voteTitle}</div>
          {voteDesc && <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 10 }}>{voteDesc}</div>}
          <div style={{ fontSize: 11, opacity: 0.8 }}>
            마감: {fmtKST(endAt)}
            {ended && <span style={{ marginLeft: 8, background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: 99 }}>마감됨</span>}
          </div>
        </div>

        {/* 투표 완료 배너 */}
        {alreadyVoted && (
          <div style={{
            background: "#d1fae5", border: "1.5px solid #6ee7b7",
            borderRadius: 14, padding: "16px 20px", marginBottom: 16,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 24 }}>✅</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#065f46" }}>투표를 완료했습니다</div>
              {myCandidateId && (
                <div style={{ fontSize: 12, color: "#047857", marginTop: 2 }}>
                  선택: <strong>{candidates.find(c => c.id === myCandidateId)?.name}</strong>
                </div>
              )}
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>한 번 제출한 투표는 수정할 수 없습니다.</div>
            </div>
          </div>
        )}

        {/* 비활성 / 마감 안내 */}
        {!alreadyVoted && (!isActive || ended) && (
          <div style={{
            background: "#f3f4f6", border: "1px solid #e5e7eb",
            borderRadius: 14, padding: "14px 18px", marginBottom: 16,
            fontSize: 13, color: "#6b7280",
          }}>
            {ended ? "⏰ 투표 기간이 종료되었습니다." : "🔒 현재 투표가 활성화되지 않았습니다."}
          </div>
        )}

        {/* 후보 목록 */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
            후보자 목록 ({candidates.length}명)
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {candidates.map((c, i) => {
              const isMyChoice = alreadyVoted && myCandidateId === c.id;
              const isSelected = !alreadyVoted && selected === c.id;
              const highlighted = isMyChoice || isSelected;

              return (
                <div
                  key={c.id}
                  onClick={() => canVote && setSelected(c.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "16px 18px", borderRadius: 14,
                    border: `2px solid ${highlighted ? "#6366f1" : "#e2e8f0"}`,
                    background: highlighted ? "#eff6ff" : "#fff",
                    cursor: canVote ? "pointer" : "default",
                    transition: "all 0.15s",
                    boxShadow: highlighted ? "0 0 0 3px rgba(99,102,241,0.15)" : "none",
                  }}
                >
                  {/* 선택 인디케이터 */}
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    border: `2.5px solid ${highlighted ? "#6366f1" : "#cbd5e1"}`,
                    background: highlighted ? "#6366f1" : "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {highlighted && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
                  </div>

                  {/* 후보 번호 */}
                  <div style={{
                    width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                    background: highlighted ? "#6366f1" : "#f1f5f9",
                    color: highlighted ? "#fff" : "#64748b",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 800,
                  }}>
                    {i + 1}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: highlighted ? "#3730a3" : "#1e293b" }}>
                      {c.name}
                    </div>
                    {c.description && (
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{c.description}</div>
                    )}
                  </div>

                  {isMyChoice && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                      background: "#6366f1", color: "#fff",
                    }}>내 선택</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 에러 */}
        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 10, padding: "12px 16px", marginBottom: 12,
            fontSize: 13, color: "#b91c1c",
          }}>⚠️ {error}</div>
        )}

        {/* 투표 완료 성공 메시지 */}
        {success && (
          <div style={{
            background: "#d1fae5", border: "1px solid #6ee7b7",
            borderRadius: 10, padding: "12px 16px", marginBottom: 12,
            fontSize: 13, color: "#065f46", fontWeight: 700,
          }}>🎉 투표가 완료되었습니다!</div>
        )}

        {/* 제출 버튼 */}
        {canVote && !success && (
          <button
            onClick={handleSubmit}
            disabled={!selected || submitting}
            style={{
              width: "100%", padding: "16px", borderRadius: 14,
              background: selected
                ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                : "#e2e8f0",
              color: selected ? "#fff" : "#94a3b8",
              border: "none", cursor: selected ? "pointer" : "default",
              fontSize: 15, fontWeight: 800, fontFamily: "inherit",
              transition: "all 0.2s",
            }}
          >
            {submitting ? "제출 중..." : selected
              ? `"${candidates.find(c => c.id === selected)?.name}"에게 투표하기`
              : "후보를 선택해주세요"}
          </button>
        )}

        {/* 목록으로 */}
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button
            onClick={() => router.push("/vote")}
            style={{ color: "#6366f1", background: "none", border: "none", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
          >
            ← 투표 목록으로 돌아가기
          </button>
        </div>
      </div>
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center",
  justifyContent: "center", background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 22px", borderRadius: 10,
  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", cursor: "pointer",
  fontSize: 13, fontWeight: 700, fontFamily: "inherit",
};

const iconBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 9,
  background: "#f1f5f9", border: "none",
  cursor: "pointer", fontSize: 16, color: "#475569",
  display: "flex", alignItems: "center", justifyContent: "center",
};
