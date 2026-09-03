"use client";

import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { photoThumb } from "@/lib/photo";
import { getRoleImageByLabel } from "@/lib/roles";
import HeaderLogo from "@/components/HeaderLogo";
import DeptIcon from "@/components/DeptIcon";
import {
  type LucideIcon,
  BookOpen, BookText, Users, User, Lightbulb, Vote, Megaphone, CalendarDays,
  Landmark, Bus, CalendarClock, Menu, LogOut, X, Folder, Home,
  Clock, Building2, KeyRound, Shuffle, UserPlus, LayoutGrid, MessagesSquare, SearchCheck,
  Sparkles, HeartHandshake, Sun, Moon, BarChart3, Radio, MapPin,
  GraduationCap, ChevronRight, CloudRain, CloudOff,
  Cog, GripVertical, Eye, EyeOff, Pencil,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import { useWeatherEffect } from "@/lib/useWeatherEffect";
import { LoadingView } from "@/components/StatusViews";
import WeatherOverlay from "@/components/WeatherOverlay";
import ModalBackdrop from "@/components/ModalBackdrop";
import {
  applyHomeMenuConfig, parseHomeMenuConfig, homeMenuKeyOf,
  EMPTY_HOME_MENU_CONFIG, type HomeMenuConfig,
} from "@/lib/homeMenuConfig";
import {
  T, PageShell, PageContent,
  Section, SectionHeader,
  SafeCard, SafeRow, SafeGrow, SafeGrid,
  IconBox, Badge, SolidButton, OutlineButton,
} from "@/components/Layout";

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
// 메뉴 데이터
// =============================================================
type CommonMenu = {
  id: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  href?: string;
};

const COMMON_MENUS: CommonMenu[] = [
  { id: "live",      label: "예배",  icon: Radio,     color: "var(--accent)", bg: "var(--accent-soft)", desc: "", href: "/live" },
  { id: "bulletin",  label: "주보 보기",     icon: BookOpen,  color: "var(--accent)", bg: "var(--accent-soft)", desc: "", href: "/bulletin" },
  { id: "directory", label: "성도 요람",     icon: Users,     color: "var(--accent)", bg: "var(--accent-soft)", desc: "", href: "/directory" },
  { id: "education-history", label: "삶공부·교육이력(구현중)", icon: GraduationCap, color: "var(--accent)", bg: "var(--accent-soft)", desc: "", href: "/education-history" },
  { id: "facility",  label: "시설 신청(구현중)", icon: Landmark,  color: "var(--accent)", bg: "var(--accent-soft)", desc: "", href: "/facility" },
  { id: "feedback",  label: "불편신고/건의", icon: Lightbulb, color: "var(--accent)", bg: "var(--accent-soft)", desc: "", href: "/feedback" },
  { id: "manual",    label: "사용 매뉴얼",   icon: BookText,  color: "var(--accent)", bg: "var(--accent-soft)", desc: "", href: "/manual" },
];

const ADMIN_EXTRA_MENUS: CommonMenu[] = [
  { id: "attendance", label: "교회 출석 현황", icon: MapPin, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "", href: "/attendance" },
  { id: "attendance-settings", label: "자동출석 설정", icon: MapPin, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "", href: "/attendance/settings" },
  { id: "vote",     label: "투표",        icon: Vote,          color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "", href: "/vote" },
  { id: "messenger-reports", label: "메신저 신고", icon: MessagesSquare, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "", href: "/admin/messenger-reports" },
  // 이메일 미등록 성도는 본인 재설정이 불가능해 관리자 초기화가 유일한 경로다 (화면 자체는 admin role 만 통과)
  { id: "password-reset", label: "비밀번호 초기화", icon: KeyRound, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "", href: "/admin/password-reset" },
  { id: "messenger-diagnostics", label: "메신저 진단", icon: SearchCheck, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "", href: "/admin/messenger-diagnostics" },
  { id: "usage-status", label: "이용 현황", icon: BarChart3, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "", href: "/admin/usage-status" },
  { id: "live-status", label: "실시간예배 점검", icon: Radio, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "", href: "/admin/live-status" },
  { id: "events",   label: "행사 공지",   icon: Megaphone,     color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "" },
  { id: "calendar", label: "행사 달력",   icon: CalendarDays,  color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "" },
  { id: "life-study-apply", label: "삶공부 신청", icon: GraduationCap, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "" },
  // 시설 신청은 전 성도가 쓰는 기능이라 COMMON_MENUS 로 옮겼다 (관리자 메뉴 중복 노출 방지)
  { id: "vehicle",  label: "차량 신청",   icon: Bus,           color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "" },
  { id: "booking",  label: "예약 캘린더", icon: CalendarClock, color: "var(--brass)", bg: "color-mix(in srgb, var(--brass) 15%, transparent)", desc: "" },
];

const ADMIN_SYSTEM_MENU_IDS = new Set(["messenger-diagnostics", "usage-status", "live-status"]);
const ADMIN_MENU_GROUPS = [
  {
    id: "implemented",
    label: "구현된 메뉴",
    menus: ADMIN_EXTRA_MENUS.filter((menu) => menu.href && !ADMIN_SYSTEM_MENU_IDS.has(menu.id)),
  },
  {
    id: "unimplemented",
    label: "미구현된 메뉴",
    menus: ADMIN_EXTRA_MENUS.filter((menu) => !menu.href),
  },
  {
    id: "system",
    label: "시스템점검",
    menus: ADMIN_EXTRA_MENUS.filter((menu) => ADMIN_SYSTEM_MENU_IDS.has(menu.id)),
  },
] as const;
type AdminMenuGroupId = (typeof ADMIN_MENU_GROUPS)[number]["id"];

// 편집모드 드래그 중 커서를 따라다니는 미리보기 카드
type HomeMenuDragPreview = {
  left: number;
  top: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  menu: CommonMenu;
};

// 편집 팝업에서 "기본값" 을 보여주려면 코드에 정의된 원래 메뉴가 필요하다
const ALL_HOME_MENUS: CommonMenu[] = [...COMMON_MENUS, ...ADMIN_EXTRA_MENUS];

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
  // 관리자가 바꾼 메인메뉴 이름·순서·숨김 (전 성도 공통) — 실패 시 기본 메뉴 그대로
  const [menuConfig, setMenuConfig] = useState<HomeMenuConfig>(EMPTY_HOME_MENU_CONFIG);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const { data } = await supabase.rpc("get_my_full_info");
      const profile = data?.[0];
      if (!profile || profile.status !== "active") {
        await supabase.auth.signOut();
        router.replace("/login?notice=pending");
        return;
      }
      setUser(profile);
      setAuthChecked(true);

      // 일일 방문 기록은 GlobalNotifications(전역)에서 처리 — 어떤 경로로 들어와도 집계됨

      const [{ data: depts }, { data: photos }, { data: menuCfg, error: menuCfgError }] = await Promise.all([
        supabase.rpc("get_my_departments"),
        supabase.rpc("get_my_photos"),
        supabase.rpc("get_home_menu_config"),
      ]);
      if (depts) setMyDepartments(depts);
      if (!menuCfgError && menuCfg) setMenuConfig(parseHomeMenuConfig(menuCfg));
      if (photos && photos[0]) {
        setPhotoUrl(photos[0].avatar_url || photos[0].member_photo_url || null);
      }
    })();
  }, [router]);

  // 뒤로가기 가드 (기존 로직 유지)
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
      if (sidebarOpenRef.current) setSidebarOpen(false);
      else if (!showExitModalRef.current) setShowExitModal(true);
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
    // 네이티브 앱(WebView)에서는 셸에 종료 신호 → 한 번에 즉시 종료
    const rnWebView = (window as unknown as {
      ReactNativeWebView?: { postMessage: (msg: string) => void };
    }).ReactNativeWebView;
    if (rnWebView) {
      rnWebView.postMessage(JSON.stringify({ type: "CHFLOW_EXIT_APP" }));
      return;
    }
    // 브라우저/PWA: 기존 동작 유지 (뒤로가기 한 번 더 → 종료)
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
      <PageShell style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <img src="/brand-mark-192.png" style={{ width: 64, height: 64, borderRadius: 14, marginBottom: 12, opacity: 0.85 }} />
          <LoadingView />
        </div>
      </PageShell>
    );
  }

  const isAdmin = ["admin", "office", "pastor"].includes(user.role);
  const userImage = getRoleImageByLabel(user.sub_role || "");

  return (
    <PageShell>
      <WeatherOverlay />

      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile-trigger { display: flex !important; }
          .admin-btn-label { display: none !important; }
          .home-summary-grid { grid-template-columns: 1fr !important; }
          .home-menu-grid { grid-template-columns: 1fr !important; }
          .admin-menu-grid { grid-template-columns: 1fr !important; }
          .admin-menu-tabs {
            display: flex !important;
            gap: 4px;
            margin-bottom: 10px;
            padding: 4px;
            border: 1px solid var(--hairline);
            border-radius: 12px;
            background: var(--card);
          }
          .admin-menu-tab {
            flex: 1 1 0;
            min-width: 0;
            padding: 9px 3px;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: var(--ink-faint);
            font-family: inherit;
            font-size: 10.5px;
            font-weight: 800;
            line-height: 1.25;
            white-space: nowrap;
            word-break: keep-all;
            cursor: pointer;
          }
          .admin-menu-tab[aria-selected="true"] {
            background: color-mix(in srgb, var(--brass) 15%, transparent);
            color: var(--brass);
          }
          .admin-menu-group-heading { display: none !important; }
          .admin-menu-group { margin-top: 0 !important; }
          .admin-menu-group[data-mobile-active="false"] { display: none; }
          /* 편집모드에서는 탭 대신 모든 그룹을 펼치므로 소제목을 다시 보여준다 */
          .admin-menu-group-editing .admin-menu-group-heading { display: block !important; }
          .admin-menu-group-editing + .admin-menu-group-editing { margin-top: 16px !important; }
          .compact-action { width: 100% !important; justify-content: center !important; }
          .command-center { grid-template-columns: 1fr !important; padding: 18px !important; }
          .command-actions { justify-content: stretch !important; }
        }
        @media (min-width: 769px) {
          .sidebar-mobile-trigger { display: none !important; }
        }
        @media (min-width: 1024px) {
          .home-menu-grid { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
          .admin-menu-grid { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
        }
      `}</style>

      <AppBar
        isAdmin={isAdmin}
        router={router}
        onMenu={() => setSidebarOpen((s) => !s)}
      />

      <div style={{ display: "flex", minHeight: "calc(100vh - 64px)", width: "100%", maxWidth: "100%", minWidth: 0 }}>
        <DesktopSidebar user={user} myDepartments={myDepartments} router={router} onLogout={handleLogout} menuConfig={menuConfig} />
        <MobileSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={user}
          myDepartments={myDepartments}
          router={router}
          onLogout={handleLogout}
          menuConfig={menuConfig}
        />

        <div style={{ flex: 1, minWidth: 0, width: "100%", maxWidth: "100%" }}>
          <PageContent maxWidth={1040}>
            <UserSummary
              user={user}
              photoUrl={photoUrl}
              userImage={userImage}
              router={router}
            />

            {/* TODO: 나의 목장(가입신청/목장보기) — 구현 완료 후 아래 주석 해제, home-summary-grid 안으로 이동 */}
            {/* <MyMokjangSection user={user} /> */}

            <CellShepherdSection user={user} router={router} />

            <div className="home-summary-grid" style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 14,
              marginBottom: 18,
            }}>
              <MinistrySection myDepartments={myDepartments} router={router} />
            </div>

            <CommonMenuSection
              isAdmin={isAdmin}
              canEditMenu={user.role === "admin"}
              router={router}
              menuConfig={menuConfig}
              onMenuConfigChange={setMenuConfig}
            />
          </PageContent>
        </div>
      </div>

      {showExitModal && <ExitModal onCancel={handleExitCancel} onConfirm={handleExitConfirm} />}
      {showExitToast && <ExitToast />}
    </PageShell>
  );
}

// =============================================================
// 상단 앱바
// =============================================================
function AppBar({ isAdmin, router, onMenu }: {
  isAdmin: boolean;
  router: RouterType;
  onMenu: () => void;
}) {
  return (
    <div style={{
      background: T.bgCard,
      borderBottom: `1px solid ${T.border}`,
      padding: "10px clamp(12px, 4vw, 20px) 10px",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      gap: 8,
      minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexShrink: 1 }}>
        <HeaderLogo />
        <div style={{ minWidth: 0 }}>
          <div className="line-clamp-1" style={{ fontSize: 16, fontWeight: 800, color: T.text }}>스마트명성</div>
          <div className="line-clamp-1" style={{ fontSize: 10, color: T.textMuted, letterSpacing: 0.5 }}>Smart Myungsung</div>
        </div>
      </div>

      <div className="header-actions" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", minWidth: 0 }}>
        {isAdmin && <AdminDropdown router={router} />}
        <button
          className="sidebar-mobile-trigger"
          onClick={onMenu}
          aria-label="메뉴"
          style={{
            display: "none", alignItems: "center", justifyContent: "center",
            width: 40, height: 40, borderRadius: 10,
            background: T.bgPage, border: `1px solid ${T.border}`,
            cursor: "pointer", color: T.text,
            flexShrink: 0,
          }}
        ><Menu size={20} strokeWidth={1.75} /></button>
      </div>
    </div>
  );
}

function AdminDropdown({ router }: { router: RouterType }) {
  return (
    <button
      onClick={() => router.push("/admin/members")}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "8px 12px", borderRadius: 10,
        background: T.ministryBg,
        border: `1px solid ${T.border}`,
        color: T.ministryPoint, cursor: "pointer",
        fontSize: 12, fontWeight: 700, fontFamily: "inherit",
        whiteSpace: "nowrap", flexShrink: 0,
      }}
    >
      <KeyRound size={13} strokeWidth={1.75} />
      관리자
    </button>
  );
}

// =============================================================
// 데스크톱 운영 허브
// =============================================================
function CommandCenter({ user, myDepartments, isAdmin, router }: {
  user: UserInfo;
  myDepartments: MyDepartment[];
  isAdmin: boolean;
  router: RouterType;
}) {
  const approvedCount = myDepartments.filter((d) => d.status === "approved").length;
  const pendingCount = myDepartments.filter((d) => d.status === "pending").length;

  return (
    <section
      className="command-center"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.25fr) minmax(280px, 0.75fr)",
        gap: 18,
        alignItems: "stretch",
        marginBottom: 18,
        padding: 22,
        borderRadius: 18,
        border: "1px solid rgba(62, 90, 74, 0.22)",
        background: "linear-gradient(135deg, #2F4638 0%, #3E5A4A 52%, #6E6047 100%)",
        color: "#FFFDF7",
        boxShadow: "0 24px 56px rgba(47, 70, 56, 0.22)",
        overflow: "hidden",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 9px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.13)",
          border: "1px solid rgba(255,255,255,0.18)",
          fontSize: 12,
          fontWeight: 800,
          color: "rgba(255,255,255,0.86)",
          marginBottom: 12,
        }}>
          <LayoutGrid size={14} strokeWidth={1.8} />
          HOME DASHBOARD
        </div>
        <div className="kr-keep" style={{
          fontFamily: "var(--app-serif)",
          fontSize: "clamp(26px, 3vw, 36px)",
          fontWeight: 600,
          lineHeight: 1.18,
          letterSpacing: 0,
        }}>
          {isAdmin ? "운영 업무를 한 화면에서" : `${user.name}님의 스마트명성 홈`}
        </div>
        <div className="kr-keep" style={{
          marginTop: 10,
          maxWidth: 560,
          fontSize: 14,
          lineHeight: 1.65,
          color: "rgba(255,255,255,0.78)",
        }}>
          사역, 목장, 공통 메뉴를 더 낮은 카드와 선명한 액션으로 정리했습니다.
        </div>
        <div className="command-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
          {isAdmin ? (
            <>
              <CommandButton label="회원 관리" onClick={() => router.push("/admin/members")} />
              <CommandButton label="사역·부서 승인" onClick={() => router.push("/admin/dept-pending")} />
            </>
          ) : (
            <CommandButton label="내 정보 관리" onClick={() => router.push("/myinfo")} />
          )}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 8,
        alignContent: "end",
      }}>
        <CommandStat label="승인 사역" value={`${approvedCount}`} />
        <CommandStat label="대기" value={`${pendingCount}`} />
        <CommandStat label="목장" value={user.pasture_name ? "소속" : "미소속"} />
      </div>
    </section>
  );
}

function CommandButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        minHeight: 38,
        padding: "0 14px",
        borderRadius: 9,
        border: "1px solid rgba(255,255,255,0.24)",
        background: "color-mix(in srgb, var(--card) 92%, transparent)",
        color: "var(--accent-strong)",
        fontSize: 13,
        fontWeight: 800,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

function CommandStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      minHeight: 76,
      padding: "12px 10px",
      borderRadius: 12,
      background: "rgba(255,255,255,0.12)",
      border: "1px solid rgba(255,255,255,0.17)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      minWidth: 0,
    }}>
      <div className="line-clamp-1 kr-keep" style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.66)" }}>{label}</div>
      <div className="line-clamp-1 kr-keep" style={{ fontSize: 20, fontWeight: 800, color: "#FFFDF7" }}>{value}</div>
    </div>
  );
}

// =============================================================
// 사용자 요약
// =============================================================
function UserSummary({ user, photoUrl, userImage, router }: {
  user: UserInfo;
  photoUrl: string | null;
  userImage: string;
  router: RouterType;
}) {
  const subParts = [
    user.sub_role,
    user.family_church && user.family_church !== "목원" ? user.family_church : null,
  ].filter(Boolean) as string[];

  const SIZE = 56;
  const OVERLAP = Math.round(SIZE / 3); // 1/3 가려짐 → 2/3 노출

  return (
    <SafeCard onClick={() => router.push("/myinfo")} padding={16} style={{ marginBottom: 18, borderRadius: 20, background: "var(--card)", border: "1px solid var(--hairline)", boxShadow: "0 2px 16px rgba(26,22,18,0.06)", cursor: "pointer", position: "relative", overflow: "hidden" }}>
      {/* 보태니컬 데코 — 우측 하단 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/leaf-deco.webp"
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute", right: -14, bottom: -14,
          width: 130, height: 130,
          opacity: 0.65,
          mixBlendMode: "multiply",
          pointerEvents: "none",
          userSelect: "none",
          draggable: false,
        } as React.CSSProperties}
      />
      <SafeRow gap={14}>
        {/* 겹친 사진 + 직분 아바타 (좌우 겹침) */}
        <div style={{ position: "relative", width: SIZE + (SIZE - OVERLAP), height: SIZE, flexShrink: 0 }}>
          {/* 직분 아바타 (오른쪽, 뒤) */}
          <img
            src={userImage}
            alt={user.sub_role || "직분"}
            style={{
              position: "absolute", top: 0, right: 0,
              width: SIZE, height: SIZE, borderRadius: "50%",
              objectFit: "cover", objectPosition: "center 18%",
              background: "var(--bg-soft)",
              border: `2px solid ${T.bgCard}`,
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              zIndex: 1,
            }}
          />
          {/* 프로필 사진 (왼쪽, 앞) */}
          {photoUrl ? (
            <img
              src={photoThumb(photoUrl, 128)}
              alt="프로필"
              style={{
                position: "absolute", top: 0, left: 0,
                width: SIZE, height: SIZE, borderRadius: "50%",
                objectFit: "cover", objectPosition: "top center",
                border: `2px solid ${T.bgCard}`,
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                zIndex: 2,
              }}
            />
          ) : (
            <div style={{
              position: "absolute", top: 0, left: 0,
              width: SIZE, height: SIZE, borderRadius: "50%",
              background: "var(--hairline-strong)",
              border: `2px solid ${T.bgCard}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--ink-faint)", zIndex: 2,
            }}><User size={24} strokeWidth={1.8} /></div>
          )}
        </div>

        <SafeGrow>
          <div className="line-clamp-1 kr-keep" style={{ fontSize: 18, fontWeight: 800, color: T.text }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {user.name}님 <HeartHandshake size={16} strokeWidth={1.8} style={{ color: "var(--accent)" }} />
            </span>
          </div>
          {subParts.length > 0 && (
            <div className="line-clamp-1 kr-keep" style={{ marginTop: 2, fontSize: 13, color: T.textMuted }}>
              {subParts.join(" · ")}
            </div>
          )}
          <div className="line-clamp-1 kr-keep" style={{ marginTop: 4, fontSize: 12, color: T.textMuted }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              오늘도 평안한 하루 되세요 <Sparkles size={12} strokeWidth={1.8} />
            </span>
          </div>
        </SafeGrow>
      </SafeRow>
    </SafeCard>
  );
}

