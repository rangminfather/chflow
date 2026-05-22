"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getRoleImageByLabel } from "@/lib/roles";
import NotificationBell from "@/components/NotificationBell";
import PhotoAvatar from "@/components/PhotoAvatar";
import HeaderLogo from "@/components/HeaderLogo";

// =============================================================
// 타입
// =============================================================
interface UserInfo {
  id: string;
  username: string;
  name: string;
  phone: string;
  role: string;
  sub_role: string;
  status: string;
  member_id: string | null;
  family_church: string | null;
  spouse_name: string | null;
  household_id: string | null;
  address: string | null;
  pasture_name: string | null;
  grassland_name: string | null;
  plain_name: string | null;
}

interface MyDepartment {
  id: string;
  department_id: string;
  category: string;
  name: string;
  icon: string | null;
  status: string;
  member_role: string;
}

type RouterType = ReturnType<typeof useRouter>;

// =============================================================
// 디자인 토큰
// =============================================================
const COLORS = {
  bgPage:    "#F5F7FA",
  bgCard:    "#FFFFFF",
  text:      "#1F2937",
  textMuted: "#8A94A6",
  border:    "#E5E7EB",
  accent:    "#6366F1",
  accentSoft:"#EEF2FF",
  success:   "#10B981",
  successSoft:"#ECFDF5",
  warn:      "#F59E0B",
  warnSoft:  "#FFFBEB",
  danger:    "#EF4444",
  dangerSoft:"#FEF2F2",
};

// =============================================================
// 메뉴 데이터
// =============================================================
type CommonMenu = {
  id: string;
  label: string;
  desc: string;
  icon: string;
  color: string;
  href?: string;
};

const COMMON_MENUS: CommonMenu[] = [
  { id: "bulletin",  label: "주보 보기",      icon: "📖", color: "#0EA5E9", desc: "이번 주 주보",       href: "/bulletin" },
  { id: "directory", label: "성도 요람",      icon: "👥", color: "#10B981", desc: "성도 검색",          href: "/directory" },
  { id: "myinfo",    label: "내 정보",         icon: "👤", color: "#6366F1", desc: "프로필 관리",        href: "/myinfo" },
  { id: "feedback",  label: "불편신고/건의",  icon: "💡", color: "#EC4899", desc: "건의사항 접수",      href: "/feedback" },
];

// 관리자 전용 추가 메뉴
const ADMIN_EXTRA_MENUS: CommonMenu[] = [
  { id: "vote",     label: "투표",          icon: "🗳️", color: "#6366F1", desc: "항존직 선거",  href: "/vote" },
  { id: "events",   label: "행사 공지",      icon: "📢", color: "#0EA5E9", desc: "공지사항" },
  { id: "calendar", label: "행사 달력",      icon: "📅", color: "#0EA5E9", desc: "월간 일정" },
  { id: "facility", label: "시설 신청",      icon: "🏛️", color: "#F59E0B", desc: "교육관/예배실" },
  { id: "vehicle",  label: "차량 신청",      icon: "🚐", color: "#F59E0B", desc: "교회 차량" },
  { id: "booking",  label: "예약 캘린더",    icon: "📆", color: "#F59E0B", desc: "예약 현황" },
];

