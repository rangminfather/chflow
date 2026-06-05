"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";

interface Member {
  user_id: string;
  name: string;
  grade: number;
  status: string;
  joined_at: string;
}

interface SearchResult {
  member_id: string;
  app_user_id: string;
  name: string;
  phone: string | null;
  gender: string | null;
  birth_date: string | null;
  photo_url: string | null;
  sub_role: string | null;
  pasture_name: string | null;
  grassland_name: string | null;
  plain_name: string | null;
  already_member: boolean;
}

const GRADE_OPTIONS = [
  { value: 0, label: "0 — 전도사 / 교육사" },
  { value: 1, label: "1 — 부장" },
  { value: 2, label: "2 — 부부장 / 총무 / 서기" },
  { value: 3, label: "3 — 교사" },
  { value: 4, label: "4 — 학부모" },
];

const ROLE_OPTIONS: { grade: number; role: string; label: string }[] = [
  { grade: 0, role: "전도사",  label: "전도사 / 교육사" },
  { grade: 1, role: "부장",    label: "부장" },
  { grade: 2, role: "부부장",  label: "부부장" },
  { grade: 2, role: "총무",    label: "총무" },
  { grade: 2, role: "서기",    label: "서기" },
  { grade: 3, role: "교사",    label: "교사" },
  { grade: 4, role: "학부모",  label: "학부모" },
];

const GRADE_BG: Record<number, string> = {
  0: "#ecfdf5",
  1: "#fef3c7",
  2: "#dbeafe",
  3: "#f1f5f9",
  4: "#fef2f2",
};

