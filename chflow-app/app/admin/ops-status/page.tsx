"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

interface OpsHealth {
  checked_at: string;
  members_total: number;
  active_members: number;
  not_verified_members: number;
  members_with_review_flags: number;
  total_review_flags: number;
  duplicate_legacy_members: number;
  duplicate_name_birth_members: number;
  codex_temp_profiles: number;
  ops_temp_members: number;
  pdf_needs_check: number;
  pdf_needs_household: number;
  pdf_no_photo: number;
  pdf_spouse_mismatch: number;
  pdf_bad_phone: number;
  pdf_orphan_child: number;
  pdf_duplicate_name_birth: number;
  pdf_duplicate_legacy: number;
  mdb_needs_check: number;
  mdb_needs_household: number;
  mdb_no_photo: number;
  mdb_spouse_mismatch: number;
  mdb_bad_phone: number;
  mdb_orphan_child: number;
  mdb_duplicate_name_birth: number;
  mdb_duplicate_legacy: number;
}

const riskKeys: Array<keyof OpsHealth> = [
  "not_verified_members",
  "members_with_review_flags",
  "total_review_flags",
  "duplicate_legacy_members",
  "duplicate_name_birth_members",
  "codex_temp_profiles",
  "ops_temp_members",
  "pdf_needs_check",
  "pdf_needs_household",
  "pdf_no_photo",
  "pdf_spouse_mismatch",
  "pdf_bad_phone",
  "pdf_orphan_child",
  "pdf_duplicate_name_birth",
  "pdf_duplicate_legacy",
  "mdb_needs_check",
  "mdb_needs_household",
  "mdb_no_photo",
  "mdb_spouse_mismatch",
  "mdb_bad_phone",
  "mdb_orphan_child",
  "mdb_duplicate_name_birth",
  "mdb_duplicate_legacy",
];

export default function AdminOpsStatusPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OpsHealth | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: rows, error: rpcError } = await supabase.rpc("admin_ops_health_summary");
    if (rpcError) {
      setError(rpcError.message);
      setData(null);
    } else {
      setData((rows?.[0] as OpsHealth | undefined) ?? null);
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
      if (profile?.role !== "admin") {
        router.replace("/home");
        return;
      }
      setAuthChecked(true);
      load();
    })();
  }, [load, router]);

  const riskTotal = useMemo(() => {
    if (!data) return 0;
    return riskKeys.reduce((sum, key) => sum + Number(data[key] || 0), 0);
  }, [data]);

  if (!authChecked) {
    return <div style={loadingPageStyle}>권한 확인 중...</div>;
  }

  return (
    <div style={pageStyle}>
      <div style={wrapStyle}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <h1 style={titleStyle}>운영 상태</h1>
              <div style={subTitleStyle}>검수 잔여값, 중복, 임시 데이터 상태</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={load} disabled={loading} style={buttonStyle}>
              {loading ? "확인 중" : "새로고침"}
            </button>
            <button onClick={() => router.push("/admin/members")} style={ghostButtonStyle}>회원관리</button>
            <button onClick={() => router.push("/home")} style={ghostButtonStyle}>홈</button>
          </div>
        </header>

        {error && <div style={errorStyle}>{error}</div>}

        {loading && !data ? (
          <div style={emptyStyle}>상태를 불러오는 중...</div>
        ) : data ? (
          <>
            <section style={heroStyle}>
              <div>
                <div style={stateLabelStyle}>전체 상태</div>
                <div style={{ ...stateTextStyle, color: riskTotal === 0 ? "var(--success)" : "var(--warning)" }}>
                  {riskTotal === 0 ? "정상" : "확인 필요"}
                </div>
                <div style={subTitleStyle}>
                  마지막 확인: {formatDate(data.checked_at)}
                </div>
              </div>
              <div style={heroStatsStyle}>
                <Metric label="전체 회원" value={data.members_total} />
                <Metric label="활성 회원" value={data.active_members} />
                <Metric label="잔여 리스크" value={riskTotal} tone={riskTotal === 0 ? "good" : "warn"} />
              </div>
            </section>

            <section style={gridStyle}>
              <Panel title="검수 상태">
                <StatusRow label="미확정 회원" value={data.not_verified_members} />
                <StatusRow label="플래그 보유 회원" value={data.members_with_review_flags} />
                <StatusRow label="전체 플래그" value={data.total_review_flags} />
              </Panel>

              <Panel title="중복">
                <StatusRow label="Legacy ID 중복" value={data.duplicate_legacy_members} />
                <StatusRow label="이름+생년월일 중복" value={data.duplicate_name_birth_members} />
              </Panel>

              <Panel title="임시 데이터">
                <StatusRow label="Codex 임시 계정" value={data.codex_temp_profiles} />
                <StatusRow label="운영점검 임시 회원" value={data.ops_temp_members} />
              </Panel>
            </section>

            <section style={gridStyle}>
              <Panel title="PDF 검수 필터">
                <StatusRow label="보류" value={data.pdf_needs_check} />
                <StatusRow label="가구/목장 필요" value={data.pdf_needs_household} />
                <StatusRow label="사진 없음" value={data.pdf_no_photo} />
                <StatusRow label="배우자 불일치" value={data.pdf_spouse_mismatch} />
                <StatusRow label="전화번호 이상" value={data.pdf_bad_phone} />
                <StatusRow label="부모 미연결" value={data.pdf_orphan_child} />
                <StatusRow label="이름+생년월일 중복" value={data.pdf_duplicate_name_birth} />
                <StatusRow label="Legacy ID 중복" value={data.pdf_duplicate_legacy} />
              </Panel>

              <Panel title="MDB 검수 필터">
                <StatusRow label="보류" value={data.mdb_needs_check} />
                <StatusRow label="가구/목장 필요" value={data.mdb_needs_household} />
                <StatusRow label="사진 없음" value={data.mdb_no_photo} />
                <StatusRow label="배우자 불일치" value={data.mdb_spouse_mismatch} />
                <StatusRow label="전화번호 이상" value={data.mdb_bad_phone} />
                <StatusRow label="부모 미연결" value={data.mdb_orphan_child} />
                <StatusRow label="이름+생년월일 중복" value={data.mdb_duplicate_name_birth} />
                <StatusRow label="Legacy ID 중복" value={data.mdb_duplicate_legacy} />
              </Panel>
            </section>
          </>
        ) : (
          <div style={emptyStyle}>표시할 상태 정보가 없습니다.</div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "base" }: { label: string; value: number; tone?: "base" | "good" | "warn" }) {
  const color = tone === "good" ? "var(--success)" : tone === "warn" ? "var(--warning)" : "var(--ink)";
  return (
    <div style={metricStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ ...metricValueStyle, color }}>{value.toLocaleString()}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={panelStyle}>
      <h2 style={panelTitleStyle}>{title}</h2>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </section>
  );
}

