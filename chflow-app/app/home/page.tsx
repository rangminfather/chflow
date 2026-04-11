"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getRoleImageByLabel } from "@/lib/roles";
import NotificationBell from "@/components/NotificationBell";

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

// 공통 메뉴 (모든 사용자가 접근 가능)
const COMMON_MENUS = [
  { id: "bulletin",   label: "주보 보기",       icon: "📖", color: "#0ea5e9", desc: "주간 교회 주보" },
  { id: "events",     label: "행사 공지",       icon: "📢", color: "#0ea5e9", desc: "교회 행사/공지사항" },
  { id: "calendar",   label: "행사 달력",       icon: "📅", color: "#0ea5e9", desc: "월간 교회 행사" },
  { id: "directory",  label: "성도 요람",       icon: "👥", color: "#0ea5e9", desc: "성도 검색/조회" },
  { id: "facility",   label: "시설 이용 신청",  icon: "🏛️", color: "#f59e0b", desc: "예배실/교육관 등" },
  { id: "vehicle",    label: "차량 이용 신청",  icon: "🚐", color: "#f59e0b", desc: "교회 차량" },
  { id: "booking",    label: "예약 캘린더",     icon: "📆", color: "#f59e0b", desc: "내 예약 / 전체 현황" },
  { id: "myinfo",     label: "내 정보",         icon: "⚙️", color: "#64748b", desc: "프로필 수정" },
];

// 가정교회 메뉴
const PASTURE_MENUS = [
  { id: "members",    label: "목장원 목록",     icon: "👨‍👩‍👧", color: "#8b5cf6", desc: "우리 목장 멤버" },
  { id: "schedule",   label: "목장 일정",       icon: "📅", color: "#8b5cf6", desc: "모임 일정" },
  { id: "attend",     label: "참석 응답",       icon: "✋", color: "#8b5cf6", desc: "모임 참석 여부" },
  { id: "talent",     label: "달란트 적립",     icon: "🎁", color: "#8b5cf6", desc: "출석/봉사 달란트" },
];