export default function MembersGradePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [myGrade, setMyGrade] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  // 임명 모달
  const [appointOpen, setAppointOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [pickedRoleIdx, setPickedRoleIdx] = useState(5); // 기본: 교사
  const [appointing, setAppointing] = useState(false);
  const searchSkipRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [gradeR, listR] = await Promise.all([
      supabase.rpc("get_user_grade", { p_dept_id: deptId }),
      supabase.rpc("list_dept_members_with_grade", { p_dept_id: deptId }),
    ]);
    if (gradeR.data !== null && gradeR.data !== undefined) {
      setMyGrade(typeof gradeR.data === "number" ? gradeR.data : Number(gradeR.data));
    }
    if (listR.error) {
      showToast("조회 실패: " + listR.error.message);
    } else {
      setMembers(listR.data || []);
    }
    setLoading(false);
  }, [deptId, showToast]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      await load();
    })();
  }, [load, router]);

  async function handleGradeChange(member: Member, newGrade: number) {
    if (member.grade === newGrade) return;
    if (!confirm(`${member.name} 님의 등급을 ${member.grade} → ${newGrade} 로 변경하시겠습니까?`)) return;
    setSavingId(member.user_id);
    const { error } = await supabase.rpc("set_member_grade", {
      p_dept_id: deptId,
      p_member_user_id: member.user_id,
      p_grade: newGrade,
    });
    setSavingId(null);
    if (error) {
      showToast("저장 실패: " + error.message);
    } else {
      showToast(`${member.name} 등급 변경됨`);
      await load();
    }
  }

  // 임명 모달 — 검색 (debounce 250ms)
  useEffect(() => {
    if (!appointOpen) return;
    if (searchSkipRef.current) {
      searchSkipRef.current = false;
      return;
    }
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const { data, error } = await supabase.rpc("dept_search_members_for_appoint", {
        p_dept_id: deptId,
        p_query: q,
      });
      setSearching(false);
      setSearched(true);
      if (error) {
        showToast("검색 실패: " + error.message);
        setSearchResults([]);
        return;
      }
      setSearchResults((data as SearchResult[]) || []);
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery, appointOpen, deptId]);

  function openAppointModal() {
    setAppointOpen(true);
    setSearchQuery("");
    setSearchResults([]);
    setSearched(false);
    setPicked(null);
    setPickedRoleIdx(5);
  }

  function pickResult(r: SearchResult) {
    if (r.already_member) {
      showToast(`${r.name} 님은 이미 부서원입니다`);
      return;
    }
    searchSkipRef.current = true;
    setPicked(r);
  }

  async function handleAppoint() {
    if (!picked) return;
    const role = ROLE_OPTIONS[pickedRoleIdx];
    if (!confirm(`${picked.name} 님을 ${role.label}(으)로 임명하시겠습니까?`)) return;
    setAppointing(true);
    const { error } = await supabase.rpc("admin_appoint_dept_member", {
      p_dept_id: deptId,
      p_member_id: picked.member_id,
      p_grade: role.grade,
      p_teacher_role: role.role,
    });
    setAppointing(false);
    if (error) {
      showToast("임명 실패: " + error.message);
      return;
    }
    showToast(`${picked.name} 님 ${role.label} 임명 완료`);
    setAppointOpen(false);
    await load();
  }

  if (!authChecked || loading) return <div style={loadingStyle}>로딩 중...</div>;

  if (myGrade === null || myGrade > 1) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>
              접근 권한이 없습니다
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
              부서원 등급 관리는 등급 0~1 (전도사/교육사 또는 부장) 만 가능합니다.
            </div>
            <button onClick={() => router.push(`/departments/d/${deptId}`)} style={primaryBtnStyle}>
              부서홈으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>

      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
          <HeaderLogo />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>🎖️ 부서원 등급 관리</div>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.7 }}>
            <b>등급 정책</b>:
            <br />• <b>0</b> 전도사·교육사 — 모든 메뉴
            <br />• <b>1</b> 부장 — 공지·학생·행정·부서
            <br />• <b>2</b> 부부장·총무·서기 — 공지·학생·행정
            <br />• <b>3</b> 교사 — 공지·학생
            <br />• <b>4</b> 학부모 — 공지(읽기/댓글)
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ ...sectionLabel, marginBottom: 0 }}>부서원 ({members.length}명)</div>
            <button onClick={openAppointModal} style={appointBtnStyle}>+ 임명</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {members.map((m) => (
              <div
                key={m.user_id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                  padding: "10px 12px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  background: GRADE_BG[m.grade] || "#fff",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                    상태: {m.status} · 가입: {new Date(m.joined_at).toLocaleDateString("ko-KR")}
                  </div>
                </div>
                <select
                  value={m.grade}
                  onChange={(e) => handleGradeChange(m, parseInt(e.target.value, 10))}
                  disabled={savingId === m.user_id}
                  style={{
                    padding: "6px 10px",
                    fontSize: 12,
                    fontFamily: "inherit",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: 8,
                    background: "#fff",
                    cursor: savingId === m.user_id ? "not-allowed" : "pointer",
                    minWidth: 180,
                  }}
                >
                  {GRADE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}
            {members.length === 0 && (
              <div style={{ textAlign: "center", padding: 30, color: "#94a3b8", fontSize: 12 }}>
                부서원이 없습니다
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}

      {appointOpen && (
        <div style={modalBackdrop} onClick={() => !appointing && setAppointOpen(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>🎖️ 부서원 임명</div>
              <button onClick={() => !appointing && setAppointOpen(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
            </div>

            {!picked ? (
              <>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                  앱 가입한 회원 중에서 검색합니다. (이름 또는 전화번호)
                </div>
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="이름 또는 전화번호"
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: 14,
                    border: "1.5px solid #cbd5e1", borderRadius: 8,
                    fontFamily: "inherit", boxSizing: "border-box",
                  }}
                />
                <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                  {searching && <div style={{ padding: 12, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>검색 중...</div>}
                  {!searching && searched && searchResults.length === 0 && (
                    <div style={{ padding: 16, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                      검색 결과가 없습니다. (앱 가입한 회원만 검색됩니다)
                    </div>
                  )}
                  {searchResults.map((r) => {
                    const scope = [r.plain_name, r.grassland_name, r.pasture_name].filter(Boolean).join(" / ");
                    return (
                      <div
                        key={r.member_id}
                        onClick={() => pickResult(r)}
                        style={{
                          padding: "10px 12px", border: "1px solid #e2e8f0",
                          borderRadius: 8, marginBottom: 6,
                          background: r.already_member ? "#f8fafc" : "#fff",
                          cursor: r.already_member ? "not-allowed" : "pointer",
                          opacity: r.already_member ? 0.5 : 1,
                          display: "flex", alignItems: "center", gap: 10,
                        }}
                      >
                        {r.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.photo_url} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#94a3b8", flexShrink: 0 }}>?</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                            {r.name}
                            {r.already_member && <span style={{ marginLeft: 6, fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>· 이미 부서원</span>}
                          </div>
                          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                            {[r.sub_role, scope, r.phone].filter(Boolean).join(" · ") || "-"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div style={{ background: "#f8fafc", borderRadius: 10, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
                  {picked.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={picked.photo_url} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "#94a3b8" }}>?</div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b" }}>{picked.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                      {[picked.sub_role, picked.gender, picked.phone].filter(Boolean).join(" · ") || "-"}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                      {[picked.plain_name, picked.grassland_name, picked.pasture_name].filter(Boolean).join(" / ") || "-"}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 8 }}>이 분이 맞으면, 직분을 선택하세요</div>
                <select
                  value={pickedRoleIdx}
                  onChange={(e) => setPickedRoleIdx(parseInt(e.target.value, 10))}
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: 14,
                    border: "1.5px solid #cbd5e1", borderRadius: 8,
                    fontFamily: "inherit", background: "#fff", boxSizing: "border-box",
                  }}
                >
                  {ROLE_OPTIONS.map((opt, idx) => (
                    <option key={idx} value={idx}>
                      {opt.label} (등급 {opt.grade})
                    </option>
                  ))}
                </select>

                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button
                    onClick={() => setPicked(null)}
                    disabled={appointing}
                    style={{ flex: 1, padding: "10px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    ← 다시 검색
                  </button>
                  <button
                    onClick={handleAppoint}
                    disabled={appointing}
                    style={{ flex: 2, padding: "10px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#fff", cursor: appointing ? "wait" : "pointer", fontFamily: "inherit" }}
                  >
                    {appointing ? "임명 중..." : "임명하기"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};
const loadingStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif",
};
const headerStyle: React.CSSProperties = {
  background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px",
  display: "flex", alignItems: "center", justifyContent: "space-between",
};
const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, marginBottom: 12,
};
const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8,
  fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 20px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const toastStyle: React.CSSProperties = {
  position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)",
  background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999,
  fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap",
};
const appointBtnStyle: React.CSSProperties = {
  padding: "7px 14px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 16,
};
const modalBox: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 20,
  width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
  fontFamily: "inherit",
};
