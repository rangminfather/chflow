"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView } from "@/components/StatusViews";

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
  const [canManageVotes, setCanManageVotes] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthOk(true);
      const { data: profileData } = await supabase.rpc("get_my_status");
      const profile = profileData?.[0];
      setCanManageVotes(Boolean(profile && ["admin", "office", "pastor"].includes(profile.role)));
      const { data } = await supabase.rpc("get_active_votes");
      setVotes(data || []);
      setLoading(false);
    })();
  }, [router]);

  if (!authOk) {
    return (
      <div style={centerStyle}>
        <LoadingView />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" }}>

      {/* 헤더 */}
      <div style={{
        background: "#fff", borderBottom: "1px solid var(--hairline)",
        padding: "14px 24px", display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={() => router.push("/home")} style={iconBtnStyle}>←</button>
        <HeaderLogo />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)" }}>🗳️ 투표</div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>진행 중인 투표에 참여하세요</div>
        </div>
        {canManageVotes && (
          <button onClick={() => router.push("/admin/votes")} style={manageBtnStyle}>
            투표 관리
          </button>
        )}
      </div>

      <div style={{ maxWidth: 600, margin: "24px auto", padding: "0 16px" }}>
        {loading ? (
          <LoadingView padding={48} label="불러오는 중..." />
        ) : votes.length === 0 ? (
          <div style={{
            textAlign: "center", padding: 56, background: "#fff",
            borderRadius: 20, border: "1px solid var(--hairline)",
          }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🗳️</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginBottom: 6 }}>진행 중인 투표가 없습니다</div>
            <div style={{ fontSize: 13, color: "var(--ink-faint)" }}>투표가 시작되면 여기에 표시됩니다.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {votes.map(vote => (
              <div
                key={vote.id}
                onClick={() => !vote.already_voted && router.push(`/vote/${vote.id}`)}
                style={{
                  background: "#fff", borderRadius: 16,
                  border: `1.5px solid ${vote.already_voted ? "var(--success-soft)" : "var(--accent-line)"}`,
                  padding: "20px 22px",
                  cursor: vote.already_voted ? "default" : "pointer",
                  transition: "box-shadow 0.2s",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                    background: vote.already_voted ? "var(--success-soft)" : "linear-gradient(135deg, var(--accent), var(--accent-muted))",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22,
                  }}>
                    {vote.already_voted ? "✅" : "🗳️"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginBottom: 4 }}>
                      {vote.title}
                    </div>
                    {vote.description && (
                      <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 6 }}>{vote.description}</div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--ink-faint)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span>~{fmtKST(vote.end_at)}</span>
                      <span style={{
                        fontWeight: 700,
                        color: vote.already_voted ? "var(--success)" : "var(--warning)",
                      }}>
                        {vote.already_voted ? "투표 완료" : daysLeft(vote.end_at)}
                      </span>
                    </div>
                  </div>
                  {!vote.already_voted && (
                    <div style={{
                      padding: "8px 16px", borderRadius: 10,
                      background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
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
  justifyContent: "center", background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const iconBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 9,
  background: "var(--bg-soft)", border: "none",
  cursor: "pointer", fontSize: 16, color: "var(--ink-mid)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const manageBtnStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 10,
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 800,
  padding: "10px 14px",
  whiteSpace: "nowrap",
};