// =============================================================
// 1) 내 사역 · 부서
// =============================================================
function MinistrySection({ myDepartments, router }: { myDepartments: MyDepartment[]; router: RouterType }) {
  const approved = myDepartments.filter((d) => d.status === "approved");
  const pending = myDepartments.filter((d) => d.status === "pending");
  const empty = approved.length === 0 && pending.length === 0;

  return (
    <Section bg="var(--surface)" style={{ height: "100%", marginBottom: 0, border: "1px solid var(--hairline)" }}>
      <SectionHeader
        icon={<Folder size={18} strokeWidth={1.75} />}
        iconColor="var(--accent)"
        title="내 사역 · 부서"
        action={
          <button
            onClick={() => router.push("/departments")}
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 700,
              color: T.ministryPoint, background: "transparent",
              border: `1.5px dashed ${T.ministryPoint}`, borderRadius: 8,
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >+ 가입</button>
        }
      />

      {empty ? (
        <SafeCard padding={13} style={{ marginBottom: 10, borderRadius: 10 }}>
          <div className="kr-keep" style={{ fontSize: 14, color: T.textMuted }}>
            아직 가입된 사역 · 부서가 없습니다
          </div>
        </SafeCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: "100%", minWidth: 0 }}>
          {approved.map((d) => (
            <MinistryCard
              key={d.id}
              dept={d}
              status="approved"
              onClick={() => router.push(`/departments/d/${d.department_id}`)}
            />
          ))}
          {pending.map((d) => (
            <MinistryCard
              key={d.id}
              dept={d}
              status="pending"
              onClick={() => router.push(`/departments/d/${d.department_id}`)}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function MinistryCard({ dept, status, onClick }: {
  dept: MyDepartment;
  status: "approved" | "pending";
  onClick: () => void;
}) {
  return (
    <SafeCard onClick={onClick} padding={12} style={{ borderRadius: 14, background: "var(--card)", border: "1px solid var(--hairline)", boxShadow: "0 1px 4px rgba(26,22,18,0.04)" }}>
      <SafeRow gap={12}>
        <IconBox bg="var(--accent-soft)" size={40}>
          <DeptIcon name={dept.name} category={dept.category} size={20} />
        </IconBox>
        <SafeGrow>
          <div className="line-clamp-1 kr-keep" style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>
            {dept.category}
          </div>
          <div className="line-clamp-1 kr-keep" style={{ fontSize: 15, fontWeight: 800, color: T.text, marginTop: 1 }}>
            {dept.name}
          </div>
        </SafeGrow>
        <Badge tone={status === "approved" ? "success" : "warn"} label={status === "approved" ? "승인됨" : "가입중"} />
      </SafeRow>
    </SafeCard>
  );
}

// =============================================================
// 1-1) 나의 목장 — 목장 모임(전 목원) + 목장일지(목자/목녀 전용)
//
// 아래 MyMokjangSection(가입신청/목장보기)은 아직 미구현이라 계속 숨겨둔다.
// 목장 모임은 소속 목장이 있으면 누구나, 목장일지는 예전처럼 목자·목녀만 본다.
// =============================================================
function CellShepherdSection({ user, router }: { user: UserInfo; router: RouterType }) {
  const isCellShepherd = user.family_church === "목자" || user.family_church === "목녀";
  const hasPasture = !!user.pasture_name;
  if (!isCellShepherd && !hasPasture) return null;

  return (
    <Section bg="var(--surface)" style={{ marginBottom: 18, border: "1px solid var(--hairline)" }}>
      <SectionHeader
        icon={<Home size={18} strokeWidth={1.75} />}
        iconColor="var(--accent)"
        title="나의 목장"
      />
      {hasPasture && (
        <SafeCard onClick={() => router.push("/pasture")} padding={12} style={{ borderRadius: 10, marginBottom: isCellShepherd ? 8 : 0 }}>
          <SafeRow gap={12}>
            <IconBox bg="var(--accent-soft)" size={40}>
              <CalendarDays size={21} strokeWidth={1.75} color="var(--accent)" />
            </IconBox>
            <SafeGrow>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>목장 모임</div>
              <div className="line-clamp-1 kr-keep" style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                {user.pasture_name}목장 · 가능일 표시 · 참석 확인
              </div>
            </SafeGrow>
            <ChevronRight size={16} strokeWidth={1.8} color={T.textMuted} />
          </SafeRow>
        </SafeCard>
      )}
      {isCellShepherd && (
        <SafeCard onClick={() => router.push("/pasture/journal")} padding={12} style={{ borderRadius: 10 }}>
          <SafeRow gap={12}>
            <IconBox bg="var(--accent-soft)" size={40}>
              <BookText size={21} strokeWidth={1.75} color="var(--accent)" />
            </IconBox>
            <SafeGrow>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>목장일지</div>
              <div className="line-clamp-1 kr-keep" style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                해외선교 후원목장 · 본인 UMS 계정으로 열람
              </div>
            </SafeGrow>
            <ChevronRight size={16} strokeWidth={1.8} color={T.textMuted} />
          </SafeRow>
        </SafeCard>
      )}
    </Section>
  );
}

// =============================================================
// 2) 나의 목장 — 가입신청 / 목장보기 (미구현, 아직 숨김)
// =============================================================
function MyMokjangSection({ user }: { user: UserInfo }) {
  const hasPasture = !!user.pasture_name;

  // TODO: 목장 가입 신청 화면(/pasture/request) 추가 시 router.push 로 연결
  const handleJoinRequest = () => {
    alert("목장 가입 신청 기능은 준비 중입니다.\n관리자에게 직접 문의하시거나 잠시만 기다려주세요.");
  };
  // TODO: 목장 상세 화면(/pasture/me 또는 /pasture/[id]) 추가 시 연결
  const handleViewPasture = () => {
    alert("목장 상세 화면은 준비 중입니다.");
  };
  // TODO: 승인 대기 상태 분기 — pasture_requests 테이블/RPC 추가되면 이 자리에 분기 추가

  return (
    <Section bg="var(--accent-soft)" style={{ height: "100%", marginBottom: 0 }}>
      <SectionHeader
        icon={<Home size={18} strokeWidth={1.75} />}
        iconColor={T.mokjangPoint}
        title="나의 목장"
        subtitle="소속 목장을 확인하거나 가입 신청하세요"
      />

      {hasPasture ? (
        <SafeCard onClick={handleViewPasture} padding={12} style={{ borderRadius: 10 }}>
          <SafeRow gap={12}>
            <IconBox bg="var(--accent-soft)" size={40}>
              <Home size={21} strokeWidth={1.75} color="var(--accent)" />
            </IconBox>
            <SafeGrow>
              <div className="line-clamp-1 kr-keep" style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>
                {[user.plain_name && `${user.plain_name}평원`, user.grassland_name && `${user.grassland_name}초원`]
                  .filter(Boolean).join(" · ") || "소속 목장"}
              </div>
              <div className="line-clamp-1 kr-keep" style={{ fontSize: 17, fontWeight: 800, color: T.text, marginTop: 2 }}>
                {user.pasture_name}목장
              </div>
              {user.spouse_name && (
                <div className="line-clamp-1 kr-keep" style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                  배우자: {user.spouse_name}
                </div>
              )}
            </SafeGrow>
            <span style={{
              flexShrink: 0,
              padding: "6px 10px",
              background: "var(--accent-soft)",
              color: T.mokjangPoint,
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}>목장 보기</span>
          </SafeRow>
        </SafeCard>
      ) : (
        <SafeCard padding={12} style={{ borderRadius: 10 }}>
          <SafeRow gap={12} align="flex-start">
            <IconBox bg="var(--accent-soft)" size={40}>
              <Home size={21} strokeWidth={1.75} color="var(--accent)" />
            </IconBox>
            <SafeGrow>
              <div className="kr-keep" style={{ fontSize: 15, fontWeight: 800, color: T.text, lineHeight: 1.35 }}>
                아직 소속된 목장이 없습니다
              </div>
              <div className="kr-keep" style={{ fontSize: 13, color: T.textMuted, marginTop: 4, lineHeight: 1.5 }}>
                목장을 찾아 가입 신청할 수 있습니다
              </div>
              <div style={{ marginTop: 10 }}>
                <SolidButton
                  label="목장 가입 신청"
                  color={T.mokjangPoint}
                  onClick={handleJoinRequest}
                  style={compactSolidButtonStyle}
                />
              </div>
            </SafeGrow>
          </SafeRow>
        </SafeCard>
      )}
    </Section>
  );
}

// =============================================================
// 3) 공통 메뉴
// =============================================================
function CommonMenuSection({ isAdmin, canEditMenu, router, menuConfig, onMenuConfigChange }: {
  isAdmin: boolean;
  canEditMenu: boolean;
  router: RouterType;
  menuConfig: HomeMenuConfig;
  onMenuConfigChange: Dispatch<SetStateAction<HomeMenuConfig>>;
}) {
  // 생방송 여부는 서버가 스로틀링하는 /api/live/status 에서 받는다 (YouTube 직접 호출 아님)
  // null = 아직 모름 → 표시등을 아예 띄우지 않는다 (모르는 상태를 OFF AIR 로 단정하지 않기)
  const [liveOn, setLiveOn] = useState<boolean | null>(null);
  const [activeAdminMenuGroup, setActiveAdminMenuGroup] = useState<AdminMenuGroupId>(ADMIN_MENU_GROUPS[0].id);
  // 편집모드 (관리자만) — 카드 드래그로 순서, 카드 클릭으로 이름/숨김 변경
  const [editing, setEditing] = useState(false);
  const [editTarget, setEditTarget] = useState<{ groupId: string; menuId: string } | null>(null);
  const [toast, setToast] = useState("");
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<HomeMenuDragPreview | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<{
    groupId: string;
    menuId: string;
    startOrder: string[];
    currentOrder: string[];
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  // 편집모드 그리드 순서 드래그 — 같은 그룹 안에서만 이동한다
  const startItemDrag = (
    e: React.PointerEvent,
    groupId: string,
    menuId: string,
    orderedIds: string[],
    menu: CommonMenu,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const source = itemRefs.current.get(`${groupId}:${menuId}`);
    const rect = source?.getBoundingClientRect();
    const offsetX = rect ? e.clientX - rect.left : 24;
    const offsetY = rect ? e.clientY - rect.top : 24;
    dragRef.current = { groupId, menuId, startOrder: orderedIds, currentOrder: orderedIds, offsetX, offsetY };
    setDraggingKey(`${groupId}:${menuId}`);
    setDragPreview({
      left: rect?.left ?? e.clientX - offsetX,
      top: rect?.top ?? e.clientY - offsetY,
      width: rect?.width ?? 200,
      height: rect?.height ?? 64,
      offsetX,
      offsetY,
      menu,
    });

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const st = dragRef.current;
      if (!st) return;
      setDragPreview((preview) => preview ? {
        ...preview,
        left: ev.clientX - st.offsetX,
        top: ev.clientY - st.offsetY,
      } : null);

      // 화면 위/아래 끝에 닿으면 자동 스크롤
      const edge = 72;
      if (ev.clientY < edge) {
        window.scrollBy(0, -Math.max(4, Math.round((edge - ev.clientY) / 4)));
      } else if (ev.clientY > window.innerHeight - edge) {
        window.scrollBy(0, Math.max(4, Math.round((ev.clientY - (window.innerHeight - edge)) / 4)));
      }

      for (const otherId of st.currentOrder) {
        if (otherId === st.menuId) continue;
        const el = itemRefs.current.get(`${st.groupId}:${otherId}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) continue;
        const next = [...st.currentOrder];
        const from = next.indexOf(st.menuId);
        if (from < 0) return;
        next.splice(from, 1);
        const to = next.indexOf(otherId);
        next.splice(to < 0 ? next.length : to, 0, st.menuId);
        if (next.join("|") === st.currentOrder.join("|")) return;
        st.currentOrder = next;
        onMenuConfigChange((prev) => ({ ...prev, order: { ...prev.order, [st.groupId]: next } }));
        return;
      }
    };

    const onUp = async () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const st = dragRef.current;
      dragRef.current = null;
      setDraggingKey(null);
      setDragPreview(null);
      if (!st) return;
      if (st.currentOrder.join("|") === st.startOrder.join("|")) return;
      const { error } = await supabase.rpc("set_home_menu_item_order", {
        p_group: st.groupId,
        p_order: st.currentOrder,
      });
      if (error) {
        onMenuConfigChange((prev) => ({ ...prev, order: { ...prev.order, [st.groupId]: st.startOrder } }));
        showToast(`순서 저장 실패: ${error.message}`);
      } else {
        showToast("메뉴 순서를 저장했습니다");
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const read = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const res = await fetch("/api/live/status", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setLiveOn(!!json.is_live);
      } catch {
        // 실패 시 배지를 켜지 않는다
      } finally {
        inFlight = false;
      }
    };
    read();
    let timer: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState === "visible") timer = setInterval(read, 120_000);
    };
    const readWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        stopPolling();
        return;
      }
      read();
      startPolling();
    };
    const readWhenActive = () => {
      if (document.visibilityState === "visible") read();
    };
    startPolling();
    document.addEventListener("visibilitychange", readWhenVisible);
    window.addEventListener("focus", readWhenActive);
    window.addEventListener("pageshow", readWhenActive);
    window.addEventListener("chflow:app-active", readWhenActive);
    return () => {
      alive = false;
      stopPolling();
      document.removeEventListener("visibilitychange", readWhenVisible);
      window.removeEventListener("focus", readWhenActive);
      window.removeEventListener("pageshow", readWhenActive);
      window.removeEventListener("chflow:app-active", readWhenActive);
    };
  }, []);

  // 저장된 이름·순서·숨김 적용 (편집모드에서는 숨긴 메뉴도 보여야 다시 켤 수 있다)
  const commonMenus = applyHomeMenuConfig("common", COMMON_MENUS, menuConfig, { includeHidden: editing });
  const adminGroups = ADMIN_MENU_GROUPS
    .map((group) => ({
      id: group.id,
      label: group.label,
      items: applyHomeMenuConfig(group.id, [...group.menus], menuConfig, { includeHidden: editing }),
    }))
    .filter((group) => group.items.length > 0);
  const selectedAdminGroup = adminGroups.some((group) => group.id === activeAdminMenuGroup)
    ? activeAdminMenuGroup
    : adminGroups[0]?.id;

  const renderMenuGrid = (
    groupId: string,
    items: (CommonMenu & { hidden: boolean })[],
    options: { gap: number; className: string; compact?: boolean },
  ) => {
    const orderedIds = items.map((item) => item.id);
    return (
      <SafeGrid cols={2} gap={options.gap} className={options.className}>
        {items.map((m) => (
          <MenuCard
            key={m.id}
            menu={m}
            router={router}
            compact={options.compact}
            live={groupId === "common" && m.id === "live" ? liveOn : undefined}
            editing={editing}
            menuHidden={m.hidden}
            dragging={draggingKey === `${groupId}:${m.id}`}
            cardRef={(el) => {
              const key = `${groupId}:${m.id}`;
              if (el) itemRefs.current.set(key, el);
              else itemRefs.current.delete(key);
            }}
            onEdit={editing ? () => setEditTarget({ groupId, menuId: m.id }) : undefined}
            onDragHandle={editing ? (e) => startItemDrag(e, groupId, m.id, orderedIds, m) : undefined}
          />
        ))}
      </SafeGrid>
    );
  };

  return (
    <Section bg="var(--surface)" style={{ border: "1px solid var(--hairline)" }}>
      <SectionHeader
        icon={<LayoutGrid size={18} strokeWidth={1.75} />}
        iconColor="var(--accent)"
        title="공통 메뉴"
        action={canEditMenu ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            title={editing ? "편집 종료" : "메인메뉴 편집"}
            aria-label={editing ? "메인메뉴 편집 종료" : "메인메뉴 편집"}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
              border: `1px solid ${editing ? "var(--accent)" : "var(--hairline)"}`,
              background: editing ? "var(--accent-soft)" : "var(--card)",
              color: editing ? "var(--accent-strong)" : "var(--ink-soft)",
            }}
          >
            <Cog
              size={17}
              strokeWidth={1.9}
              className={editing ? "animate-spin" : ""}
              style={editing ? { animationDuration: "3s" } : undefined}
            />
          </button>
        ) : undefined}
      />

      {editing && (
        <div style={{
          marginBottom: 12, padding: "10px 12px", borderRadius: 10,
          background: "var(--accent-soft)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
          fontSize: 11.5, fontWeight: 600, lineHeight: 1.5, color: "var(--accent-strong)",
        }}>
          카드를 끌어 순서를 바꾸고(모바일은 길게 누른 뒤 이동), 카드를 눌러 이름·숨김을 바꿉니다.
          <br />변경한 이름·순서·숨김은 <strong>모든 성도 화면</strong>에 그대로 적용됩니다.
        </div>
      )}

      {renderMenuGrid("common", commonMenus, { gap: 10, className: "home-menu-grid" })}

      {isAdmin && adminGroups.length > 0 && (
        <>
          <div style={{
            marginTop: 20, marginBottom: 10,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>관리자 메뉴</span>
            <span style={{
              padding: "2px 7px", background: "color-mix(in srgb, var(--brass) 15%, transparent)", borderRadius: 5,
              fontSize: 9, fontWeight: 800, color: "var(--brass)", letterSpacing: 0.8,
              textTransform: "uppercase",
            }}>ADMIN</span>
          </div>
          {!editing && (
            <div className="admin-menu-tabs" role="tablist" aria-label="관리자 메뉴 분류" style={{ display: "none" }}>
              {adminGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  className="admin-menu-tab"
                  id={`admin-menu-tab-${group.id}`}
                  aria-selected={selectedAdminGroup === group.id}
                  aria-controls={`admin-menu-panel-${group.id}`}
                  onClick={() => setActiveAdminMenuGroup(group.id)}
                >
                  {group.label}
                </button>
              ))}
            </div>
          )}
          {adminGroups.map((group, index) => (
            <div
              key={group.id}
              id={`admin-menu-panel-${group.id}`}
              role="tabpanel"
              aria-labelledby={`admin-menu-tab-${group.id}`}
              className={`admin-menu-group${editing ? " admin-menu-group-editing" : ""}`}
              // 편집모드에서는 모바일 탭 전환을 끄고 모든 그룹을 펼쳐 둔다 (숨긴 메뉴를 찾아 되살릴 수 있게)
              data-mobile-active={editing ? true : selectedAdminGroup === group.id}
              style={{ marginTop: index === 0 ? 0 : 16 }}
            >
              <div
                className="admin-menu-group-heading"
                style={{ marginBottom: 8, fontSize: 11, fontWeight: 800, color: "var(--ink-faint)" }}
              >
                {group.label}
              </div>
              {renderMenuGrid(group.id, group.items, { gap: 9, className: "admin-menu-grid", compact: true })}
            </div>
          ))}
        </>
      )}

      {dragPreview && (() => {
        const PreviewIcon = dragPreview.menu.icon;
        return (
          <div style={{
            position: "fixed", left: dragPreview.left, top: dragPreview.top,
            width: dragPreview.width, minHeight: dragPreview.height, zIndex: 2000,
            boxSizing: "border-box", pointerEvents: "none", userSelect: "none",
            background: "var(--card)", border: `2px solid ${dragPreview.menu.color}`,
            borderRadius: 14, padding: 12, display: "flex", alignItems: "center", gap: 10,
            boxShadow: "0 16px 36px rgba(43, 39, 34, 0.24)", opacity: 0.96,
            transform: "scale(1.025) rotate(0.6deg)",
            transformOrigin: `${dragPreview.offsetX}px ${dragPreview.offsetY}px`,
          }}>
            <IconBox bg={dragPreview.menu.bg} size={36}>
              <PreviewIcon size={18} strokeWidth={1.8} color={dragPreview.menu.color} />
            </IconBox>
            <div className="kr-break" style={{ fontSize: 13, fontWeight: 800, color: T.text, lineHeight: 1.25, minWidth: 0 }}>
              {dragPreview.menu.label}
            </div>
          </div>
        );
      })()}

      {editTarget && (
        <EditHomeMenuPopup
          groupId={editTarget.groupId}
          menuId={editTarget.menuId}
          setting={menuConfig.settings[homeMenuKeyOf(editTarget.groupId, editTarget.menuId)]}
          onClose={() => setEditTarget(null)}
          onSaved={(next) => {
            onMenuConfigChange(next);
            setEditTarget(null);
            showToast("메뉴를 수정했습니다");
          }}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 2100,
          padding: "11px 18px", borderRadius: 999, background: "var(--ink)", color: "var(--card)",
          fontSize: 12.5, fontWeight: 700, boxShadow: "0 10px 26px rgba(26, 22, 18, 0.22)", whiteSpace: "nowrap",
        }}>{toast}</div>
      )}
    </Section>
  );
}

function MenuCard({ menu, router, compact, live, editing, menuHidden, onEdit, onDragHandle, dragging, cardRef }: {
  menu: CommonMenu;
  router: RouterType;
  compact?: boolean;
  live?: boolean | null;
  editing?: boolean;
  menuHidden?: boolean;
  onEdit?: () => void;
  onDragHandle?: (e: React.PointerEvent) => void;
  dragging?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  // 편집모드 드래그 — PC 는 바로, 모바일은 길게 눌러야 시작한다 (스크롤과 충돌 방지)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef<{ x: number; y: number; type: string } | null>(null);
  const touchGuardCleanup = useRef<(() => void) | null>(null);
  const dragMoved = useRef(false);
  const longPressFired = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const clearTouchGuard = () => {
    touchGuardCleanup.current?.();
    touchGuardCleanup.current = null;
  };

  const installTouchGuard = () => {
    clearTouchGuard();
    const blockActiveDrag = (event: TouchEvent) => {
      if (longPressFired.current) event.preventDefault();
    };
    const finishTouch = () => clearTouchGuard();
    window.addEventListener("touchmove", blockActiveDrag, { passive: false });
    window.addEventListener("pointerup", finishTouch, { once: true });
    window.addEventListener("pointercancel", finishTouch, { once: true });
    touchGuardCleanup.current = () => {
      window.removeEventListener("touchmove", blockActiveDrag);
      window.removeEventListener("pointerup", finishTouch);
      window.removeEventListener("pointercancel", finishTouch);
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!onDragHandle || e.button !== 0) return;
    clearLongPress();
    pointerStart.current = { x: e.clientX, y: e.clientY, type: e.pointerType };
    dragMoved.current = false;
    longPressFired.current = false;

    if (e.pointerType !== "touch") {
      onDragHandle(e);
      return;
    }

    e.stopPropagation();
    installTouchGuard();
    const pointerId = e.pointerId;
    const target = e.currentTarget;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      try { target.setPointerCapture(pointerId); } catch { /* 이미 끝난 터치는 무시 */ }
      onDragHandle(e);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(25);
    }, 450);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    dragMoved.current = true;
    if (start.type === "touch" && !longPressFired.current) clearLongPress();
  };

  const handlePointerEnd = () => {
    clearLongPress();
    clearTouchGuard();
    pointerStart.current = null;
  };

  const handleClick = () => {
    if (dragMoved.current || longPressFired.current) {
      dragMoved.current = false;
      longPressFired.current = false;
      return;
    }
    if (onEdit) { onEdit(); return; }
    if (menu.href) router.push(menu.href);
    else alert(`${menu.label}은(는) 곧 추가됩니다.`);
  };

  const card = (
    <SafeCard
      onClick={handleClick}
      padding={compact ? 12 : 14}
      onPointerDown={onDragHandle ? handlePointerDown : undefined}
      onPointerMove={onDragHandle ? handlePointerMove : undefined}
      onPointerUp={onDragHandle ? handlePointerEnd : undefined}
      onPointerCancel={onDragHandle ? handlePointerEnd : undefined}
      onContextMenu={onDragHandle ? (e) => e.preventDefault() : undefined}
      title={onDragHandle ? "PC: 카드를 드래그 · 모바일: 길게 누른 뒤 드래그 · 탭하면 이름·숨김 수정" : undefined}
      style={{
        minHeight: compact ? 58 : 68,
        borderRadius: 14,
        background: "var(--card)",
        border: `1px solid ${dragging ? "var(--accent)" : "var(--hairline)"}`,
        boxShadow: "0 1px 4px rgba(26,22,18,0.04)",
        transition: dragging ? "none" : "border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease",
        opacity: dragging ? 0.18 : menuHidden ? 0.5 : 1,
        cursor: onDragHandle ? (dragging ? "grabbing" : "grab") : "pointer",
        userSelect: onDragHandle ? "none" : undefined,
        WebkitUserSelect: onDragHandle ? "none" : undefined,
        WebkitTouchCallout: onDragHandle ? "none" : undefined,
      }}
      onMouseOver={(e) => {
        if (dragging) return;
        e.currentTarget.style.borderColor = menu.color;
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 8px 20px rgba(26,22,18,0.10)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = dragging ? "var(--accent)" : "var(--hairline)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(26,22,18,0.04)";
      }}
    >
      <SafeRow gap={10}>
        {editing && (
          <GripVertical size={15} strokeWidth={2} color="var(--ink-faint)" className="safe-shrink-0" />
        )}
        <IconBox bg={menu.bg} size={compact ? 36 : 38}>
          <menu.icon size={compact ? 18 : 19} strokeWidth={1.8} color={menu.color} />
        </IconBox>
        <SafeGrow>
          {/* 긴 메뉴명("불편신고/건의") 보호: kr-break 로 어디서든 줄바꿈 + leading-snug */}
          <div className="kr-break" style={{
            fontSize: compact ? 13 : 14,
            fontWeight: 800,
            color: T.text,
            lineHeight: 1.25,
          }}>{menu.label}</div>
        </SafeGrow>
        {/* 방송 상태 표시등 — 글씨 아래가 아니라 카드 오른쪽 끝, 세로 중앙에 둔다 */}
        {typeof live === "boolean" && (
          <span style={{
            flexShrink: 0, alignSelf: "center",
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 8px", borderRadius: 999,
            background: live
              ? "color-mix(in srgb, var(--success) 16%, transparent)"
              : "color-mix(in srgb, var(--danger) 14%, transparent)",
            color: live ? "var(--success)" : "var(--danger)",
            fontSize: 9, fontWeight: 800, letterSpacing: 0.6, whiteSpace: "nowrap",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: live ? "var(--success)" : "var(--danger)",
              boxShadow: live ? "0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent)" : "none",
            }} />
            {live ? "ON AIR" : "OFF AIR"}
          </span>
        )}
        {editing && menuHidden && (
          <span className="safe-shrink-0" style={{
            alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 3,
            padding: "3px 7px", borderRadius: 999,
            background: "color-mix(in srgb, var(--ink-faint) 18%, transparent)",
            color: "var(--ink-mid)", fontSize: 9, fontWeight: 800, whiteSpace: "nowrap",
          }}>
            <EyeOff size={10} strokeWidth={2.2} /> 숨김
          </span>
        )}
        {editing && <Pencil size={13} strokeWidth={2} color="var(--ink-faint)" className="safe-shrink-0" />}
      </SafeRow>
    </SafeCard>
  );

  // 편집모드에서만 래퍼 div 를 씌운다 (드래그 위치 계산용 ref — 평상시 DOM 은 그대로)
  if (!editing) return card;
  return <div ref={cardRef} style={{ minWidth: 0 }}>{card}</div>;
}

// =============================================================
// 메인메뉴 수정 팝업 (관리자 전용) — 이름 변경 / 숨김
//   저장 후 최신 설정을 다시 읽어 화면 전체에 반영한다
// =============================================================
function EditHomeMenuPopup({ groupId, menuId, setting, onClose, onSaved }: {
  groupId: string;
  menuId: string;
  setting?: { label: string | null; hidden: boolean };
  onClose: () => void;
  onSaved: (next: HomeMenuConfig) => void;
}) {
  const base = ALL_HOME_MENUS.find((m) => m.id === menuId);
  const defaultLabel = base?.label ?? "";
  const menuKey = homeMenuKeyOf(groupId, menuId);

  const [label, setLabel] = useState(setting?.label && setting.label.trim() ? setting.label : defaultLabel);
  const [hidden, setHidden] = useState(setting?.hidden === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (nextLabel: string, nextHidden: boolean) => {
    if (!nextLabel.trim()) { setError("메뉴 이름을 입력하세요"); return; }
    setSaving(true);
    setError("");
    const { error: saveError } = await supabase.rpc("set_home_menu_setting", {
      p_menu_key: menuKey,
      // 기본 이름 그대로면 덮어쓰기 값을 지워 코드 기본값을 따라가게 한다
      p_label: nextLabel.trim() === defaultLabel ? null : nextLabel.trim(),
      p_hidden: nextHidden,
    });
    if (saveError) { setError(`저장 실패: ${saveError.message}`); setSaving(false); return; }
    const { data } = await supabase.rpc("get_home_menu_config");
    setSaving(false);
    onSaved(parseHomeMenuConfig(data));
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ width: "100%", maxWidth: 420, background: "var(--card)", borderRadius: 18, overflow: "hidden" }}>
        <div style={{ borderBottom: "1px solid var(--hairline)", padding: "15px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 7 }}>
            <Pencil size={16} strokeWidth={2} /> 메뉴 수정
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "var(--bg-soft)", color: "var(--ink-mid)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", letterSpacing: 0.2 }}>메뉴 이름</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={defaultLabel}
              maxLength={40}
              style={{
                width: "100%", marginTop: 5, padding: "10px 12px", fontSize: 14, background: "var(--card)",
                border: "1.5px solid var(--hairline)", borderRadius: 9, outline: "none", fontFamily: "inherit",
                boxSizing: "border-box", color: "var(--ink)", fontWeight: 500,
              }}
            />
            <div style={{ marginTop: 5, fontSize: 11, color: "var(--ink-faint)" }}>기본 이름: {defaultLabel}</div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", letterSpacing: 0.2 }}>홈 화면 표시</label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {[{ v: false, t: "표시", Icon: Eye }, { v: true, t: "숨김", Icon: EyeOff }].map((opt) => {
                const active = hidden === opt.v;
                return (
                  <button
                    key={opt.t}
                    type="button"
                    onClick={() => setHidden(opt.v)}
                    style={{
                      flex: 1, padding: "10px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit",
                      fontSize: 13.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                      border: `1.5px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
                      background: active ? "var(--accent-soft)" : "var(--card)",
                      color: active ? "var(--accent-strong)" : "var(--ink-soft)",
                    }}
                  >
                    <opt.Icon size={14} strokeWidth={2} /> {opt.t}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 5, fontSize: 11, color: "var(--ink-faint)" }}>
              숨기면 성도 화면과 사이드바에서 사라집니다 (관리자 편집모드에서는 계속 보입니다).
            </div>
          </div>

          {error && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>{error}</div>}
        </div>

        <div style={{ borderTop: "1px solid var(--hairline)", padding: "14px 18px", display: "flex", gap: 10 }}>
          <button
            onClick={() => { setLabel(defaultLabel); setHidden(false); save(defaultLabel, false); }}
            disabled={saving}
            style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid var(--hairline-strong)", background: "var(--card)", color: "var(--ink-mid)", fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}
          >기본값</button>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid var(--hairline-strong)", background: "var(--card)", color: "var(--ink-mid)", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}
          >취소</button>
          <button
            onClick={() => save(label, hidden)}
            disabled={saving}
            style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: "inherit" }}
          >{saving ? "저장 중..." : "저장"}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// =============================================================
// 하단 안내
// =============================================================
function NoticeBox() {
  return (
    <div
      className="kr-keep"
      style={{
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        padding: "14px 18px",
        background: T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        fontSize: 12,
        color: T.textMuted,
        lineHeight: 1.7,
        marginTop: 4,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      <Lightbulb size={15} strokeWidth={1.75} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
      <span>
        직분별 · 사역별 전용 게시판은 추후 추가될 예정입니다.<br />
        현재는 공통 메뉴를 사용할 수 있습니다.
      </span>
    </div>
  );
}

// =============================================================
// 사이드바
// =============================================================
function DesktopSidebar({ user, myDepartments, router, onLogout, menuConfig }: {
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
  onLogout: () => void;
  menuConfig: HomeMenuConfig;
}) {
  return (
    <aside className="sidebar-desktop" style={{
      width: 220,
      background: T.bgCard,
      borderRight: `1px solid ${T.border}`,
      padding: "20px 12px",
      flexShrink: 0,
      minWidth: 0,
    }}>
      <SidebarContent user={user} myDepartments={myDepartments} router={router} onLogout={onLogout} menuConfig={menuConfig} />
    </aside>
  );
}

function MobileSidebar({ open, onClose, user, myDepartments, router, onLogout, menuConfig }: {
  open: boolean;
  onClose: () => void;
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
  onLogout: () => void;
  menuConfig: HomeMenuConfig;
}) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(43, 39, 34, 0.5)",
      zIndex: 50, display: "flex", justifyContent: "flex-end",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "min(280px, 80vw)", background: T.bgCard, padding: "20px 12px",
        boxShadow: "-4px 0 20px rgba(0,0,0,0.12)", overflowY: "auto",
        boxSizing: "border-box",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingLeft: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>메뉴</div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 8, background: T.bgPage, border: "none",
            cursor: "pointer", color: T.textMuted,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}><X size={16} strokeWidth={1.75} /></button>
        </div>
        <SidebarContent user={user} myDepartments={myDepartments} router={router} onNavigate={onClose} onLogout={onLogout} menuConfig={menuConfig} />
      </div>
    </div>
  );
}

function SidebarContent({ user, myDepartments, router, onNavigate, onLogout, menuConfig }: {
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
  onNavigate?: () => void;
  onLogout: () => void;
  menuConfig: HomeMenuConfig;
}) {
  const isAdmin = ["admin", "office", "pastor"].includes(user.role);
  // 홈 카드와 같은 이름·순서·숨김을 사이드바에도 적용 (같은 메뉴가 두 곳에서 다르게 보이지 않게)
  const sideMenus: CommonMenu[] = [
    ...applyHomeMenuConfig("common", COMMON_MENUS, menuConfig),
    ...(isAdmin
      ? ADMIN_MENU_GROUPS.flatMap((group) => applyHomeMenuConfig(group.id, [...group.menus], menuConfig))
      : []),
  ];
  const approved = myDepartments.filter((d) => d.status === "approved");
  const pending = myDepartments.filter((d) => d.status === "pending");
  const go = (path: string) => { router.push(path); onNavigate?.(); };

  return (
    <div style={{ minWidth: 0 }}>
      <SideLabel>내 사역 · 부서</SideLabel>
      {approved.length === 0 ? (
        <div className="kr-keep" style={{ padding: "8px 12px", fontSize: 11, color: T.textMuted, fontStyle: "italic" }}>
          배정된 사역이 없습니다
        </div>
      ) : (
        approved.map((d) => (
          <SidebarItem key={d.id} onClick={() => go(`/departments/d/${d.department_id}`)}>
            <DeptIcon name={d.name} size={15} color="currentColor" style={{ marginRight: 6 }} />
            <span className="kr-keep">{d.name}</span>
          </SidebarItem>
        ))
      )}
      {pending.map((d) => (
        <div key={d.id} className="safe-row" style={{
          padding: "6px 12px", fontSize: 11,
          color: T.warn, background: T.warnSoft,
          borderRadius: 6, marginBottom: 3,
        }}>
          <Clock size={13} strokeWidth={1.75} className="safe-shrink-0" />
          <span className="safe-grow line-clamp-1 kr-keep">{d.name}</span>
          <span className="safe-shrink-0" style={{ fontSize: 10, opacity: 0.7 }}>대기</span>
        </div>
      ))}

      <button onClick={() => go("/departments")} className="kr-keep" style={{
        marginTop: 8, width: "100%", maxWidth: "100%",
        padding: "10px 12px", boxSizing: "border-box",
        background: T.ministryBg,
        border: "none",
        borderRadius: 8,
        fontSize: 12, fontWeight: 700, color: T.ministryPoint,
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
            <Home size={15} strokeWidth={1.75} style={{ marginRight: 6, flexShrink: 0 }} />
            <span className="kr-keep">{user.pasture_name}목장</span>
          </SidebarItem>
        </>
      )}

      <SideDivider />
      <SideLabel>공통</SideLabel>
      {sideMenus.map((m) => (
        <SidebarItem key={m.id} onClick={() => m.href ? go(m.href) : alert(`${m.label}은(는) 곧 추가됩니다.`)}>
          <m.icon size={15} strokeWidth={1.75} style={{ marginRight: 6, flexShrink: 0 }} />
          <span className="kr-keep">{m.label}</span>
        </SidebarItem>
      ))}

      <SideDivider />
      <WeatherToggleButton />
      <ThemeToggleButton />
      <button
        onClick={onLogout}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "10px 12px", boxSizing: "border-box",
          background: "transparent", border: "none", borderRadius: 8,
          fontSize: 13, fontWeight: 500, color: T.textMuted,
          cursor: "pointer", fontFamily: "inherit",
        }}
      >
        <LogOut size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
        <span>로그아웃</span>
      </button>
    </div>
  );
}

function WeatherToggleButton() {
  const { enabled, toggle } = useWeatherEffect();
  return (
    <button
      onClick={toggle}
      aria-pressed={enabled}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "10px 12px", boxSizing: "border-box",
        background: "transparent", border: "none", borderRadius: 8,
        fontSize: 13, fontWeight: 500, color: T.textMuted,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {enabled
          ? <CloudRain size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
          : <CloudOff size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />}
        <span className="kr-keep">날씨 반영</span>
      </span>
      <span style={{
        fontSize: 11, padding: "2px 7px", borderRadius: 99,
        background: "var(--hairline)", color: T.textMuted,
      }}>
        {enabled ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function ThemeToggleButton() {
  const { isDark, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", padding: "10px 12px", boxSizing: "border-box",
        background: "transparent", border: "none", borderRadius: 8,
        fontSize: 13, fontWeight: 500, color: T.textMuted,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {isDark
          ? <Moon size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />
          : <Sun size={15} strokeWidth={1.75} style={{ flexShrink: 0 }} />}
        <span>{isDark ? "다크 모드" : "라이트 모드"}</span>
      </span>
      <span style={{
        fontSize: 11, padding: "2px 7px", borderRadius: 99,
        background: "var(--hairline)", color: T.textMuted,
      }}>
        {isDark ? "ON" : "OFF"}
      </span>
    </button>
  );
}

function SidebarItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      display: "flex",
      alignItems: "center",
      padding: "10px 12px",
      borderRadius: 8,
      marginBottom: 3,
      fontSize: 13,
      fontWeight: 500,
      color: T.text,
      cursor: "pointer",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
      minWidth: 0,
    }}>
      {children}
    </div>
  );
}

function SideLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: T.textMuted,
      letterSpacing: 1, marginBottom: 8, paddingLeft: 8,
    }}>{children}</div>
  );
}