function StatusRow({ label, value }: { label: string; value: number }) {
  const ok = value === 0;
  return (
    <div style={rowStyle}>
      <span style={rowLabelStyle}>{label}</span>
      <span style={{ ...badgeStyle, background: ok ? "var(--success-soft)" : "var(--warning-soft)", color: ok ? "var(--success)" : "var(--warning)" }}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

const loadingPageStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
  padding: 16,
};

const wrapStyle: React.CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: "16px 18px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 14,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 800,
  color: "var(--ink)",
};

const subTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--ink-soft)",
  marginTop: 3,
};

const buttonStyle: React.CSSProperties = {
  padding: "9px 13px",
  background: "var(--accent)",
  color: "#fff",
  border: 0,
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
};

const ghostButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "var(--surface)",
  color: "var(--ink-mid)",
  border: "1px solid var(--hairline-strong)",
};

const errorStyle: React.CSSProperties = {
  background: "var(--danger-soft)",
  border: "1px solid var(--danger-soft)",
  color: "var(--danger)",
  borderRadius: 8,
  padding: 12,
  marginBottom: 14,
  fontSize: 13,
};

const emptyStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: 28,
  textAlign: "center",
  color: "var(--ink-soft)",
};

const heroStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: 18,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 14,
};

const stateLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "var(--ink-soft)",
};

const stateTextStyle: React.CSSProperties = {
  fontSize: 34,
  fontWeight: 800,
  lineHeight: 1.1,
  marginTop: 4,
};

const heroStatsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(120px, 1fr))",
  gap: 10,
  flex: "1 1 420px",
  maxWidth: 520,
};

const metricStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: 12,
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--ink-soft)",
  fontWeight: 800,
};

const metricValueStyle: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1.15,
  fontWeight: 800,
  marginTop: 5,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: 14,
  marginBottom: 14,
};

const panelStyle: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--hairline)",
  borderRadius: 8,
  padding: 16,
};

const panelTitleStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 15,
  fontWeight: 800,
  color: "var(--ink)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "8px 0",
  borderBottom: "1px solid var(--bg-soft)",
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--ink-mid)",
  fontWeight: 700,
};

const badgeStyle: React.CSSProperties = {
  minWidth: 44,
  textAlign: "center",
  borderRadius: 999,
  padding: "3px 9px",
  fontSize: 12,
  fontWeight: 800,
};