export default function HomePage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [myDepartments, setMyDepartments] = useState<MyDepartment[]>([]);
  const [activeMenu, setActiveMenu] = useState<string>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const { data, error } = await supabase.rpc("get_my_full_info");
      const profile = data?.[0];
      if (!profile || profile.status !== "active") {
        await supabase.auth.signOut();
        router.replace("/login?notice=pending");
        return;
      }
      setUser(profile);
      setAuthChecked(true);

      // 내가 가입한 부서 로드
      const { data: depts } = await supabase.rpc("get_my_departments");
      if (depts) setMyDepartments(depts);
    })();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login?notice=logout");
  };

  if (!authChecked || !user) {
    return (
      <div style={loadingStyle}>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet" />
        <div style={{ textAlign: "center" }}>
          <img src="/icon-192.png" style={{ width: 64, height: 64, borderRadius: 14, marginBottom: 12, opacity: 0.8 }} />
          <div style={{ fontSize: 13, color: "#64748b" }}>로딩 중...</div>
        </div>
      </div>
    );
  }

  const isAdmin = ["admin", "office", "pastor"].includes(user.role);
  const userImage = getRoleImageByLabel(user.sub_role || "");

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop { display: none !important; }
          .sidebar-mobile-trigger { display: flex !important; }
          .main-content { padding: 16px !important; }
          .welcome-bar { padding: 14px 16px !important; flex-wrap: wrap; gap: 8px !important; }
          .welcome-text-full { display: none !important; }
          .welcome-text-short { display: block !important; }
          .menu-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .header-actions { gap: 6px !important; }
          .admin-btn-label { display: none !important; }
        }
        @media (min-width: 769px) {
          .sidebar-mobile-trigger { display: none !important; }
          .welcome-text-short { display: none !important; }
        }
      `}</style>

      {/* === 헤더 === */}
      <div style={{
        background: "#fff",
        borderBottom: "1px solid #e2e8f0",
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className="sidebar-mobile-trigger"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              display: "none",
              alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 8,
              background: "#f1f5f9", border: "none", cursor: "pointer",
              fontSize: 18, color: "#475569",
            }}
          >☰</button>
          <img src="/icon-192.png" alt="" style={{ width: 32, height: 32, borderRadius: 8 }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>스마트명성</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>Smart Myungsung</div>
          </div>
        </div>

        <div className="header-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* 알림 종 */}
          <NotificationBell userId={user.id} />
          {isAdmin && (
            <>
              <button
                onClick={() => router.push("/admin/pending")}
                title="회원가입 대기자"
                style={adminBtnStyle("#fef3c7", "#92400e")}
              >
                <span>⏳</span>
                <span className="admin-btn-label">가입자</span>
              </button>
              <button
                onClick={() => router.push("/admin/dept-pending")}
                title="부서 가입 승인"
                style={adminBtnStyle("#fce7f3", "#9d174d")}
              >
                <span>🏢</span>
                <span className="admin-btn-label">부서승인</span>
              </button>
              <button
                onClick={() => router.push("/admin/members")}
                title="회원 관리"
                style={adminBtnStyle("#eef2ff", "#6366f1")}
              >
                <span>👥</span>
                <span className="admin-btn-label">회원관리</span>
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                title="와이어프레임"
                style={adminBtnStyle("#f0fdf4", "#15803d")}
              >
                <span>📐</span>
                <span className="admin-btn-label">와이어</span>
              </button>
            </>
          )}
          <button onClick={handleLogout} title="로그아웃" style={{
            width: 36, height: 36, borderRadius: 8, background: "#f1f5f9", border: "none",
            cursor: "pointer", fontSize: 16, color: "#475569",
          }}>⏏</button>
        </div>
      </div>

      {/* === 환영 배너 === */}
      <div className="welcome-bar" style={{
        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
        padding: "20px 32px",
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}>
        <img
          src={userImage}
          alt={user.name}
          style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "#fff", padding: 2,
            objectFit: "cover", objectPosition: "top",
            border: "2px solid rgba(255,255,255,0.4)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        />
        <div style={{ flex: 1, color: "#fff", minWidth: 0 }}>
          <div className="welcome-text-full" style={{ fontSize: 18, fontWeight: 800 }}>
            <strong>{user.name}</strong>님 환영합니다! 🙏
          </div>
          <div className="welcome-text-short" style={{ display: "none", fontSize: 16, fontWeight: 800 }}>
            {user.name}님 🙏
          </div>
          <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {user.sub_role && (
              <span>📿 직분: <strong>{user.sub_role}</strong></span>
            )}
            {user.family_church && user.family_church !== '목원' && (
              <span>🏠 {user.family_church}</span>
            )}
            {user.pasture_name && (
              <span>🌿 {user.plain_name && `${user.plain_name}평원 · `}{user.pasture_name}목장</span>
            )}
          </div>
        </div>
      </div>

      {/* === 본문: 사이드바 + 메인 === */}
      <div style={{ display: "flex", minHeight: "calc(100vh - 145px)" }}>
        {/* === 데스크탑 사이드바 === */}
        <div className="sidebar-desktop" style={{
          width: 220,
          background: "#fff",
          borderRight: "1px solid #e2e8f0",
          padding: "20px 12px",
          flexShrink: 0,
        }}>
          <SidebarContent
            user={user}
            myDepartments={myDepartments}
            activeMenu={activeMenu}
            setActiveMenu={setActiveMenu}
            router={router}
          />
        </div>

        {/* === 모바일 사이드바 오버레이 === */}
        {sidebarOpen && (
          <div onClick={() => setSidebarOpen(false)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            zIndex: 50, display: "flex",
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              width: 260, background: "#fff", padding: "20px 12px",
              boxShadow: "4px 0 20px rgba(0,0,0,0.15)", overflowY: "auto",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, paddingLeft: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#1e293b" }}>메뉴</div>
                <button onClick={() => setSidebarOpen(false)} style={{
                  width: 28, height: 28, borderRadius: 6, background: "#f1f5f9", border: "none",
                  cursor: "pointer", fontSize: 14,
                }}>✕</button>
              </div>
              <SidebarContent
                user={user}
                myDepartments={myDepartments}
                activeMenu={activeMenu}
                setActiveMenu={(m) => { setActiveMenu(m); setSidebarOpen(false); }}
                router={router}
              />
            </div>
          </div>
        )}

        {/* === 메인 컨텐츠 === */}
        <div className="main-content" style={{ flex: 1, padding: 24, overflowX: "hidden" }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            {/* 환영 메시지 */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, marginBottom: 6 }}>
                MAIN
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#1e293b" }}>
                오늘도 평안한 하루 되세요 ✨
              </div>
            </div>

            {/* 가정교회 섹션 */}
            {user.pasture_name && (
              <div style={{ marginBottom: 28 }}>
                <SectionTitle icon="🏘️" title="우리 목장" subtitle={`${user.plain_name}평원 · ${user.grassland_name}초원 · ${user.pasture_name}목장`} />
                <div className="menu-grid" style={menuGridStyle}>
                  {PASTURE_MENUS.map(menu => (
                    <MenuCard key={menu.id} menu={menu} />
                  ))}
                </div>
              </div>
            )}

            {/* 공통 메뉴 섹션 */}
            <div style={{ marginBottom: 28 }}>
              <SectionTitle icon="✨" title="공통 메뉴" subtitle="모든 성도가 사용할 수 있는 기능" />
              <div className="menu-grid" style={menuGridStyle}>
                {COMMON_MENUS.map(menu => (
                  <MenuCard key={menu.id} menu={menu} />
                ))}
              </div>
            </div>

            {/* 알림 / 안내 */}
            <div style={{
              padding: "16px 20px",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 12,
              fontSize: 12,
              color: "#1e40af",
              lineHeight: 1.7,
            }}>
              💡 <strong>안내</strong> · 직분별·사역별 전용 게시판은 차차 추가될 예정입니다.<br />
              지금은 누구나 공통 메뉴를 사용하실 수 있습니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================
type RouterType = ReturnType<typeof useRouter>;

function SidebarContent({
  user,
  myDepartments,
  activeMenu,
  setActiveMenu,
  router,
}: {
  user: UserInfo;
  myDepartments: MyDepartment[];
  activeMenu: string;
  setActiveMenu: (m: string) => void;
  router: RouterType;
}) {
  // 카테고리별 그룹핑 (승인된 것만)
  const approvedDepts = myDepartments.filter((d) => d.status === "approved");
  const pendingDepts = myDepartments.filter((d) => d.status === "pending");

  const grouped: Record<string, MyDepartment[]> = {};
  approvedDepts.forEach((d) => {
    if (!grouped[d.category]) grouped[d.category] = [];
    grouped[d.category].push(d);
  });

  return (
    <>
      <div style={sidebarLabelStyle}>내 사역 · 부서</div>

      {Object.keys(grouped).length === 0 ? (
        <div style={{ padding: "10px 12px", fontSize: 11, color: "#cbd5e1", fontStyle: "italic" }}>
          배정된 사역이 없습니다
        </div>
      ) : (
        Object.entries(grouped).map(([category, depts]) => (
          <div key={category} style={{ marginBottom: 8 }}>
            <div style={{
              padding: "4px 12px",
              fontSize: 10,
              fontWeight: 700,
              color: "#6366f1",
              letterSpacing: 0.5,
            }}>
              📁 {category}
            </div>
            {depts.map((d) => (
              <SidebarItem
                key={d.id}
                active={activeMenu === `dept-${d.department_id}`}
                onClick={() => {
                  setActiveMenu(`dept-${d.department_id}`);
                  router.push(`/departments/d/${d.department_id}`);
                }}
              >
                <span style={{ marginRight: 6 }}>{d.icon || "📁"}</span>
                {d.name}
              </SidebarItem>
            ))}
          </div>
        ))
      )}

      {/* 승인 대기 표시 */}
      {pendingDepts.length > 0 && (
        <div style={{ marginTop: 4, marginBottom: 8 }}>
          {pendingDepts.map((d) => (
            <div key={d.id} style={{
              padding: "6px 12px",
              fontSize: 10,
              color: "#92400e",
              background: "#fef3c7",
              borderRadius: 6,
              marginBottom: 3,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}>
              <span>⏳</span>
              <span style={{ flex: 1 }}>{d.name}</span>
              <span style={{ fontSize: 9, opacity: 0.7 }}>대기</span>
            </div>
          ))}
        </div>
      )}

      {/* 가입 메뉴 링크 */}
      <div
        onClick={() => router.push("/departments")}
        style={{
          marginTop: 6,
          padding: "10px 12px",
          background: "linear-gradient(135deg, #eef2ff, #ede9fe)",
          border: "1.5px dashed #c7d2fe",
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 700,
          color: "#6366f1",
          cursor: "pointer",
          textAlign: "center",
        }}
      >
        ➕ 사역 · 부서 가입
      </div>

      {user.pasture_name && (
        <>
          <div style={{ height: 1, background: "#e2e8f0", margin: "16px 0" }} />
          <div style={sidebarLabelStyle}>내 목장</div>
          <SidebarItem active={activeMenu === "pasture"} onClick={() => setActiveMenu("pasture")}>
            🏘️ {user.pasture_name}목장
          </SidebarItem>
        </>
      )}

      <div style={{ height: 1, background: "#e2e8f0", margin: "16px 0" }} />
      <div style={sidebarLabelStyle}>공통</div>
      {COMMON_MENUS.slice(0, 6).map((menu) => (
        <SidebarItem key={menu.id} active={activeMenu === menu.id} onClick={() => setActiveMenu(menu.id)}>
          <span style={{ marginRight: 6 }}>{menu.icon}</span>
          {menu.label}
        </SidebarItem>
      ))}
    </>
  );
}

function SidebarItem({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{
      padding: "8px 12px",
      borderRadius: 8,
      marginBottom: 3,
      fontSize: 12,
      fontWeight: active ? 700 : 500,
      color: active ? "#6366f1" : "#475569",
      background: active ? "#eef2ff" : "transparent",
      cursor: "pointer",
      transition: "all 0.15s",
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b", display: "flex", alignItems: "center", gap: 8 }}>
        <span>{icon}</span>{title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, marginLeft: 28 }}>{subtitle}</div>
      )}
    </div>
  );
}

function MenuCard({ menu }: { menu: typeof COMMON_MENUS[0] }) {
  return (
    <div
      onClick={() => alert(`${menu.label} - 곧 구현됩니다!`)}
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 14,
        padding: "20px 16px",
        cursor: "pointer",
        transition: "all 0.2s",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 120,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = menu.color;
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.boxShadow = `0 8px 20px ${menu.color}33`;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "#e2e8f0";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
      }}
    >
      <div style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        background: `${menu.color}15`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
      }}>{menu.icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{menu.label}</div>
      <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>{menu.desc}</div>
    </div>
  );
}

// =====================================
const sidebarLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#94a3b8",
  letterSpacing: 1,
  marginBottom: 8,
  paddingLeft: 8,
};

const menuGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

const adminBtnStyle = (bg: string, color: string): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
  borderRadius: 8,
  background: bg,
  color: color,
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  fontFamily: "inherit",
});

const loadingStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};