// =============================================================
// 메인
// =============================================================
export default function HomePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [myDepartments, setMyDepartments] = useState<MyDepartment[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showExitToast, setShowExitToast] = useState(false);

  // === 데이터 로드 ===
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase.rpc("get_my_full_info");
      const profile = data?.[0];
      if (!profile || profile.status !== "active") {
        await supabase.auth.signOut();
        router.replace("/login?notice=pending");
        return;
      }
      setUser(profile);
      setAuthChecked(true);

      const { data: depts } = await supabase.rpc("get_my_departments");
      if (depts) setMyDepartments(depts);

      const { data: photos } = await supabase.rpc("get_my_photos");
      if (photos && photos[0]) {
        setPhotoUrl(photos[0].avatar_url || photos[0].member_photo_url || null);
      }
    })();
  }, [router]);

  // === 뒤로가기 인터셉트 + 종료 확인 (기존 로직 유지) ===
  const sidebarOpenRef = useRef(sidebarOpen);
  useEffect(() => { sidebarOpenRef.current = sidebarOpen; }, [sidebarOpen]);

  const showExitModalRef = useRef(showExitModal);
  useEffect(() => { showExitModalRef.current = showExitModal; }, [showExitModal]);

  const exitingRef = useRef(false);
  const popstateInitialized = useRef(false);

  useEffect(() => {
    if (!authChecked) return;
    if (popstateInitialized.current) return;
    popstateInitialized.current = true;

    try { window.history.pushState({ smartms_home: true }, "", window.location.href); }
    catch (e) { console.warn("pushState failed", e); }

    const handlePopState = () => {
      if (exitingRef.current) return;
      if (sidebarOpenRef.current) {
        setSidebarOpen(false);
      } else if (!showExitModalRef.current) {
        setShowExitModal(true);
      }
      try { window.history.pushState({ smartms_home: true }, "", window.location.href); }
      catch (e) { console.warn("pushState failed", e); }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      popstateInitialized.current = false;
    };
  }, [authChecked]);

  const handleExitConfirm = () => {
    setShowExitModal(false);
    exitingRef.current = true;
    const remember = typeof window !== "undefined" ? localStorage.getItem("smartms_remember_me") : null;
    if (remember !== "1") {
      try {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith("sb-")) localStorage.removeItem(k);
        });
      } catch {}
    }
    try { window.history.back(); } catch {}
    setShowExitToast(true);
  };

  const handleExitCancel = () => setShowExitModal(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login?notice=logout");
  };

  if (!authChecked || !user) {
    return (
      <div style={loadingStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center" }}>
          <img src="/brand-mark-192.png" style={{ width: 64, height: 64, borderRadius: 14, marginBottom: 12, opacity: 0.85 }} />
          <div style={{ fontSize: 13, color: COLORS.textMuted }}>로딩 중...</div>
        </div>
      </div>
    );
  }

  const isAdmin = ["admin", "office", "pastor"].includes(user.role);
  const visibleMenus: CommonMenu[] = isAdmin
    ? [...COMMON_MENUS, ...ADMIN_EXTRA_MENUS]
    : COMMON_MENUS;
  const userImage = getRoleImageByLabel(user.sub_role || "");

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bgPage, fontFamily: "'Noto Sans KR', sans-serif", color: COLORS.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile-trigger { display: flex !important; }
          .main-content { padding: 16px !important; }
          .menu-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .header-actions { gap: 6px !important; }
          .admin-btn-label { display: none !important; }
          .user-summary-meta { flex-direction: column !important; align-items: flex-start !important; gap: 4px !important; }
        }
        @media (min-width: 769px) {
          .sidebar-mobile-trigger { display: none !important; }
        }
      `}</style>

      <AppBar
        isAdmin={isAdmin}
        user={user}
        router={router}
        onMenu={() => setSidebarOpen((s) => !s)}
        onLogout={handleLogout}
      />

      <div style={{ display: "flex", minHeight: "calc(100vh - 64px)" }}>
        <DesktopSidebar user={user} myDepartments={myDepartments} router={router} />
        <MobileSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={user}
          myDepartments={myDepartments}
          router={router}
        />

        <div className="main-content" style={{ flex: 1, padding: 24, overflowX: "hidden" }}>
          <div style={{ maxWidth: 960, margin: "0 auto" }}>
            <UserSummarySection user={user} photoUrl={photoUrl} userImage={userImage} />

            <MinistrySection myDepartments={myDepartments} router={router} />

            <MyMokjangSection user={user} router={router} />

            <CommonMenuSection menus={visibleMenus} router={router} />

            <NoticeBox />
          </div>
        </div>
      </div>

      {showExitModal && (
        <ExitModal onCancel={handleExitCancel} onConfirm={handleExitConfirm} />
      )}
      {showExitToast && <ExitToast />}
    </div>
  );
}

// =============================================================
// 상단 앱바
// =============================================================
function AppBar({ isAdmin, user, router, onMenu, onLogout }: {
  isAdmin: boolean;
  user: UserInfo;
  router: RouterType;
  onMenu: () => void;
  onLogout: () => void;
}) {
  return (
    <div style={{
      background: COLORS.bgCard,
      borderBottom: `1px solid ${COLORS.border}`,
      padding: "10px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <button
          className="sidebar-mobile-trigger"
          onClick={onMenu}
          aria-label="메뉴"
          style={{
            display: "none", alignItems: "center", justifyContent: "center",
            width: 40, height: 40, borderRadius: 10,
            background: COLORS.bgPage, border: `1px solid ${COLORS.border}`,
            cursor: "pointer", fontSize: 18, color: COLORS.text,
          }}
        >☰</button>
        <HeaderLogo />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text }}>스마트명성</div>
          <div style={{ fontSize: 10, color: COLORS.textMuted, letterSpacing: 0.5 }}>Smart Myungsung</div>
        </div>
      </div>

      <div className="header-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <NotificationBell userId={user.id} />
        {isAdmin && (
          <>
            <AdminPill icon="⏳" label="가입자" onClick={() => router.push("/admin/pending")} />
            <AdminPill icon="🏢" label="사역·부서" onClick={() => router.push("/admin/dept-pending")} />
            <AdminPill icon="👥" label="회원관리" onClick={() => router.push("/admin/members")} />
            <AdminPill icon="🔐" label="비번초기화" onClick={() => router.push("/admin/password-reset")} />
            <AdminPill icon="🗳️" label="투표관리" onClick={() => router.push("/admin/votes")} />
            <AdminPill icon="🔀" label="재편성" onClick={() => router.push("/admin/rearrange")} />
          </>
        )}
        <button
          onClick={onLogout}
          aria-label="로그아웃"
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "8px 12px", borderRadius: 10,
            background: COLORS.bgPage, border: `1px solid ${COLORS.border}`,
            color: COLORS.textMuted, cursor: "pointer",
            fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          <span>🚪</span>
          <span>로그아웃</span>
        </button>
      </div>
    </div>
  );
}

function AdminPill({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "8px 10px", borderRadius: 10,
        background: COLORS.accentSoft, color: COLORS.accent,
        border: "none", cursor: "pointer",
        fontSize: 12, fontWeight: 700, fontFamily: "inherit",
      }}
    >
      <span>{icon}</span>
      <span className="admin-btn-label">{label}</span>
    </button>
  );
}

// =============================================================
// 사용자 요약 (앱바 아래)
// =============================================================
function UserSummarySection({ user, photoUrl, userImage }: {
  user: UserInfo;
  photoUrl: string | null;
  userImage: string;
}) {
  const subParts = [user.sub_role, user.family_church && user.family_church !== "목원" ? user.family_church : null].filter(Boolean);
  return (
    <div style={{
      background: COLORS.bgCard,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 18,
      padding: 18,
      marginBottom: 18,
      display: "flex",
      alignItems: "center",
      gap: 14,
    }}>
      <div style={{ position: "relative", flexShrink: 0 }}>
        <PhotoAvatar
          userId={user.id}
          photoUrl={photoUrl}
          size={56}
          label=""
        />
        <img
          src={userImage}
          alt=""
          style={{
            position: "absolute", bottom: -4, right: -4,
            width: 26, height: 26, borderRadius: "50%",
            background: "#fff", padding: 1, objectFit: "cover", objectPosition: "top",
            border: `2px solid ${COLORS.bgCard}`,
            boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
          }}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.text }}>
          {user.name}님 <span style={{ fontSize: 16 }}>🙏</span>
        </div>
        <div className="user-summary-meta" style={{ marginTop: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13, color: COLORS.textMuted }}>
          {subParts.length > 0 && <span>{subParts.join(" · ")}</span>}
        </div>
        <div style={{ marginTop: 6, fontSize: 13, color: COLORS.textMuted }}>오늘도 평안한 하루 되세요 ✨</div>
      </div>
    </div>
  );
}

// =============================================================
// 1) 내 사역 · 부서
// =============================================================
function MinistrySection({ myDepartments, router }: { myDepartments: MyDepartment[]; router: RouterType }) {
  const approved = myDepartments.filter((d) => d.status === "approved");
  const pending = myDepartments.filter((d) => d.status === "pending");

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionTitle title="내 사역 · 부서" subtitle="가입된 사역과 부서를 확인하세요" />

      {approved.length === 0 && pending.length === 0 ? (
        <div style={cardStyle()}>
          <div style={{ fontSize: 14, color: COLORS.textMuted, marginBottom: 14 }}>
            아직 가입된 사역 · 부서가 없습니다
          </div>
          <OutlineButton
            label="+ 다른 사역 · 부서 가입하기"
            onClick={() => router.push("/departments")}
          />
        </div>
      ) : (
        <>
          <div className="menu-grid" style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
            marginBottom: 10,
          }}>
            {approved.map((d) => (
              <button
                key={d.id}
                onClick={() => router.push(`/departments/d/${d.department_id}`)}
                style={{
                  ...cardStyle(),
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div style={iconBoxStyle(COLORS.accentSoft)}>
                  <span style={{ fontSize: 22 }}>{d.icon || "📁"}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600 }}>{d.category}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text, marginTop: 2 }}>{d.name}</div>
                </div>
                <StatusBadge tone="success" label="승인됨" />
              </button>
            ))}

            {pending.map((d) => (
              <div
                key={d.id}
                style={{
                  ...cardStyle(),
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <div style={iconBoxStyle(COLORS.warnSoft)}>
                  <span style={{ fontSize: 22 }}>{d.icon || "⏳"}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600 }}>{d.category}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text, marginTop: 2 }}>{d.name}</div>
                </div>
                <StatusBadge tone="warn" label="가입중" />
              </div>
            ))}
          </div>

          <OutlineButton
            label="+ 다른 사역 · 부서 가입하기"
            onClick={() => router.push("/departments")}
          />
        </>
      )}
    </section>
  );
}

// =============================================================
// 2) 나의 목장
// =============================================================
// 상태 분기:
//  A. user.pasture_name 없음 → 미가입 (가입 신청 버튼)
//  B. 승인 대기 → TODO: 아직 신청 모델 없음 (별도 RPC/테이블 필요)
//  C. user.pasture_name 있음 → 소속됨
//  D. 관리자 배정 → C와 동일 표시
function MyMokjangSection({ user, router: _router }: { user: UserInfo; router: RouterType }) {
  const hasPasture = !!user.pasture_name;

  // TODO: 목장 가입 신청 시스템이 아직 없음. 라우트가 생기면 router.push("/pasture/request") 등으로 연결.
  const handleJoinRequest = () => {
    alert("목장 가입 신청 기능은 준비 중입니다.\n관리자에게 직접 문의하시거나 잠시만 기다려주세요.");
  };

  // TODO: 목장 상세 화면(/pasture/me 또는 /pasture/[id])이 생기면 연결.
  const handleViewPasture = () => {
    alert("목장 상세 화면은 준비 중입니다.");
  };

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionTitle title="나의 목장" subtitle="소속 목장을 확인하거나 가입 신청하세요" />

      {hasPasture ? (
        <button
          onClick={handleViewPasture}
          style={{
            ...cardStyle(),
            width: "100%",
            textAlign: "left",
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div style={iconBoxStyle(COLORS.accentSoft)}>
            <span style={{ fontSize: 24 }}>🏘️</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: COLORS.textMuted, fontWeight: 600 }}>
              {user.plain_name ? `${user.plain_name}평원` : ""}
              {user.grassland_name ? ` · ${user.grassland_name}초원` : ""}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: COLORS.text, marginTop: 2 }}>
              {user.pasture_name}목장
            </div>
            {user.spouse_name && (
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
                배우자: {user.spouse_name}
              </div>
            )}
          </div>
          <div style={{
            padding: "8px 14px",
            background: COLORS.accent,
            color: "#fff",
            borderRadius: 10,
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}>목장 보기</div>
        </button>
      ) : (
        <div style={cardStyle()}>
          <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, marginBottom: 4 }}>
            아직 소속된 목장이 없습니다
          </div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 14 }}>
            목장을 찾아 가입 신청할 수 있습니다
          </div>
          <button
            onClick={handleJoinRequest}
            style={{
              padding: "12px 18px",
              background: COLORS.accent,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            목장 가입 신청
          </button>
        </div>
      )}
    </section>
  );
}

// =============================================================
// 3) 공통 메뉴
// =============================================================
function CommonMenuSection({ menus, router }: { menus: CommonMenu[]; router: RouterType }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <SectionTitle title="공통 메뉴" subtitle="모든 성도가 사용할 수 있는 기능" />
      <div className="menu-grid" style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 12,
      }}>
        {menus.map((m) => <MenuCard key={m.id} menu={m} router={router} />)}
      </div>
    </section>
  );
}

function MenuCard({ menu, router }: { menu: CommonMenu; router: RouterType }) {
  const handleClick = () => {
    if (menu.href) router.push(menu.href);
    else alert(`${menu.label}은(는) 곧 추가됩니다.`);
  };
  return (
    <button
      onClick={handleClick}
      style={{
        ...cardStyle(),
        display: "flex",
        alignItems: "center",
        gap: 14,
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
      }}
    >
      <div style={iconBoxStyle(`${menu.color}1A`)}>
        <span style={{ fontSize: 24 }}>{menu.icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: COLORS.text }}>{menu.label}</div>
        <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>{menu.desc}</div>
      </div>
    </button>
  );
}

// =============================================================
// 하단 안내 박스
// =============================================================
function NoticeBox() {
  return (
    <div style={{
      padding: "14px 18px",
      background: "#F1F5F9",
      border: `1px solid ${COLORS.border}`,
      borderRadius: 14,
      fontSize: 12,
      color: "#475569",
      lineHeight: 1.7,
    }}>
      💡 직분별 · 사역별 전용 게시판은 추후 추가될 예정입니다.<br />
      현재는 공통 메뉴를 사용할 수 있습니다.
    </div>
  );
}

// =============================================================
// 공용 작은 컴포넌트
// =============================================================
function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.text }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>{subtitle}</div>
      )}
    </div>
  );
}

function OutlineButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        padding: "12px 16px",
        background: "#fff",
        color: COLORS.accent,
        border: `1.5px solid ${COLORS.accent}`,
        borderRadius: 12,
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

function StatusBadge({ tone, label }: { tone: "success" | "warn"; label: string }) {
  const bg = tone === "success" ? COLORS.successSoft : COLORS.warnSoft;
  const fg = tone === "success" ? COLORS.success : COLORS.warn;
  return (
    <span style={{
      padding: "4px 10px",
      borderRadius: 999,
      background: bg,
      color: fg,
      fontSize: 11,
      fontWeight: 800,
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>{label}</span>
  );
}

function cardStyle(): React.CSSProperties {
  return {
    background: COLORS.bgCard,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 18,
    padding: 20,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
  };
}

function iconBoxStyle(bg: string): React.CSSProperties {
  return {
    width: 48, height: 48, borderRadius: 12,
    background: bg,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  };
}

// =============================================================
// 사이드바 (기존 기능 유지, 톤 다운)
// =============================================================
function DesktopSidebar({ user, myDepartments, router }: {
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
}) {
  return (
    <aside className="sidebar-desktop" style={{
      width: 220,
      background: COLORS.bgCard,
      borderRight: `1px solid ${COLORS.border}`,
      padding: "20px 12px",
      flexShrink: 0,
    }}>
      <SidebarContent user={user} myDepartments={myDepartments} router={router} />
    </aside>
  );
}

function MobileSidebar({ open, onClose, user, myDepartments, router }: {
  open: boolean;
  onClose: () => void;
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
}) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)",
      zIndex: 50, display: "flex",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 280, background: COLORS.bgCard, padding: "20px 12px",
        boxShadow: "4px 0 20px rgba(0,0,0,0.12)", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingLeft: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: COLORS.text }}>메뉴</div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, background: COLORS.bgPage, border: "none",
            cursor: "pointer", fontSize: 14, color: COLORS.textMuted,
          }}>✕</button>
        </div>
        <SidebarContent user={user} myDepartments={myDepartments} router={router} onNavigate={onClose} />
      </div>
    </div>
  );
}

function SidebarContent({ user, myDepartments, router, onNavigate }: {
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
  onNavigate?: () => void;
}) {
  const isAdmin = ["admin", "office", "pastor"].includes(user.role);
  const sideMenus = isAdmin ? [...COMMON_MENUS, ...ADMIN_EXTRA_MENUS] : COMMON_MENUS;
  const approved = myDepartments.filter((d) => d.status === "approved");
  const pending = myDepartments.filter((d) => d.status === "pending");

  const go = (path: string) => {
    router.push(path);
    onNavigate?.();
  };

  return (
    <>
      <SideLabel>내 사역 · 부서</SideLabel>
      {approved.length === 0 ? (
        <div style={{ padding: "8px 12px", fontSize: 11, color: COLORS.textMuted, fontStyle: "italic" }}>
          배정된 사역이 없습니다
        </div>
      ) : (
        approved.map((d) => (
          <SidebarItem key={d.id} onClick={() => go(`/departments/d/${d.department_id}`)}>
            <span style={{ marginRight: 6 }}>{d.icon || "📁"}</span>
            {d.name}
          </SidebarItem>
        ))
      )}
      {pending.map((d) => (
        <div key={d.id} style={{
          padding: "6px 12px", fontSize: 11,
          color: COLORS.warn, background: COLORS.warnSoft,
          borderRadius: 6, marginBottom: 3,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <span>⏳</span><span style={{ flex: 1 }}>{d.name}</span>
          <span style={{ fontSize: 10, opacity: 0.7 }}>대기</span>
        </div>
      ))}

      <button onClick={() => go("/departments")} style={{
        marginTop: 8, width: "100%",
        padding: "10px 12px",
        background: COLORS.accentSoft,
        border: "none",
        borderRadius: 8,
        fontSize: 12, fontWeight: 700, color: COLORS.accent,
        cursor: "pointer", fontFamily: "inherit",
        textAlign: "center",
      }}>
        + 사역 · 부서 가입
      </button>

      {user.pasture_name && (
        <>
          <SideDivider />
          <SideLabel>내 목장</SideLabel>
          <SidebarItem onClick={() => alert("목장 상세 화면은 준비 중입니다.")}>
            🏘️ {user.pasture_name}목장
          </SidebarItem>
        </>
      )}

      <SideDivider />
      <SideLabel>공통</SideLabel>
      {sideMenus.map((m) => (
        <SidebarItem key={m.id} onClick={() => m.href ? go(m.href) : alert(`${m.label}은(는) 곧 추가됩니다.`)}>
          <span style={{ marginRight: 6 }}>{m.icon}</span>{m.label}
        </SidebarItem>
      ))}
    </>
  );
}

function SidebarItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      padding: "10px 12px",
      borderRadius: 8,
      marginBottom: 3,
      fontSize: 13,
      fontWeight: 500,
      color: COLORS.text,
      background: "transparent",
      cursor: "pointer",
    }}>
      {children}
    </div>
  );
}

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: COLORS.textMuted,
      letterSpacing: 1, marginBottom: 8, paddingLeft: 8,
    }}>{children}</div>
  );
}

function SideDivider() {
  return <div style={{ height: 1, background: COLORS.border, margin: "16px 0" }} />;
}

// =============================================================
// 종료 모달 / 토스트
// =============================================================
function ExitModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 300, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 20,
        padding: "28px 24px", maxWidth: 360, width: "100%",
        boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🙏</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: COLORS.text, marginBottom: 8 }}>
          종료하시겠습니까?
        </div>
        <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 22, lineHeight: 1.7 }}>
          오늘 하루도 주 안에서<br />평안하세요
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: "13px",
            background: COLORS.bgPage, color: COLORS.text,
            border: "none", borderRadius: 12,
            fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}>취소</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: "13px",
            background: COLORS.danger, color: "#fff",
            border: "none", borderRadius: 12,
            fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}>종료</button>
        </div>
      </div>
    </div>
  );
}

function ExitToast() {
  return (
    <div style={{
      position: "fixed", left: "50%", bottom: 80,
      transform: "translateX(-50%)",
      background: "rgba(15, 23, 42, 0.92)", color: "#fff",
      padding: "12px 20px", borderRadius: 999,
      fontSize: 13, fontWeight: 600,
      boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
      zIndex: 400, whiteSpace: "nowrap", pointerEvents: "none",
    }}>
      뒤로가기 버튼을 한 번 더 누르시면 종료됩니다
    </div>
  );
}

// =============================================================
// 로딩 스타일
// =============================================================
const loadingStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: COLORS.bgPage,
  fontFamily: "'Noto Sans KR', sans-serif",
};
