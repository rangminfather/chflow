"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

type Crop = {
  source_file: string;
  photo_page: number;
  photo_index: number;
  source_url: string;
  pdf_name: string | null;
  pdf_phone: string | null;
  expected_member_id: string | null;
  expected_member_name?: string | null;
};

type ReviewMember = {
  id: string;
  name: string;
  phone: string | null;
  sub_role: string | null;
  source_page: number | null;
  photo_page: number | null;
  photo_url: string | null;
  photo_status: string | null;
  review_status: string | null;
  expected_crop_url: string | null;
  expected_source_file: string | null;
  expected_pdf_name: string | null;
  expected_pdf_phone: string | null;
  candidates: Crop[] | null;
  total_count: number;
};

const PAGE_SIZE = 24;

export default function AdminPhotoReviewPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<ReviewMember[]>([]);
  const [selected, setSelected] = useState<ReviewMember | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "has_photo" | "no_photo" | "has_expected" | "needs_source">("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [cropQuery, setCropQuery] = useState("");
  const [cropResults, setCropResults] = useState<Crop[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastPhotoUrl, setLastPhotoUrl] = useState<string | null | undefined>(undefined);

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
      loadMembers(1, query, filter);
      searchCrops("");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadMembers(nextPage = page, nextQuery = query, nextFilter = filter) {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_photo_review_members", {
      p_query: nextQuery || null,
      p_filter: nextFilter,
      p_offset: (nextPage - 1) * PAGE_SIZE,
      p_limit: PAGE_SIZE,
    });
    if (error) {
      alert(`사진 검수 목록 조회 실패: ${error.message}`);
      setMembers([]);
      setTotal(0);
    } else {
      const rows = dedupeReviewMembers((data || []) as ReviewMember[]);
      setMembers(rows);
      setTotal(Number(rows[0]?.total_count || 0));
      setSelected((current) => {
        if (current && rows.some((row) => row.id === current.id)) {
          return rows.find((row) => row.id === current.id) || current;
        }
        return rows[0] || null;
      });
    }
    setLoading(false);
  }

  async function searchCrops(nextQuery = cropQuery) {
    const { data, error } = await supabase.rpc("admin_photo_crop_search", {
      p_query: nextQuery || null,
      p_limit: 60,
    });
    if (error) {
      alert(`후보 검색 실패: ${error.message}`);
      setCropResults([]);
    } else {
      setCropResults((data || []) as Crop[]);
    }
  }

  async function setMemberPhoto(crop: Crop) {
    if (!selected) return;
    const ok = confirm(`${selected.name} 사진을 ${crop.pdf_name || crop.source_file} 후보로 변경할까요?`);
    if (!ok) return;
    setSaving(true);
    setLastPhotoUrl(selected.photo_url);
    const { error } = await supabase.rpc("admin_set_member_photo", {
      p_member_id: selected.id,
      p_photo_url: crop.source_url,
    });
    if (error) {
      alert(`사진 변경 실패: ${error.message}`);
    } else {
      const updated = { ...selected, photo_url: crop.source_url, photo_status: "matched" };
      setSelected(updated);
      setMembers((prev) => prev.map((row) => row.id === selected.id ? updated : row));
    }
    setSaving(false);
  }

  async function restoreLastPhoto() {
    if (!selected || lastPhotoUrl === undefined) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_set_member_photo", {
      p_member_id: selected.id,
      p_photo_url: lastPhotoUrl,
    });
    if (error) {
      alert(`되돌리기 실패: ${error.message}`);
    } else {
      const updated = { ...selected, photo_url: lastPhotoUrl };
      setSelected(updated);
      setMembers((prev) => prev.map((row) => row.id === selected.id ? updated : row));
      setLastPhotoUrl(undefined);
    }
    setSaving(false);
  }

  async function markNoPhoto() {
    if (!selected) return;
    const ok = confirm(`${selected.name} 회원은 원본 요람에 등록 사진이 없는 것으로 표시할까요?`);
    if (!ok) return;
    setSaving(true);
    setLastPhotoUrl(selected.photo_url);
    const { error } = await supabase.rpc("admin_mark_member_no_photo", {
      p_member_id: selected.id,
    });
    if (error) {
      alert(`사진 없음 처리 실패: ${error.message}`);
    } else {
      const updated = { ...selected, photo_url: null, photo_status: "no_photo_in_pdf" };
      setSelected(updated);
      setMembers((prev) => prev.map((row) => row.id === selected.id ? updated : row));
    }
    setSaving(false);
  }

  const samePageCandidates = useMemo(() => selected?.candidates || [], [selected]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!authChecked) {
    return <div style={loadingPageStyle}>권한 확인 중...</div>;
  }

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <HeaderLogo />
          <div>
            <h1 style={titleStyle}>사진 매칭 검수</h1>
            <div style={subTitleStyle}>현재 회원 사진과 원본 요람 얼굴 후보를 비교해 한 명씩 교체합니다</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={ghostButtonStyle} onClick={() => router.push("/admin/members")}>회원관리</button>
          <button style={ghostButtonStyle} onClick={() => router.push("/home")}>홈</button>
        </div>
      </header>

      <section style={toolbarStyle}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setPage(1);
              loadMembers(1, query, filter);
            }
          }}
          placeholder="회원 이름 또는 전화번호"
          style={inputStyle}
        />
        <select
          value={filter}
          onChange={(event) => {
            const next = event.target.value as typeof filter;
            setFilter(next);
            setPage(1);
            loadMembers(1, query, next);
          }}
          style={selectStyle}
        >
          <option value="all">전체</option>
          <option value="has_photo">사진 있음</option>
          <option value="no_photo">사진 없음</option>
          <option value="has_expected">원본 후보 연결</option>
          <option value="needs_source">원본 후보 없음</option>
        </select>
        <button style={buttonStyle} onClick={() => { setPage(1); loadMembers(1, query, filter); }} disabled={loading}>
          {loading ? "조회 중" : "조회"}
        </button>
      </section>

      <main style={mainGridStyle}>
        <section style={listPanelStyle}>
          <div style={panelHeadStyle}>
            <strong>회원 목록</strong>
            <span>{total.toLocaleString()}명</span>
          </div>
          <div style={memberListStyle}>
            {members.map((member) => (
              <button
                key={member.id}
                onClick={() => { setSelected(member); setLastPhotoUrl(undefined); }}
                style={{
                  ...memberRowStyle,
                  borderColor: selected?.id === member.id ? "#2563eb" : "#e5e7eb",
                  background: selected?.id === member.id ? "#eff6ff" : "#fff",
                }}
              >
                <Avatar url={member.photo_url} name={member.name} size={44} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={memberNameStyle}>{member.name}</div>
                  <div style={memberMetaStyle}>
                    {member.sub_role || "직분 없음"} · 사진p{member.photo_page ?? "-"} · {member.phone || "전화 없음"}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div style={pagerStyle}>
            <button style={ghostButtonStyle} disabled={page <= 1 || loading} onClick={() => { const p = page - 1; setPage(p); loadMembers(p); }}>이전</button>
            <span>{page} / {totalPages}</span>
            <button style={ghostButtonStyle} disabled={page >= totalPages || loading} onClick={() => { const p = page + 1; setPage(p); loadMembers(p); }}>다음</button>
          </div>
        </section>

        <section style={detailPanelStyle}>
          {selected ? (
            <>
              <div style={compareGridStyle}>
                <div>
                  <div style={sectionLabelStyle}>현재 회원 사진</div>
                  <div style={largePhotoBoxStyle}>
                    {selected.photo_url ? (
                      <img src={selected.photo_url} alt="" style={photoStyle} />
                    ) : (
                      <div style={emptyPhotoStyle}>사진 없음</div>
                    )}
                  </div>
                  <div style={infoBlockStyle}>
                    <strong>{selected.name}</strong>
                    <span>{selected.sub_role || "직분 없음"}</span>
                    <span>회원 원문 p{selected.source_page ?? "-"} · 사진 p{selected.photo_page ?? "-"}</span>
                    <span>{selected.phone || "전화 없음"}</span>
                  </div>
                  {lastPhotoUrl !== undefined && (
                    <button style={warnButtonStyle} onClick={restoreLastPhoto} disabled={saving}>직전 사진으로 되돌리기</button>
                  )}
                  <button style={dangerButtonStyle} onClick={markNoPhoto} disabled={saving}>
                    사진 없음
                  </button>
                </div>

                <div>
                  <div style={sectionLabelStyle}>원본에서 연결된 후보</div>
                  {selected.expected_crop_url ? (
                    <CandidateCard
                      crop={{
                        source_file: selected.expected_source_file || "",
                        photo_page: selected.photo_page || 0,
                        photo_index: 0,
                        source_url: selected.expected_crop_url,
                        pdf_name: selected.expected_pdf_name,
                        pdf_phone: selected.expected_pdf_phone,
                        expected_member_id: selected.id,
                      }}
                      onPick={setMemberPhoto}
                      disabled={saving}
                      selectedId={selected.id}
                    />
                  ) : (
                    <div style={emptyCandidateStyle}>이 회원과 자동 연결된 원본 후보가 없습니다</div>
                  )}
                </div>
              </div>

              <div style={candidateSectionStyle}>
                <div style={sectionHeadStyle}>
                  <div>
                    <strong>같은 사진페이지 후보</strong>
                    <span>사진 p{selected.photo_page ?? "-"}의 얼굴 후보</span>
                  </div>
                </div>
                <div style={candidateGridStyle}>
                  {samePageCandidates.map((crop) => (
                    <CandidateCard
                      key={crop.source_file}
                      crop={crop}
                      onPick={setMemberPhoto}
                      disabled={saving}
                      selectedId={selected.id}
                    />
                  ))}
                </div>
              </div>

              <div style={candidateSectionStyle}>
                <div style={sectionHeadStyle}>
                  <div>
                    <strong>전체 후보 검색</strong>
                    <span>원본 요람 이름, 전화번호, 파일명으로 검색</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={cropQuery}
                      onChange={(event) => setCropQuery(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") searchCrops(cropQuery); }}
                      placeholder="예: 최보웅, 1676, p007"
                      style={smallInputStyle}
                    />
                    <button style={buttonStyle} onClick={() => searchCrops(cropQuery)}>검색</button>
                  </div>
                </div>
                <div style={candidateGridStyle}>
                  {cropResults.map((crop) => (
                    <CandidateCard
                      key={crop.source_file}
                      crop={crop}
                      onPick={setMemberPhoto}
                      disabled={saving}
                      selectedId={selected.id}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div style={emptyStateStyle}>회원을 선택하세요</div>
          )}
        </section>
      </main>
    </div>
  );
}

function dedupeReviewMembers(rows: ReviewMember[]) {
  const byId = new Map<string, ReviewMember>();
  for (const row of rows) {
    const current = byId.get(row.id);
    if (!current) {
      byId.set(row.id, row);
      continue;
    }
    const currentScore = expectedCropScore(current);
    const nextScore = expectedCropScore(row);
    if (nextScore < currentScore) {
      byId.set(row.id, { ...row, total_count: current.total_count });
    }
  }
  return Array.from(byId.values());
}

function expectedCropScore(row: ReviewMember) {
  if (!row.expected_source_file) return 10;
  const pageMatch = row.expected_source_file.startsWith(`p${String(row.photo_page || 0).padStart(3, "0")}_`);
  return pageMatch ? 0 : 1;
}

function Avatar({ url, name, size }: { url: string | null; name: string; size: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 8, overflow: "hidden", background: "#e5e7eb", flexShrink: 0 }}>
      {url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (
        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800, color: "#64748b" }}>
          {name.slice(0, 1)}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  crop,
  onPick,
  disabled,
  selectedId,
}: {
  crop: Crop;
  onPick: (crop: Crop) => void;
  disabled: boolean;
  selectedId: string;
}) {
  const exact = crop.expected_member_id === selectedId;
  return (
    <div style={{ ...candidateCardStyle, borderColor: exact ? "#2563eb" : "#e5e7eb" }}>
      <div style={candidateImageStyle}>
        <img src={crop.source_url} alt="" style={photoStyle} />
      </div>
      <div style={candidateTextStyle}>
        <strong>{crop.pdf_name || "이름 미확인"}</strong>
        <span>{crop.pdf_phone || "전화 없음"}</span>
        <span>p{crop.photo_page} · #{crop.photo_index} · {crop.source_file}</span>
        {crop.expected_member_name && <span>연결: {crop.expected_member_name}</span>}
      </div>
      <button style={exact ? buttonStyle : ghostButtonStyle} onClick={() => onPick(crop)} disabled={disabled}>
        이 사진 지정
      </button>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#f8fafc",
  color: "#0f172a",
  fontFamily: "'Noto Sans KR', system-ui, sans-serif",
  padding: 24,
};

const loadingPageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "#f8fafc",
  color: "#0f172a",
  fontFamily: "'Noto Sans KR', system-ui, sans-serif",
};

const headerStyle: CSSProperties = {
  maxWidth: 1480,
  margin: "0 auto 16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
};

const titleStyle: CSSProperties = { margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: 0 };
const subTitleStyle: CSSProperties = { marginTop: 4, fontSize: 13, color: "#64748b" };

const toolbarStyle: CSSProperties = {
  maxWidth: 1480,
  margin: "0 auto 16px",
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const inputStyle: CSSProperties = {
  width: 280,
  maxWidth: "100%",
  height: 40,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "0 12px",
  fontSize: 14,
};

const smallInputStyle: CSSProperties = { ...inputStyle, width: 240 };

const selectStyle: CSSProperties = {
  height: 40,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "0 10px",
  fontSize: 14,
  background: "#fff",
};

const buttonStyle: CSSProperties = {
  height: 40,
  border: "1px solid #2563eb",
  borderRadius: 8,
  padding: "0 14px",
  background: "#2563eb",
  color: "#fff",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  height: 40,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "0 14px",
  background: "#fff",
  color: "#334155",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const warnButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  borderColor: "#f59e0b",
  color: "#92400e",
  marginTop: 12,
};

const dangerButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  borderColor: "#ef4444",
  color: "#991b1b",
  marginTop: 8,
};

const mainGridStyle: CSSProperties = {
  maxWidth: 1480,
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "360px minmax(0, 1fr)",
  gap: 16,
  alignItems: "start",
};

const listPanelStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  overflow: "hidden",
};

const detailPanelStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 16,
  minHeight: 640,
};

const panelHeadStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#475569",
};

const memberListStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 10 };

const memberRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 8,
  textAlign: "left",
  cursor: "pointer",
};

const memberNameStyle: CSSProperties = { fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const memberMetaStyle: CSSProperties = { marginTop: 2, fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const pagerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: 10,
  borderTop: "1px solid #e5e7eb",
  fontSize: 13,
};

const compareGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "280px minmax(240px, 320px)",
  gap: 16,
  alignItems: "start",
};

const largePhotoBoxStyle: CSSProperties = {
  width: 260,
  aspectRatio: "1 / 1",
  borderRadius: 8,
  overflow: "hidden",
  border: "1px solid #e5e7eb",
  background: "#f1f5f9",
};

const photoStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
const emptyPhotoStyle: CSSProperties = { width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#64748b", fontWeight: 800 };
const sectionLabelStyle: CSSProperties = { marginBottom: 8, fontSize: 13, fontWeight: 800, color: "#334155" };

const infoBlockStyle: CSSProperties = {
  marginTop: 10,
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
  color: "#475569",
};

const candidateSectionStyle: CSSProperties = { marginTop: 22, borderTop: "1px solid #e5e7eb", paddingTop: 16 };
const sectionHeadStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
  flexWrap: "wrap",
  fontSize: 13,
  color: "#64748b",
};

const candidateGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
  gap: 10,
};

const candidateCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 8,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const candidateImageStyle: CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  borderRadius: 6,
  overflow: "hidden",
  background: "#f1f5f9",
};

const candidateTextStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  fontSize: 11,
  color: "#64748b",
  minHeight: 72,
};

const emptyCandidateStyle: CSSProperties = {
  minHeight: 180,
  display: "grid",
  placeItems: "center",
  border: "1px dashed #cbd5e1",
  borderRadius: 8,
  color: "#64748b",
  fontSize: 13,
  textAlign: "center",
};

const emptyStateStyle: CSSProperties = {
  minHeight: 500,
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontWeight: 800,
};
