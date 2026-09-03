"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, MapPin, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { PastureEmpty, PastureShell, cardStyle, primaryButtonStyle } from "@/components/PastureShell";
import {
  fetchPastureDirectory,
  pastureSearchText,
  type PastureExploreRow,
} from "@/lib/pasture";

export default function PastureExplorePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [pastures, setPastures] = useState<PastureExploreRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setPastures(await fetchPastureDirectory());
    } catch (e) {
      setError(e instanceof Error ? e.message : "목장 목록을 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
      await load();
    })();
  }, [router]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("ko-KR");
    if (!keyword) return pastures;
    return pastures.filter((pasture) => pastureSearchText(pasture).includes(keyword));
  }, [pastures, query]);

  if (!authChecked) return <main style={{ minHeight: "100vh" }}><LoadingView full /></main>;

  return (
    <PastureShell eyebrow="목장" title="목장탐방" chip={!loading ? `${filtered.length}개 목장` : undefined}>
      <div style={{ ...cardStyle, padding: 12 }}>
        <label htmlFor="pasture-search" style={searchBoxStyle}>
          <Search size={19} strokeWidth={1.8} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
          <input
            id="pasture-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="목장명, 평원, 초원, 선교지역 검색"
            autoComplete="off"
            style={searchInputStyle}
          />
        </label>
      </div>

      {loading ? (
        <div style={cardStyle}><LoadingView /></div>
      ) : error ? (
        <PastureEmpty
          title="목장 목록을 불러오지 못했습니다"
          hint={error}
          action={<button type="button" onClick={load} style={primaryButtonStyle}>다시 불러오기</button>}
        />
      ) : filtered.length === 0 ? (
        <PastureEmpty title="검색 결과가 없습니다" hint="다른 목장명이나 평원·초원 이름으로 검색해 보세요." />
      ) : (
        <div aria-live="polite">
          {filtered.map((pasture) => (
            <button
              key={pasture.pasture_id}
              type="button"
              onClick={() => router.push(`/pasture/explore/${pasture.pasture_id}`)}
              style={pastureCardStyle}
            >
              <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{pasture.pasture_name}목장</div>
                <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-soft)" }}>
                  {[pasture.plain_name, pasture.grassland_name && `${pasture.grassland_name}초원`]
                    .filter(Boolean).join(" · ") || "소속 정보 없음"}
                </div>
                {pasture.mission_area && (
                  <div style={missionStyle}>
                    <MapPin size={13} strokeWidth={1.8} />
                    선교후원 {pasture.mission_area}
                  </div>
                )}
              </div>
              <ChevronRight size={19} strokeWidth={1.8} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </PastureShell>
  );
}

const searchBoxStyle: React.CSSProperties = {
  minHeight: 46,
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "0 13px",
  border: "1px solid var(--hairline)",
  borderRadius: 10,
  background: "var(--surface)",
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  border: "none",
  outline: "none",
  background: "transparent",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: 15,
};

const pastureCardStyle: React.CSSProperties = {
  ...cardStyle,
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 12,
  color: "var(--ink)",
  fontFamily: "inherit",
  cursor: "pointer",
};

const missionStyle: React.CSSProperties = {
  width: "fit-content",
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginTop: 8,
  padding: "4px 8px",
  borderRadius: 999,
  background: "var(--accent-soft)",
  color: "var(--accent)",
  fontSize: 11.5,
  fontWeight: 700,
};
