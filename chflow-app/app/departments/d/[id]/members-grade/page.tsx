"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView } from "@/components/StatusViews";
import { Lock, Medal } from "lucide-react";

interface DeptMember {
  teacher_id: string | null;
  user_id: string | null;
  name: string;
  role_label: string;
  grade: number;
  has_dm: boolean;
  has_app: boolean;
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
  0: "var(--success-soft)",
  1: "var(--warning-soft)",
  2: "var(--accent-soft)",
  3: "var(--bg-soft)",
  4: "var(--danger-soft)",
};

function memberKey(m: DeptMember) {
  return m.teacher_id ?? m.user_id ?? m.name;
}

export default function MembersGradePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [members, setMembers] = useState<DeptMember[]>([]);
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
  const [pickedRoleIdx, setPickedRoleIdx] = useState(5);
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
      supabase.rpc("list_dept_grade_members", { p_dept_id: deptId }),
    ]);
    if (gradeR.data !== null && gradeR.data !== undefined) {
      setMyGrade(typeof gradeR.data === "number" ? gradeR.data : Number(gradeR.data));
    }
    if (listR.error) {
      showToast("조회 실패: " + listR.error.message);
    } else {
      setMembers((listR.data as DeptMember[]) || []);
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

  async function handleGradeChange(member: DeptMember, newGrade: number) {
    if (member.grade === newGrade) return;
    if (!member.has_app || !member.user_id) {
      showToast("앱 미가입 상태입니다. 앱 가입 후 등급 조정이 가능합니다.");
      return;
    }
    if (!confirm(`${member.name} 님의 등급을 ${member.grade} → ${newGrade} 로 변경하시겠습니까?`)) return;
    setSavingId(memberKey(member));
    const { error } = await supabase.rpc("upsert_member_grade", {
      p_dept_id: deptId,
      p_user_id: member.user_id,
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
    if (searchSkipRef.current) { searchSkipRef.current = false; return; }
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setSearched(false); setSearching(false); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      const { data, error } = await supabase.rpc("dept_search_members_for_appoint", {
        p_dept_id: deptId,
        p_query: q,
      });
      setSearching(false);
      setSearched(true);
      if (error) { showToast("검색 실패: " + error.message); setSearchResults([]); return; }
      setSearchResults((data as SearchResult[]) || []);
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery, appointOpen, deptId, showToast]);

  function openAppointModal() {
    setAppointOpen(true);
    setSearchQuery("");
    setSearchResults([]);
    setSearched(false);
    setPicked(null);
    setPickedRoleIdx(5);
  }

  function pickResult(r: SearchResult) {
    if (r.already_member) { showToast(`${r.name} 님은 이미 부서원입니다`); return; }
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
    if (error) { showToast("임명 실패: " + error.message); return; }
    showToast(`${picked.name} 님 ${role.label} 임명 완료`);
    setAppointOpen(false);
    await load();
  }

  if (!authChecked || loading) return <LoadingView full />;

  if (myGrade === null || myGrade > 1) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{ background: "var(--card)", borderRadius: 16, padding: 28, textAlign: "center" }}>
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}><Lock size={40} strokeWidth={1.8} color="var(--ink-faint)" /></div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>
              접근 권한이 없습니다
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 20 }}>
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
        <HeaderLogo />
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><Medal size={18} strokeWidth={1.8} /> 부서원 등급 관리</div>
        <div style={{ width: 60 }} />
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.7 }}>
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

          {/* 앱 가입 부서원 섹션 */}
          {members.some((m) => m.has_app) && (
            <>
              <div style={groupLabelStyle}>앱 가입 부서원 ({members.filter(m => m.has_app).length}명)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {members.filter((m) => m.has_app).map((m) => {
                  const key = memberKey(m);
                  return (
                    <div
                      key={key}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                        padding: "10px 12px",
                        border: "1px solid var(--accent-line)",
                        borderRadius: 10,
                        background: GRADE_BG[m.grade] || "#fff",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{m.name}</span>
                          {m.role_label && <span style={roleBadgeStyle}>{m.role_label}</span>}
                          {!m.has_dm && <span style={noDmBadgeStyle}>미승인</span>}
                        </div>
                      </div>
                      <select
                        value={m.grade}
                        onChange={(e) => handleGradeChange(m, parseInt(e.target.value, 10))}
                        disabled={savingId === key}
                        style={{
                          padding: "6px 10px", fontSize: 12, fontFamily: "inherit",
                          border: "1.5px solid var(--accent-line)", borderRadius: 8, background: "var(--card)",
                          cursor: savingId === key ? "not-allowed" : "pointer", minWidth: 180,
                        }}
                      >
                        {GRADE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 앱 미가입 교사 명단 */}
          {members.some((m) => !m.has_app) && (
            <>
              <div style={groupLabelStyle}>교사 명단 — 앱 미가입 ({members.filter(m => !m.has_app).length}명)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {members.filter((m) => !m.has_app).map((m) => {
                  const key = memberKey(m);
                  return (
                    <div
                      key={key}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                        padding: "10px 12px",
                        border: "1px solid var(--hairline)",
                        borderRadius: 10,
                        background: "var(--surface)",
                        opacity: 0.72,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{m.name}</span>
                          {m.role_label && <span style={roleBadgeStyle}>{m.role_label}</span>}
                          <span style={noAppBadgeStyle}>앱 미가입</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-faint)", minWidth: 120, textAlign: "right" }}>
                        앱 가입 후 조정 가능
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {members.length === 0 && (
              <div style={{ textAlign: "center", padding: 30, color: "var(--ink-faint)", fontSize: 12 }}>
                부서원이 없습니다
              </div>
            )}
          </div>
        </div>

      {toast && <div style={toastStyle}>{toast}</div>}

      {appointOpen && (
        <div style={modalBackdrop} onClick={() => !appointing && setAppointOpen(false)}>
          <div style={modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "inline-flex", alignItems: "center", gap: 6 }}><Medal size={18} strokeWidth={1.8} /> 부서원 임명</div>
              <button onClick={() => !appointing && setAppointOpen(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--ink-faint)" }}>×</button>
            </div>

            {!picked ? (
              <>
                <div style={{ fontSize: 11, color: "var(--ink-soft)", marginBottom: 8 }}>
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
                    border: "1.5px solid var(--hairline-strong)", borderRadius: 8,
                    fontFamily: "inherit", boxSizing: "border-box",
                  }}
                />
                <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                  {searching && <div style={{ padding: 12, textAlign: "center", color: "var(--ink-faint)", fontSize: 12 }}>검색 중...</div>}
                  {!searching && searched && searchResults.length === 0 && (
                    <div style={{ padding: 16, textAlign: "center", color: "var(--ink-faint)", fontSize: 12 }}>
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
                          padding: "10px 12px", border: "1px solid var(--hairline)",
                          borderRadius: 8, marginBottom: 6,
                          background: r.already_member ? "var(--surface)" : "#fff",
                          cursor: r.already_member ? "not-allowed" : "pointer",
                          opacity: r.already_member ? 0.5 : 1,
                          display: "flex", alignItems: "center", gap: 10,
                        }}
                      >
                        {r.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.photo_url} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--hairline)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "var(--ink-faint)", flexShrink: 0 }}>?</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                            {r.name}
                            {r.already_member && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--warning)", fontWeight: 600 }}>· 이미 부서원</span>}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>
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
                <div style={{ background: "var(--surface)", borderRadius: 10, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
                  {picked.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={picked.photo_url} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--hairline)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, color: "var(--ink-faint)" }}>?</div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{picked.name}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 3 }}>
                      {[picked.sub_role, picked.gender, picked.phone].filter(Boolean).join(" · ") || "-"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2 }}>
                      {[picked.plain_name, picked.grassland_name, picked.pasture_name].filter(Boolean).join(" / ") || "-"}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-mid)", marginBottom: 8 }}>이 분이 맞으면, 직분을 선택하세요</div>
                <select
                  value={pickedRoleIdx}
                  onChange={(e) => setPickedRoleIdx(parseInt(e.target.value, 10))}
                  style={{
                    width: "100%", padding: "10px 12px", fontSize: 14,
                    border: "1.5px solid var(--hairline-strong)", borderRadius: 8,
                    fontFamily: "inherit", background: "var(--card)", boxSizing: "border-box",
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
                    style={{ flex: 1, padding: "10px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    ← 다시 검색
                  </button>
                  <button
                    onClick={handleAppoint}
                    disabled={appointing}
                    style={{ flex: 2, padding: "10px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#fff", cursor: appointing ? "wait" : "pointer", fontFamily: "inherit" }}
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
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
};
const headerStyle: React.CSSProperties = {
  background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)",
  display: "flex", alignItems: "center", justifyContent: "space-between",
};
const cardStyle: React.CSSProperties = {
  background: "var(--card)", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "var(--ink-faint)", letterSpacing: 0.5, marginBottom: 12,
};
const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8,
  fontSize: 12, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap" as const, flexShrink: 0,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 20px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const toastStyle: React.CSSProperties = {
  position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)",
  background: "rgba(43, 39, 34,0.88)", color: "#fff", padding: "12px 24px", borderRadius: 999,
  fontSize: 13, fontWeight: 600, zIndex: 999, fontFamily: "inherit", whiteSpace: "nowrap",
};
const appointBtnStyle: React.CSSProperties = {
  padding: "7px 14px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const modalBackdrop: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(43, 39, 34,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 16,
};
const modalBox: React.CSSProperties = {
  background: "var(--card)", borderRadius: 14, padding: 20,
  width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto",
  fontFamily: "inherit",
};
const groupLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: 0.4,
  marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid var(--accent-soft)",
};
const roleBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "var(--accent)",
  background: "var(--accent-soft)", borderRadius: 6, padding: "1px 6px",
};
const noAppBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "var(--warning)",
  background: "var(--warning-soft)", borderRadius: 6, padding: "1px 6px",
};
const noDmBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "var(--ink-soft)",
  background: "var(--bg-soft)", borderRadius: 6, padding: "1px 6px",
};
