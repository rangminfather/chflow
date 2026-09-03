"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, HeartHandshake, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import {
  PastureEmpty,
  PastureShell,
  cardStyle,
  primaryButtonStyle,
  sectionTitleStyle,
} from "@/components/PastureShell";
import { fetchPastureIntroduction, type PastureExploreRow } from "@/lib/pasture";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function PastureIntroductionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const pastureId = params.id;
  const [authChecked, setAuthChecked] = useState(false);
  const [pasture, setPasture] = useState<PastureExploreRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
      if (!UUID_PATTERN.test(pastureId)) {
        setLoading(false);
        return;
      }
      try {
        setPasture(await fetchPastureIntroduction(pastureId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "목장 소개를 불러오지 못했습니다");
      } finally {
        setLoading(false);
      }
    })();
  }, [pastureId, router]);

  if (!authChecked) return <main style={{ minHeight: "100vh" }}><LoadingView full /></main>;

  const hierarchy = pasture
    ? [pasture.plain_name, pasture.grassland_name && `${pasture.grassland_name}초원`].filter(Boolean).join(" · ")
    : "목장";

  return (
    <PastureShell
      eyebrow={hierarchy || "목장"}
      title={pasture ? `${pasture.pasture_name}목장` : "목장 소개"}
      chip={pasture?.mission_area ? `선교후원 ${pasture.mission_area}` : undefined}
    >
      {loading ? (
        <div style={cardStyle}><LoadingView /></div>
      ) : error ? (
        <PastureEmpty title="목장 소개를 불러오지 못했습니다" hint={error} />
      ) : !pasture ? (
        <PastureEmpty title="목장을 찾을 수 없습니다" hint="삭제되었거나 잘못된 목장 주소입니다." />
      ) : (
        <>
          <article style={introCardStyle}>
            <div style={sectionTitleStyle}>목장 소개</div>
            <div style={introLeadStyle}>{pasture.pasture_name}목장에 오신 것을 환영합니다.</div>
            <p style={paragraphStyle}>
              {hierarchy
                ? `${pasture.pasture_name}목장은 ${hierarchy}에 속한 목장 공동체입니다.`
                : `${pasture.pasture_name}목장은 함께 예배하고 삶을 나누는 목장 공동체입니다.`}
              {" "}목장 식구들이 말씀과 기도로 교제하며 서로의 삶을 돌아보고 함께 성장합니다.
            </p>
            {pasture.mission_area && (
              <p style={paragraphStyle}>
                또한 {pasture.mission_area} 선교지를 품고 기도하며 선교 사역을 후원하고 있습니다.
              </p>
            )}
          </article>

          <div style={cardStyle}>
            <div style={sectionTitleStyle}>목장 정보</div>
            <InfoRow icon={<HeartHandshake size={18} strokeWidth={1.8} />} label="소속" value={hierarchy || "정보 없음"} />
            <InfoRow
              icon={<MapPin size={18} strokeWidth={1.8} />}
              label="선교후원"
              value={pasture.mission_area || "등록된 정보가 없습니다"}
            />
          </div>

          <div style={futureCardStyle}>
            <CalendarDays size={19} strokeWidth={1.8} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>목장 정보를 자동으로 구성합니다</div>
              <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.55 }}>
                현재 등록된 목장 정보로 소개를 만들며, 앞으로 목장모임의 일정과 활동 정보도 이 화면에 연결할 수 있습니다.
              </div>
            </div>
          </div>

          <button type="button" onClick={() => router.push("/pasture/explore")} style={{ ...primaryButtonStyle, width: "100%" }}>
            다른 목장 둘러보기
          </button>
        </>
      )}
    </PastureShell>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={infoRowStyle}>
      <span style={{ color: "var(--accent)", display: "inline-flex" }}>{icon}</span>
      <span style={{ width: 68, color: "var(--ink-faint)", fontSize: 12.5, fontWeight: 700 }}>{label}</span>
      <span style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

const introCardStyle: React.CSSProperties = {
  ...cardStyle,
  padding: "22px 20px",
};

const introLeadStyle: React.CSSProperties = {
  marginBottom: 12,
  fontSize: 20,
  lineHeight: 1.45,
  fontWeight: 800,
};

const paragraphStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "var(--ink-soft)",
  fontSize: 14.5,
  lineHeight: 1.85,
  wordBreak: "keep-all",
};

const infoRowStyle: React.CSSProperties = {
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  gap: 9,
  borderBottom: "1px solid var(--hairline)",
};

const futureCardStyle: React.CSSProperties = {
  ...cardStyle,
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  background: "var(--accent-soft)",
};
