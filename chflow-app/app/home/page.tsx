"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getRoleImageByLabel } from "@/lib/roles";
import HeaderLogo from "@/components/HeaderLogo";
import DeptIcon from "@/components/DeptIcon";
import {
  type LucideIcon,
  BookOpen, BookText, Users, User, Lightbulb, Vote, Megaphone, CalendarDays,
  Landmark, Bus, CalendarClock, Menu, LogOut, X, Folder, Home,
  Clock, Building2, KeyRound, Shuffle, UserPlus, LayoutGrid, MessagesSquare,
  Sparkles, HeartHandshake, Sun, Moon,
} from "lucide-react";
import { useTheme } from "@/lib/useTheme";
import { LoadingView } from "@/components/StatusViews";
import WeatherOverlay from "@/components/WeatherOverlay";
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
  { id: "bulletin",  label: "주보 보기",     icon: BookOpen,  color: "#2B4539", bg: "#EDF2EF", desc: "", href: "/bulletin" },
  { id: "directory", label: "성도 요람",     icon: Users,     color: "#2B4539", bg: "#EDF2EF", desc: "", href: "/directory" },
  { id: "feedback",  label: "불편신고/건의", icon: Lightbulb, color: "#2B4539", bg: "#EDF2EF", desc: "", href: "/feedback" },
  { id: "manual",    label: "사용 매뉴얼",   icon: BookText,  color: "#2B4539", bg: "#EDF2EF", desc: "", href: "/manual" },
];

const ADMIN_EXTRA_MENUS: CommonMenu[] = [
  { id: "vote",     label: "투표",        icon: Vote,          color: "#B8963E", bg: "#F5EDD8", desc: "", href: "/vote" },
  { id: "messenger-reports", label: "메신저 신고", icon: MessagesSquare, color: "#B8963E", bg: "#F5EDD8", desc: "", href: "/admin/messenger-reports" },
  { id: "events",   label: "행사 공지",   icon: Megaphone,     color: "#B8963E", bg: "#F5EDD8", desc: "" },
  { id: "calendar", label: "행사 달력",   icon: CalendarDays,  color: "#B8963E", bg: "#F5EDD8", desc: "" },
  { id: "facility", label: "시설 신청",   icon: Landmark,      color: "#B8963E", bg: "#F5EDD8", desc: "" },
  { id: "vehicle",  label: "차량 신청",   icon: Bus,           color: "#B8963E", bg: "#F5EDD8", desc: "" },
  { id: "booking",  label: "예약 캘린더", icon: CalendarClock, color: "#B8963E", bg: "#F5EDD8", desc: "" },
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

      const [{ data: depts }, { data: photos }] = await Promise.all([
        supabase.rpc("get_my_departments"),
        supabase.rpc("get_my_photos"),
      ]);
      if (depts) setMyDepartments(depts);
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
    <PageShell style={{ background: "#F5F1EB" }}>
      <WeatherOverlay />

      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile-trigger { display: flex !important; }
          .admin-btn-label { display: none !important; }
          .home-summary-grid { grid-template-columns: 1fr !important; }
          .home-menu-grid { grid-template-columns: 1fr !important; }
          .admin-menu-grid { grid-template-columns: 1fr !important; }
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
        <DesktopSidebar user={user} myDepartments={myDepartments} router={router} onLogout={handleLogout} />
        <MobileSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          user={user}
          myDepartments={myDepartments}
          router={router}
          onLogout={handleLogout}
        />

        <div style={{ flex: 1, minWidth: 0, width: "100%", maxWidth: "100%" }}>
          <PageContent maxWidth={1040}>
            <UserSummary
              user={user}
              photoUrl={photoUrl}
              userImage={userImage}
              router={router}
            />

            {/* TODO: 나의 목장 — 구현 완료 후 아래 주석 해제, home-summary-grid 안으로 이동 */}
            {/* <MyMokjangSection user={user} /> */}

            <div className="home-summary-grid" style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 14,
              marginBottom: 18,
            }}>
              <MinistrySection myDepartments={myDepartments} router={router} />
            </div>

            <CommonMenuSection isAdmin={isAdmin} router={router} />
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
        color: "#2F4638",
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
              src={photoUrl}
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
        iconColor="#2B4539"
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
        <IconBox bg="#EDF2EF" size={40}>
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
// 2) 나의 목장
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
            <IconBox bg="#EAF3ED" size={40}>
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
              background: "#EAF3ED",
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
            <IconBox bg="#EAF3ED" size={40}>
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
function CommonMenuSection({ isAdmin, router }: { isAdmin: boolean; router: RouterType }) {
  return (
    <Section bg="var(--surface)" style={{ border: "1px solid var(--hairline)" }}>
      <SectionHeader
        icon={<LayoutGrid size={18} strokeWidth={1.75} />}
        iconColor="#2B4539"
        title="공통 메뉴"
      />
      <SafeGrid cols={2} gap={10} className="home-menu-grid">
        {COMMON_MENUS.map((m) => <MenuCard key={m.id} menu={m} router={router} />)}
      </SafeGrid>

      {isAdmin && (
        <>
          <div style={{
            marginTop: 20, marginBottom: 10,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>관리자 메뉴</span>
            <span style={{
              padding: "2px 7px", background: "#F5EDD8", borderRadius: 5,
              fontSize: 9, fontWeight: 800, color: "#B8963E", letterSpacing: 0.8,
              textTransform: "uppercase",
            }}>ADMIN</span>
          </div>
          <SafeGrid cols={2} gap={9} className="admin-menu-grid">
            {ADMIN_EXTRA_MENUS.map((m) => <MenuCard key={m.id} menu={m} router={router} compact />)}
          </SafeGrid>
        </>
      )}
    </Section>
  );
}

function MenuCard({ menu, router, compact }: { menu: CommonMenu; router: RouterType; compact?: boolean }) {
  const handleClick = () => {
    if (menu.href) router.push(menu.href);
    else alert(`${menu.label}은(는) 곧 추가됩니다.`);
  };
  return (
    <SafeCard
      onClick={handleClick}
      padding={compact ? 12 : 14}
      style={{
        minHeight: compact ? 58 : 68,
        borderRadius: 14,
        background: "var(--card)",
        border: "1px solid var(--hairline)",
        boxShadow: "0 1px 4px rgba(26,22,18,0.04)",
        transition: "border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = menu.color;
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 8px 20px rgba(26,22,18,0.10)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--hairline)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(26,22,18,0.04)";
      }}
    >
      <SafeRow gap={10}>
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
      </SafeRow>
    </SafeCard>
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
function DesktopSidebar({ user, myDepartments, router, onLogout }: {
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
  onLogout: () => void;
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
      <SidebarContent user={user} myDepartments={myDepartments} router={router} onLogout={onLogout} />
    </aside>
  );
}

function MobileSidebar({ open, onClose, user, myDepartments, router, onLogout }: {
  open: boolean;
  onClose: () => void;
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
  onLogout: () => void;
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
        <SidebarContent user={user} myDepartments={myDepartments} router={router} onNavigate={onClose} onLogout={onLogout} />
      </div>
    </div>
  );
}

function SidebarContent({ user, myDepartments, router, onNavigate, onLogout }: {
  user: UserInfo;
  myDepartments: MyDepartment[];
  router: RouterType;
  onNavigate?: () => void;
  onLogout: () => void;
}) {
  const isAdmin = ["admin", "office", "pastor"].includes(user.role);
  const sideMenus = isAdmin ? [...COMMON_MENUS, ...ADMIN_EXTRA_MENUS] : COMMON_MENUS;
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
  color: "#4A7B6A",
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