function SideDivider() {
  return <div style={{ height: 1, background: T.border, margin: "16px 0" }} />;
}

const compactSolidButtonStyle: React.CSSProperties = {
  width: "auto",
  minHeight: 40,
  padding: "0 16px",
  borderRadius: 9,
  fontSize: 13,
  fontWeight: 800,
  boxShadow: "0 10px 20px rgba(62, 90, 74, 0.16)",
};

const compactOutlineButtonStyle: React.CSSProperties = {
  width: "auto",
  minHeight: 38,
  padding: "0 14px",
  borderRadius: 9,
  borderWidth: 1.5,
  borderStyle: "dashed",
  fontSize: 13,
  fontWeight: 700,
  background: "transparent",
  color: "var(--accent)",
};

// =============================================================
// 종료 모달 / 토스트
// =============================================================
function ExitModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, background: "rgba(43, 39, 34, 0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 300, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--card)", borderRadius: 20,
        padding: "28px 24px", maxWidth: 360, width: "100%",
        boxShadow: "0 20px 60px rgba(43, 39, 34, 0.25)",
        textAlign: "center", boxSizing: "border-box",
      }}>
        <div style={{ marginBottom: 12, color: "var(--ink-faint)" }}><HeartHandshake size={44} strokeWidth={1.5} /></div>
        <div className="kr-keep" style={{ fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 8 }}>
          종료하시겠습니까?
        </div>
        <div className="kr-keep" style={{ fontSize: 13, color: T.textMuted, marginBottom: 22, lineHeight: 1.7 }}>
          오늘 하루도 주 안에서<br />평안하세요
        </div>
        <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: "100%", minWidth: 0 }}>
          <button onClick={onCancel} style={{
            flex: 1, minWidth: 0, padding: "13px",
            background: T.bgPage, color: T.text,
            border: "none", borderRadius: 12,
            fontSize: 14, fontWeight: 700,
            cursor: "pointer", fontFamily: "inherit",
          }}>취소</button>
          <button onClick={onConfirm} style={{
            flex: 1, minWidth: 0, padding: "13px",
            background: T.danger, color: "#fff",
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
      background: "rgba(43, 39, 34, 0.92)", color: "#fff",
      padding: "12px 20px", borderRadius: 999,
      fontSize: 13, fontWeight: 600,
      boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
      zIndex: 400, whiteSpace: "nowrap", pointerEvents: "none",
      maxWidth: "calc(100vw - 24px)",
    }}>
      뒤로가기 버튼을 한 번 더 누르시면 종료됩니다
    </div>
  );
}
