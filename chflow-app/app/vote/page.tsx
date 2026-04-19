"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface ActiveVote {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  already_voted: boolean;
}

function fmtKST(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysLeft(end: string) {
  const diff = new Date(end).getTime() - Date.now();
  if (diff <= 0) return "마감";
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}시간 남음`;
  return `${Math.floor(h / 24)}일 남음`;
}

export default function VoteListPage() {
  const router = useRouter();
  const [authOk, setAuthOk] = useState(false);
  const [votes, setVotes] = useState<ActiveVote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthOk(true);
      const { data } = await supabase.rpc("get_active_votes");
      setVotes(data || []);
      setLoading(false);
    })();
  }, [router]);

  if (!authOk) {
    return (
      <div style={centerStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ color: "#64748b", fontSize: 14 }}>로딩 중...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      {/* 헤더 */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #e2e8f0",
        padding: "14px 24px", display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={() => router.push("/home")} style={iconBtnStyle}>←</button>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>🗳️ 투표</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>진행 중인 투표에 참여하세요</div>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: "24px auto", padding: "0 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 48, color: "#94a3b8" }}>불러오는 중...</div>
        ) : votes.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 56, background: "#fff",
            borderRadius: 20, border: "1px solid #e2e8f0",
          }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🗳️</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 6 }}>진행 중인 투표가 없습니다</div>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>투표가 시작되면 여기에 표시됩니다.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {votes.map(vote => (
              <div
                key={vote.id}
                onClick={() => !vote.already_voted && router.push(`/vote/${vote.id}`)}
                style={{
                  background: "#fff", borderRadius: 16,
                  border: `1.5px solid ${vote.already_voted ? "#bbf7d0" : "#c7d2fe"}`,
                  padding: "20px 22px",
                  cursor: vote.already_voted ? "default" : "pointer",
                  transition: "box-shadow 0.2s",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                    background: vote.already_voted ? "#d1fae5" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22,
                  }}>
                    {vote.already_voted ? "✅" : "🗳️"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 4 }}>
                      {vote.title}
                    </div>
                    {vote.description && (
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{vote.description}</div>
                    )}
                    <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span>~{fmtKST(vote.end_at)}</span>
                      <span style={{
                        fontWeight: 700,
                        color: vote.already_voted ? "#059669" : "#d97706",
                      }}>
                        {vote.already_voted ? "투표 완료" : daysLeft(vote.end_at)}
                      </span>
                    </div>
                  </div>
                  {!vote.already_voted && (
                    <div style={{
                      padding: "8px 16px", borderRadius: 10,
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      color: "#fff", fontSize: 12, fontWeight: 700,
                      alignSelf: "center", whiteSpace: "nowrap",
                    }}>
                      투표하기
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const centerStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center",
  justifyContent: "center", background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const iconBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 9,
  background: "#f1f5f9", border: "none",
  cursor: "pointer", fontSize: 16, color: "#475569",
  display: "flex", alignItems: "center", justifyContent: "center",
};
