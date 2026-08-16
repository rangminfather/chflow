"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DeptIcon from "@/components/DeptIcon";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import {
  type LucideIcon,
  Megaphone, CalendarDays, Newspaper, GraduationCap, ClipboardCheck, ClipboardList,
  Medal, Users, Inbox, BookText, CalendarPlus, BookOpen, FileText, BarChart3,
  TrendingUp, ScrollText, Sparkles, UserCheck, UserCog, ListChecks,
  Settings, Award, Lock, CircleHelp, Construction, Cog, X, Pencil, MessageSquareText,
  ChevronUp, ChevronDown, User, GripVertical, PartyPopper,
} from "lucide-react";
import ModalBackdrop from "@/components/ModalBackdrop";
import { photoThumb } from "@/lib/photo";

interface DeptInfo {
  id: string;
  category: string;
  name: string;
  description: string | null;
  icon: string | null;
  member_count: number;
  is_member: boolean;
  my_status: string | null;
  is_admin: boolean;
}

interface DeptMemberRow {
  user_id: string;
  name: string | null;
  role: string | null;
  grade: number | null;
  photoUrl: string | null;
}

// ─────────────────────────────────────────────────────────────────
// 메뉴 정의 — 사용자 xlsx (초등1 메뉴구성) 기반 4 대분류 + 소분류
// 등급:
//   0 = 전도사, 교육사 / 1 = 부장 / 2 = 부부장·총무·서기 / 3 = 교사 / 4 = 학부모
// ─────────────────────────────────────────────────────────────────

interface MenuItem {
  id: string;            // route slug ("journal" 등). null 이면 placeholder (라우트 없음)
  label: string;
  icon: LucideIcon;
  desc: string;
  color: string;
  implemented: boolean;  // 구현 안 된 페이지는 클릭 시 "준비 중" 토스트
  onlyForDept?: string | null; // null = 모든 부서 (카테고리 onlyForDept 무시)
  onlyForCategory?: string | null; // null = 카테고리 제한 없음(카테고리 onlyForCategory 무시)
  maxGrade?: number;
  /** 행정관리 전용 — 섹션 id (ADMIN_SECTIONS). 부서별 설정으로 변경 가능 */
  section?: string;
  /** 메뉴 id와 실제 주소가 다를 때 사용하는 경로 */
  href?: string;
}

// 행정관리 섹션 정의 (순서 = 표시 순서). 항목→섹션 배정은 임원진이 메뉴 편집에서 변경 가능
const ADMIN_SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "docs", label: "주보·교육 자료", icon: Newspaper },
  { id: "attendance", label: "출결", icon: ListChecks },
  { id: "talent", label: "달란트", icon: Medal },
  { id: "ops", label: "명부·부서 운영", icon: Users },
];

interface MenuCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  maxGrade: number;       // 이 등급 이하만 표시 (예: 행정관리 maxGrade=2 → 0/1/2 만 보임)
  desc: string;
  items: MenuItem[];
  /** 일부 부서만 표시 (없으면 모두) */
  onlyForDept?: string;
  /** 특정 카테고리(예: 교육사역국) 부서에만 표시 */
  onlyForCategory?: string;
  /** 실제 학생 담임 배정이 있는 사용자에게만 표시 */
  requiresHomeroom?: boolean;
}

const MENU_CATEGORIES: MenuCategory[] = [
  {
    id: "notices",
    label: "공통메뉴",
    icon: Megaphone,
    maxGrade: 4,
    desc: "부서 공통 자료 / 공지 / 주보",
    items: [
      { id: "notices/board", label: "공지 게시판", icon: Megaphone, desc: "부서 공지·알림", color: "#4A7B96", implemented: true, maxGrade: 4 },
      { id: "bulletin", label: "{dept} 주보보기", icon: Newspaper, desc: "주보 열람", color: "#3E7D74", implemented: true, onlyForCategory: "교육사역국", maxGrade: 4 },
      { id: "verse-memory", label: "요절암송", icon: BookOpen, desc: "월별 요절암송 자료", color: "#8A6D3B", implemented: true, onlyForCategory: "교육사역국", maxGrade: 4 },
      { id: "monthly-plan", label: "월간 교육계획서", icon: CalendarDays, desc: "월간 교육계획 파일 조회", color: "var(--accent)", implemented: true, maxGrade: 4 },
      { id: "review-problems", label: "복습문제 보기", icon: BookOpen, desc: "등록된 복습문제 PPT 보기", color: "#6B4F8C", implemented: true, onlyForCategory: "교육사역국", maxGrade: 3 },
    ],
  },
  {
    id: "students",
    label: "담임메뉴",
    icon: GraduationCap,
    maxGrade: 3,
    desc: "출결 / 달란트 / 우리반 정보",
    onlyForCategory: "교육사역국",
    requiresHomeroom: true,
    items: [
      { id: "my-class-attendance", label: "내 반 출결", icon: ClipboardCheck, desc: "내 담당 반 학생 출석 체크", color: "var(--success)", implemented: true },
      { id: "talent", label: "달란트통장", icon: Medal, desc: "달란트 적립 · 누적 합계", color: "var(--accent-muted)", implemented: true },
      { id: "my-class", label: "우리반 아이 정보", icon: Users, desc: "담당 반 학생 정보", color: "var(--warning)", implemented: true },
    ],
  },
  {
    id: "admin",
    label: "행정관리",
    icon: ClipboardList,
    maxGrade: 2,
    desc: "주보 / 일지 / 통계 / 등록 / 가입승인",
    onlyForCategory: "교육사역국",
    items: [
      // ── 주보·교육 자료 ──
      { id: "weekly-bulletin", label: "주보 만들기", icon: Newspaper, desc: "주보 자동 생성·UMS 등록", color: "#3E7D74", implemented: true, section: "docs" },
      { id: "journal", label: "교육일지작성", icon: BookText, desc: "일지 · 통계 · 헌금", color: "var(--accent)", implemented: true, section: "docs" },
      { id: "monthly-plan-upload", label: "월간교육등록", icon: CalendarPlus, desc: "월간 교육계획서 등록", color: "var(--accent)", implemented: true, section: "docs" },
      { id: "review-upload", label: "복습문제 관리", icon: BookOpen, desc: "공과 복습문제 PPTX 업로드·삭제", color: "#6B4F8C", implemented: true, section: "docs" },
      // ── 출결 ──
      { id: "attendance", label: "출결 통합 조회", icon: ListChecks, desc: "전 반 출결 체크 · 학생별 이력", color: "var(--success)", implemented: true, section: "attendance" },
      { id: "attendance-stats", label: "출결통계", icon: BarChart3, desc: "선생님·학생 출석 통계", color: "#7A8C3D", implemented: true, section: "attendance" },
      { id: "teacher-attendance", label: "선생님 등록 / 출석", icon: UserCheck, desc: "교사 출석부 · 월별 관리", color: "#4A7B96", implemented: true, section: "attendance" },
      // ── 달란트 ──
      { id: "talent-check", href: "talent-check", label: "달란트 통합체크", icon: Medal, desc: "전 반 달란트 체크 · 월별 현황", color: "var(--accent-muted)", implemented: true, section: "talent" },
      { id: "talent-rules", label: "달란트 항목설정", icon: ScrollText, desc: "달란트통장 체크 항목·점수 설정", color: "var(--warning)", implemented: true, section: "talent" },
      { id: "talent-stats", label: "달란트통계", icon: TrendingUp, desc: "달란트 누적·랭킹", color: "#7E5F9E", implemented: true, section: "talent" },
      { id: "talent-feast", label: "달란트잔치", icon: PartyPopper, desc: "통장 출력 · 잔치 후 반기 리셋", color: "#C08A2D", implemented: true, section: "talent" },
      { id: "quiz-talent", label: "공과퀴즈 달란트", icon: ClipboardCheck, desc: "월별 공과시험 달란트 입력 (서기)", color: "#7E5F9E", implemented: true, onlyForCategory: "교육사역국", maxGrade: 2, section: "talent" },
      // ── 명부·부서 운영 ──
      { id: "students-info", label: "학생정보관리", icon: FileText, desc: "학생 명부 · 인적사항", color: "#B97B3D", implemented: true, section: "ops" },
      { id: "new-friend", label: "새친구등록", icon: Sparkles, desc: "새친구 등록카드 · 생활기록부", color: "#C26D8C", implemented: true, section: "ops" },
      { id: "teacher-assign", label: "반 관리", icon: UserCog, desc: "반 추가·삭제 · 담임 지정 (임원진)", color: "var(--accent-muted)", implemented: true, section: "ops" },
      { id: "dept-approval", label: "사역 가입 승인", icon: Inbox, desc: "본 부서 가입 신청 승인 · 등급 부여", color: "var(--success)", implemented: true, onlyForDept: null, onlyForCategory: null, maxGrade: 2, section: "ops" },
    ],
  },
  {
    id: "department",
    label: "부서관리",
    icon: Settings,
    maxGrade: 1,
    desc: "부서원 등급 · 설정",
    items: [
      { id: "worship-guide", label: "예배안내", icon: MessageSquareText, desc: "주일 예배 안내 메시지 생성·공유 (카톡용)", color: "#3E7D74", implemented: true, onlyForDept: "초등1부" },
      { id: "members-grade", label: "부서원관리", icon: Award, desc: "부서원 등급(0~4) 변경 · 임명 — 전도사·부장만 가능", color: "var(--accent)", implemented: true },
      { id: "promote", label: "진급 마법사", icon: GraduationCap, desc: "매년 학년 진급 · 반편성 · 담임배정", color: "var(--danger)", implemented: true },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────
// 메뉴 설정
//  - 공통메뉴: 임원진(grade<=2)이 이름/주석 수정, monthly-plan·review-problems 는 접근등급(3/4)도 변경
//  - 담임메뉴·행정관리: 임원진이 이름/주석만 수정
//  - 부서관리(교육부서): 접근범위 0(전도사만)/1(부장까지)/2(임원진까지) 안의 등급이 이름/주석 수정,
//    접근범위(권한) 변경은 전도사·교육사(0)만
// ─────────────────────────────────────────────────────────────────
type MenuSetting = { label: string | null; description: string | null; max_grade: number | null; section?: string | null };
type MenuSettings = Record<string, MenuSetting>;
type SectionLabels = Record<string, string>;
// 접근등급(학부모까지/선생님만) 변경 가능한 공통메뉴 항목
const ACCESS_CONFIGURABLE = new Set(["monthly-plan", "review-problems"]);
// 설정 대상 공통메뉴 (순서 = 표시 순서)
const COMMON_MENU_KEYS = ["notices/board", "bulletin", "verse-memory", "monthly-plan", "review-problems"];
// 카테고리별 설정 키 prefix — 공통메뉴는 기존 키 유지, 나머지는 "prefix/menu-id"
// (카테고리 간 같은 menu id 가 생겨도 설정 키가 충돌하지 않게)
const CATEGORY_KEY_PREFIX: Record<string, string> = { students: "students", admin: "admin", department: "dept" };
const settingKeyOf = (catId: string, itemId: string) =>
  catId === "notices" ? itemId : `${CATEGORY_KEY_PREFIX[catId] || catId}/${itemId}`;

// ─────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────
export default function DepartmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [dept, setDept] = useState<DeptInfo | null>(null);
  const [myGrade, setMyGrade] = useState<number | null>(null);
  const [hasHomeroom, setHasHomeroom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [deptApprovalPendingCount, setDeptApprovalPendingCount] = useState(0);
  const [menuSettings, setMenuSettings] = useState<MenuSettings>({});
  const [editCatId, setEditCatId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ catId: string; itemId: string } | null>(null);
  const [sectionOrder, setSectionOrder] = useState<string[]>(ADMIN_SECTIONS.map((s) => s.id));
  const [sectionLabels, setSectionLabels] = useState<SectionLabels>({});
  const [itemOrder, setItemOrder] = useState<Record<string, string[]>>({});
  // 드래그 정렬 (편집모드) — Pointer Events 라 마우스·터치 모두 동작
  const [draggingKey, setDraggingKey] = useState<string | null>(null); // `${catId}:${itemId}`
  const [dragPreview, setDragPreview] = useState<{
    left: number; top: number; width: number; height: number;
    offsetX: number; offsetY: number; item: MenuItem;
  } | null>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const adminSectionRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<{
    catId: string; itemId: string; allIds: string[];
    startOrder: string[]; currentOrder: string[];
    startSection: string; currentSection: string;
    sectionByItem: Record<string, string>;
    startSetting?: MenuSetting;
    previewOffsetX: number; previewOffsetY: number;
  } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [deptMembers, setDeptMembers] = useState<DeptMemberRow[] | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      setLoading(true);
      const [deptResp, gradeResp, teacherResp, settingsResp, sectionOrderResp, sectionLabelsResp, itemOrderResp] = await Promise.all([
        supabase.rpc("get_department_info", { p_dept_id: deptId }),
        supabase.rpc("get_user_grade", { p_dept_id: deptId }),
        supabase
          .from("edu_teachers")
          .select("id")
          .eq("department_id", deptId)
          .eq("user_id", session.user.id)
          .eq("is_active", true)
          .maybeSingle(),
        supabase.rpc("get_dept_menu_settings", { p_department_id: deptId }),
        supabase.rpc("get_dept_admin_section_order", { p_department_id: deptId }),
        supabase.rpc("get_dept_admin_section_labels", { p_department_id: deptId }),
        supabase.rpc("get_dept_menu_item_order", { p_department_id: deptId }),
      ]);
      if (!itemOrderResp.error && itemOrderResp.data && typeof itemOrderResp.data === "object") {
        setItemOrder(itemOrderResp.data as Record<string, string[]>);
      }
      if (!settingsResp.error && settingsResp.data) {
        setMenuSettings(settingsResp.data as MenuSettings);
      }
      if (!sectionOrderResp.error && Array.isArray(sectionOrderResp.data) && sectionOrderResp.data.length === ADMIN_SECTIONS.length) {
        setSectionOrder(sectionOrderResp.data as string[]);
      }
      if (!sectionLabelsResp.error && sectionLabelsResp.data && typeof sectionLabelsResp.data === "object") {
        setSectionLabels(sectionLabelsResp.data as SectionLabels);
      }
      if (!deptResp.error && deptResp.data && deptResp.data.length > 0) {
        setDept(deptResp.data[0]);
      }
      if (!gradeResp.error && gradeResp.data !== null && gradeResp.data !== undefined) {
        const grade = typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data);
        setMyGrade(grade);
        if (grade <= 2) {
          const { data } = await supabase.rpc("list_dept_pending_for_leader", { p_dept_id: deptId });
          setDeptApprovalPendingCount(Array.isArray(data) ? data.length : 0);
        } else {
          setDeptApprovalPendingCount(0);
        }
      }
      if (teacherResp.data?.id) {
        const { data: classRows } = await supabase.rpc("edu_list_my_homeroom_classes", { p_dept_id: deptId });
        setHasHomeroom(Array.isArray(classRows) && classRows.length > 0);
      } else {
        setHasHomeroom(false);
      }
      setLoading(false);
    })();
  }, [deptId, router]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  // 드래그 시작 (편집모드 그립 핸들) — 행정관리는 섹션 사이 이동도 가능
  const startItemDrag = (
    e: React.PointerEvent,
    catId: string,
    itemId: string,
    allIds: string[],
    fullOrder: string[],
    startSection: string,
    sectionByItem: Record<string, string>,
    item: MenuItem,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const source = itemRefs.current.get(`${catId}:${itemId}`);
    const sourceRect = source?.getBoundingClientRect();
    const previewOffsetX = sourceRect ? e.clientX - sourceRect.left : 24;
    const previewOffsetY = sourceRect ? e.clientY - sourceRect.top : 24;
    dragRef.current = {
      catId, itemId, allIds, startOrder: fullOrder, currentOrder: fullOrder,
      startSection, currentSection: startSection, sectionByItem: { ...sectionByItem },
      startSetting: menuSettings[settingKeyOf(catId, itemId)],
      previewOffsetX, previewOffsetY,
    };
    setDraggingKey(`${catId}:${itemId}`);
    setDragPreview({
      left: sourceRect?.left ?? e.clientX - previewOffsetX,
      top: sourceRect?.top ?? e.clientY - previewOffsetY,
      width: sourceRect?.width ?? 220,
      height: sourceRect?.height ?? 68,
      offsetX: previewOffsetX,
      offsetY: previewOffsetY,
      item,
    });

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const st = dragRef.current;
      if (!st) return;
      setDragPreview((preview) => preview ? {
        ...preview,
        left: ev.clientX - st.previewOffsetX,
        top: ev.clientY - st.previewOffsetY,
      } : null);

      const edge = 72;
      if (ev.clientY < edge) {
        window.scrollBy(0, -Math.max(4, Math.round((edge - ev.clientY) / 4)));
      } else if (ev.clientY > window.innerHeight - edge) {
        window.scrollBy(0, Math.max(4, Math.round((ev.clientY - (window.innerHeight - edge)) / 4)));
      }

      const moveTo = (targetSection: string, targetId?: string) => {
        const next = [...st.currentOrder];
        const from = next.indexOf(st.itemId);
        if (from < 0) return;
        next.splice(from, 1);
        if (targetId) {
          const to = next.indexOf(targetId);
          next.splice(to < 0 ? next.length : to, 0, st.itemId);
        } else {
          let to = -1;
          next.forEach((id, index) => {
            if (st.sectionByItem[id] === targetSection) to = index;
          });
          next.splice(to + 1, 0, st.itemId);
        }
        const sectionChanged = targetSection !== st.currentSection;
        const orderChanged = next.join("|") !== st.currentOrder.join("|");
        if (!sectionChanged && !orderChanged) return;
        st.currentOrder = next;
        st.currentSection = targetSection;
        st.sectionByItem[st.itemId] = targetSection;
        setItemOrder((prev) => ({ ...prev, [st.catId]: next }));
        if (sectionChanged && st.catId === "admin") {
          const menuKey = settingKeyOf(st.catId, st.itemId);
          setMenuSettings((prev) => ({
            ...prev,
            [menuKey]: { ...(prev[menuKey] || { label: null, description: null, max_grade: null }), section: targetSection },
          }));
        }
      };

      for (const oid of st.allIds) {
        if (oid === st.itemId) continue;
        const el = itemRefs.current.get(`${st.catId}:${oid}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          moveTo(st.sectionByItem[oid] || st.currentSection, oid);
          return;
        }
      }

      if (st.catId === "admin") {
        const source = itemRefs.current.get(`${st.catId}:${st.itemId}`);
        if (source) {
          const r = source.getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) return;
        }
        for (const [sectionId, el] of adminSectionRefs.current) {
          const r = el.getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
            moveTo(sectionId);
            return;
          }
        }
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
      const orderChanged = st.currentOrder.join("|") !== st.startOrder.join("|");
      const sectionChanged = st.currentSection !== st.startSection;
      if (!orderChanged && !sectionChanged) return;

      let sectionError: { message: string } | null = null;
      if (sectionChanged) {
        const s = st.startSetting;
        const result = await supabase.rpc("set_dept_menu_setting", {
          p_department_id: deptId,
          p_menu_key: settingKeyOf(st.catId, st.itemId),
          p_label: s?.label ?? null,
          p_description: s?.description ?? null,
          p_max_grade: null,
          p_section: st.currentSection,
        });
        sectionError = result.error;
      }
      const orderResult = !sectionError && orderChanged
        ? await supabase.rpc("set_dept_menu_item_order", {
            p_department_id: deptId, p_category: st.catId, p_order: st.currentOrder,
          })
        : { error: null };
      const error = sectionError || orderResult.error;
      if (error) {
        if (sectionChanged && !sectionError) {
          const s = st.startSetting;
          await supabase.rpc("set_dept_menu_setting", {
            p_department_id: deptId,
            p_menu_key: settingKeyOf(st.catId, st.itemId),
            p_label: s?.label ?? null,
            p_description: s?.description ?? null,
            p_max_grade: null,
            p_section: s?.section ?? st.startSection,
          });
        }
        setItemOrder((prev) => ({ ...prev, [st.catId]: st.startOrder }));
        const menuKey = settingKeyOf(st.catId, st.itemId);
        setMenuSettings((prev) => ({
          ...prev,
          [menuKey]: {
            ...(st.startSetting || { label: null, description: null, max_grade: null }),
            section: st.startSetting?.section ?? st.startSection,
          },
        }));
        showToast(`순서 저장 실패: ${error.message}`);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const moveSection = async (id: string, dir: -1 | 1) => {
    const idx = sectionOrder.indexOf(id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sectionOrder.length) return;
    const prev = sectionOrder;
    const next = [...sectionOrder];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setSectionOrder(next);
    const { error } = await supabase.rpc("set_dept_admin_section_order", { p_department_id: deptId, p_order: next });
    if (error) {
      setSectionOrder(prev);
      showToast(`순서 저장 실패: ${error.message}`);
    }
  };

  const sectionLabelOf = (id: string, fallback: string) => {
    const custom = sectionLabels[id];
    return custom && custom.trim() ? custom : fallback;
  };

  const saveSectionLabel = async (id: string, fallback: string, nextLabel: string) => {
    const trimmed = nextLabel.trim();
    if (!trimmed || trimmed === sectionLabelOf(id, fallback)) return;
    const prev = sectionLabels;
    setSectionLabels((labels) => ({ ...labels, [id]: trimmed }));
    const { data, error } = await supabase.rpc("set_dept_admin_section_label", {
      p_department_id: deptId,
      p_section_id: id,
      p_label: trimmed,
    });
    if (error) {
      setSectionLabels(prev);
      showToast(`섹션명 저장 실패: ${error.message}`);
      return;
    }
    if (data && typeof data === "object") setSectionLabels(data as SectionLabels);
    showToast("섹션명을 수정했습니다");
  };

  // 참여 멤버 팝업 — RPC(list_dept_member_faces): members(app_user_id) 우선, profiles 폴백
  // (department_members RLS 가 자기 행만 허용이라 직접 조회 불가)
  const openMembers = async () => {
    setMembersOpen(true);
    if (deptMembers || membersLoading) return;
    setMembersLoading(true);
    const { data, error } = await supabase.rpc("list_dept_member_faces", { p_dept_id: deptId });
    if (error) {
      showToast(`멤버 조회 실패: ${error.message}`);
      setMembersOpen(false);
    } else {
      type Row = { user_id: string; name: string | null; photo_url: string | null; member_role: string | null; grade: number | null };
      setDeptMembers(((data as Row[]) || []).map((r) => ({
        user_id: r.user_id,
        name: r.name,
        role: r.member_role,
        grade: r.grade,
        photoUrl: r.photo_url,
      })));
    }
    setMembersLoading(false);
  };

  const handleItemClick = (item: MenuItem) => {
    if (!item.implemented) {
      showToast(`준비 중인 기능입니다: ${item.label}`);
      return;
    }
    router.push(`/departments/d/${deptId}/${item.href || item.id}`);
  };

  if (!authChecked || loading) return <LoadingView full />;

  if (!dept) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: "center", padding: 60 }}>
          <EmptyState icon={<CircleHelp size={24} strokeWidth={1.6} />} message="부서를 찾을 수 없습니다" padding={0} />
          <button onClick={() => router.push("/home")} style={{ ...backBtnStyle, marginTop: 16 }}>홈으로</button>
        </div>
      </div>
    );
  }

  if (!dept.is_member) {
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}>
          <div style={{
            background: "var(--card)", borderRadius: 20, padding: 32, textAlign: "center",
            boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
          }}>
            <div style={{ marginBottom: 16 }}><Lock size={44} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} /></div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>
              아직 가입되지 않은 부서입니다
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 24 }}>
              {dept.my_status === "pending"
                ? "관리자 승인을 기다리고 있습니다"
                : "사역·부서 가입 페이지에서 가입을 신청해주세요"}
            </div>
            <button
              onClick={() => router.push(`/departments/${encodeURIComponent(dept.category)}`)}
              style={{
                padding: "12px 24px", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
                color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >가입 신청 하러 가기</button>
          </div>
        </div>
      </div>
    );
  }

  const isEduDept = dept.category === "교육사역국";
  const grade = myGrade ?? 99;
  const canEditMenu = grade <= 2; // 임원진(총무·서기) 이상
  // 부서관리: 접근 범위 안이면 이름/설명 수정 가능 (표시되는 항목 = 이미 범위 안).
  // 접근 범위(권한) 변경 자체는 전도사·교육사만 — 수정 모달과 RPC 에서 제한.
  const canEditCat = (catId: string) => (catId === "department" ? isEduDept && canEditMenu : canEditMenu);

  // 메뉴 설정(이름/주석/접근등급) 반영
  const resolveItem = (cat: MenuCategory, item: MenuItem): MenuItem => {
    const s = menuSettings[settingKeyOf(cat.id, item.id)];
    let maxGrade = item.maxGrade ?? cat.maxGrade;
    if (cat.id === "notices") {
      if (s && ACCESS_CONFIGURABLE.has(item.id) && (s.max_grade === 3 || s.max_grade === 4)) maxGrade = s.max_grade;
    } else if (cat.id === "department" && isEduDept) {
      // 교육부서 부서관리: 기본 부장까지(1), 설정으로 0(전도사·교육사만)~2(임원진까지) 조정
      maxGrade = s?.max_grade === 0 || s?.max_grade === 1 || s?.max_grade === 2 ? s.max_grade : 1;
    }
    let label = s?.label && s.label.trim() ? s.label : item.label;
    if (label.includes("{dept}")) label = label.replace("{dept}", dept!.name);
    const desc = s?.description && s.description.trim() ? s.description : item.desc;
    // 행정관리 섹션 배정 (설정값이 정의된 섹션 id 일 때만 반영)
    let section = item.section;
    if (cat.id === "admin" && s?.section && ADMIN_SECTIONS.some((x) => x.id === s.section)) section = s.section;
    return { ...item, label, desc, maxGrade, section };
  };

  // 부서명/카테고리 필터 (item 값 우선, null = 제한 없음, undefined = cat 상속)
  const itemDeptOk = (cat: MenuCategory, item: MenuItem): boolean => {
    const deptName = item.onlyForDept !== undefined ? item.onlyForDept : cat.onlyForDept;
    if (deptName && deptName !== dept!.name) return false;
    const catFilter = item.onlyForCategory !== undefined ? item.onlyForCategory : cat.onlyForCategory;
    if (catFilter && catFilter !== dept!.category) return false;
    return true;
  };

  // 카테고리별 표시 여부 결정
  const visibleCategories = MENU_CATEGORIES.filter((cat) => {
    if (cat.requiresHomeroom && !hasHomeroom) return false;
    // 담임메뉴는 실제 담임 배정(requiresHomeroom) 기준 — 등급 0(전도사·관리자)이어도
    // 반 학생이 배정돼 있으면 표시 (관리자 grade 0 우선 정책과 충돌 방지)
    return cat.items.some((item) => {
      const resolved = resolveItem(cat, item);
      if (!itemDeptOk(cat, resolved)) return false;
      return grade <= (resolved.maxGrade ?? cat.maxGrade);
    });
  });

  return (
    <div style={pageStyle}>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
        {/* Header */}
        <div style={{
          background: "var(--card)", borderRadius: 12, padding: "16px 20px", marginBottom: 20,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HeaderLogo />
            <div>
              <div style={{ fontSize: 11, color: "var(--ink-faint)", fontWeight: 600 }}>{dept.category}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 7 }}>
                <DeptIcon name={dept.name} category={dept.category} size={18} /> {dept.name}
                {grade <= 4 && (
                  <span style={{
                    marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 700,
                    background: GRADE_BADGE[grade]?.bg || "var(--bg-soft)",
                    color: GRADE_BADGE[grade]?.color || "var(--ink-soft)",
                  }}>
                    {GRADE_BADGE[grade]?.label || `등급 ${grade}`}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={() => router.push("/home")} style={backBtnStyle}>← 홈</button>
        </div>

        {/* Welcome Card */}
        <div style={{
          background: "linear-gradient(135deg, var(--accent), var(--accent-muted))", borderRadius: 24, padding: "32px 28px",
          textAlign: "center", color: "#fff", marginBottom: 24,
          boxShadow: "0 20px 60px rgba(62, 90, 74, 0.25)",
        }}>
          <div style={{ marginBottom: 10, display: "flex", justifyContent: "center" }}>
            <DeptIcon name={dept.name} category={dept.category} size={44} color="#fff" />
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, letterSpacing: -0.5 }}>{dept.name}</div>
          {dept.description && (
            <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.6, marginBottom: 14 }}>
              {dept.description}
            </div>
          )}
          <button
            onClick={openMembers}
            title="참여 멤버 보기"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", background: "rgba(255,255,255,0.2)",
              borderRadius: 20, fontSize: 11, fontWeight: 600, color: "#fff",
              border: "none", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Users size={13} strokeWidth={1.8} /> {dept.member_count}명
          </button>
        </div>

        {/* 비교육사역국: 콘텐츠 안내 (관리 메뉴는 아래에 표시) */}
        {!isEduDept && (
          <div style={{
            background: "var(--card)", borderRadius: 16, padding: 28, textAlign: "center",
            color: "var(--ink-faint)", fontSize: 13, lineHeight: 1.7, marginBottom: 16,
          }}>
            <div style={{ marginBottom: 12 }}><Construction size={36} strokeWidth={1.8} style={{ color: "var(--ink-faint)" }} /></div>
            <div style={{ fontWeight: 700, color: "var(--ink-soft)", marginBottom: 6 }}>
              부서 게시판 / 일정 / 모임 등은 곧 추가됩니다
            </div>
            <div>앞으로 이 페이지에서 부서 공지, 일정, 모임 신청 등을 확인하실 수 있습니다.</div>
          </div>
        )}

        {/* 메뉴 그리드 — 행정관리(grade 0~2) · 부서관리(grade 0~1) 는 모든 부서 표시 */}
        {visibleCategories.map((cat) => (
          <div key={cat.id} style={{ marginBottom: 24 }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                <cat.icon size={17} strokeWidth={1.8} style={{ color: "var(--accent)" }} />
                {cat.label}
              </div>
              {canEditCat(cat.id) && (
                <button
                  onClick={() => setEditCatId((v) => (v === cat.id ? null : cat.id))}
                  title={editCatId === cat.id ? "편집 종료" : `${cat.label} 편집`}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, cursor: "pointer",
                    border: `1px solid ${editCatId === cat.id ? "var(--accent)" : "var(--hairline)"}`,
                    background: editCatId === cat.id ? "var(--accent-soft)" : "var(--card)",
                    color: editCatId === cat.id ? "var(--accent-strong)" : "var(--ink-soft)",
                  }}
                >
                  <Cog
                    size={17}
                    strokeWidth={1.9}
                    className={editCatId === cat.id ? "animate-spin" : ""}
                    style={editCatId === cat.id ? { animationDuration: "3s" } : undefined}
                  />
                </button>
              )}
            </div>
            {(() => {
              const filtered = cat.items
                .map((item) => resolveItem(cat, item))
                .filter((item) => itemDeptOk(cat, item) && grade <= (item.maxGrade ?? cat.maxGrade));
              // 저장된 순서 적용 (미포함 항목은 기본 순서대로 뒤에)
              const orderArr = itemOrder[cat.id] || [];
              const visibleItems = filtered
                .map((it, i) => ({ it, p: orderArr.indexOf(it.id) === -1 ? orderArr.length + i : orderArr.indexOf(it.id) }))
                .sort((a, b) => a.p - b.p)
                .map((x) => x.it);
              const orderedIds = visibleItems.map((it) => it.id);
              const sectionByItem = Object.fromEntries(visibleItems.map((it) => [it.id, it.section ?? "ops"]));
              const editingCat = editCatId === cat.id && canEditCat(cat.id);
              const renderGrid = (items: MenuItem[]) => (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 10,
                }}>
                  {items.map((item) => (
                    <MenuCard
                      key={item.id}
                      item={item}
                      badgeCount={item.id === "dept-approval" ? deptApprovalPendingCount : 0}
                      onClick={() => handleItemClick(item)}
                      onEdit={editingCat
                        && (cat.id !== "notices" || COMMON_MENU_KEYS.includes(item.id))
                        ? () => setEditing({ catId: cat.id, itemId: item.id }) : undefined}
                      cardRef={(el) => {
                        const key = `${cat.id}:${item.id}`;
                        if (el) itemRefs.current.set(key, el);
                        else itemRefs.current.delete(key);
                      }}
                      dragging={draggingKey === `${cat.id}:${item.id}`}
                      onDragHandle={editingCat
                        ? (e) => startItemDrag(e, cat.id, item.id, orderedIds, orderedIds, item.section ?? "ops", sectionByItem, item)
                        : undefined}
                    />
                  ))}
                </div>
              );
              // 행정관리: 섹션별 소제목으로 묶어 표시 (섹션이 1개뿐이면 평면 그리드)
              if (cat.id === "admin") {
                const orderedSecDefs = sectionOrder
                  .map((id) => ADMIN_SECTIONS.find((s) => s.id === id))
                  .filter((s): s is (typeof ADMIN_SECTIONS)[number] => !!s);
                ADMIN_SECTIONS.forEach((s) => { if (!orderedSecDefs.includes(s)) orderedSecDefs.push(s); });
                const groups = orderedSecDefs
                  .map((sec) => ({ sec, items: visibleItems.filter((it) => (it.section ?? "ops") === sec.id) }))
                  .filter((g) => g.items.length > 0 || editingCat);
                if (groups.length > 1) {
                  const sectionsEditable = editCatId === "admin" && canEditCat("admin");
                  return groups.map(({ sec, items }, gi) => (
                    <div
                      key={sec.id}
                      ref={(el) => {
                        if (el) adminSectionRefs.current.set(sec.id, el);
                        else adminSectionRefs.current.delete(sec.id);
                      }}
                      style={{ marginTop: gi === 0 ? 0 : 16 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                        <sec.icon size={13} strokeWidth={1.9} style={{ color: "var(--ink-faint)" }} />
                        {sectionsEditable ? (
                          <input
                            defaultValue={sectionLabelOf(sec.id, sec.label)}
                            aria-label={`${sec.label} 섹션명`}
                            maxLength={24}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => saveSectionLabel(sec.id, sec.label, e.currentTarget.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") {
                                e.currentTarget.value = sectionLabelOf(sec.id, sec.label);
                                e.currentTarget.blur();
                              }
                            }}
                            style={sectionLabelInputStyle}
                          />
                        ) : (
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-faint)", letterSpacing: 0.3, whiteSpace: "nowrap" }}>
                            {sectionLabelOf(sec.id, sec.label)}
                          </span>
                        )}
                        <div style={{ flex: 1, height: 1, background: "var(--hairline)" }} />
                        {sectionsEditable && (
                          <div style={{ display: "flex", gap: 2 }}>
                            <button
                              type="button"
                              onClick={() => moveSection(sec.id, -1)}
                              disabled={gi === 0}
                              title="위로 이동"
                              style={sectionMoveBtnStyle(gi === 0)}
                            ><ChevronUp size={14} strokeWidth={2.2} /></button>
                            <button
                              type="button"
                              onClick={() => moveSection(sec.id, 1)}
                              disabled={gi === groups.length - 1}
                              title="아래로 이동"
                              style={sectionMoveBtnStyle(gi === groups.length - 1)}
                            ><ChevronDown size={14} strokeWidth={2.2} /></button>
                          </div>
                        )}
                      </div>
                      {items.length > 0 ? renderGrid(items) : (
                        <div style={{ border: "1.5px dashed var(--hairline-strong)", borderRadius: 10, padding: 14, textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--ink-faint)" }}>
                          소메뉴를 여기로 드래그하세요
                        </div>
                      )}
                    </div>
                  ));
                }
              }
              return renderGrid(visibleItems);
            })()}
          </div>
        ))}

        {/* 접근 가능한 메뉴가 전혀 없는 경우 안내 */}
        {visibleCategories.length === 0 && (
          <div style={{
            background: "var(--warning-soft)", border: "1.5px solid color-mix(in srgb, var(--warning) 35%, transparent)", borderRadius: 12, padding: 20,
            textAlign: "center", color: "var(--warning)",
          }}>
            <div style={{ marginBottom: 8 }}><Lock size={28} strokeWidth={1.8} /></div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>접근 가능한 메뉴가 없습니다</div>
            <div style={{ fontSize: 12 }}>
              현재 등급: {GRADE_LABEL[grade] || `${grade} (불명)`}.
              부서 관리자에게 등급 조정 문의하세요.
            </div>
          </div>
        )}
      </div>

      {dragPreview && (() => {
        const PreviewIcon = dragPreview.item.icon;
        return (
          <div style={{
            position: "fixed", left: dragPreview.left, top: dragPreview.top,
            width: dragPreview.width, minHeight: dragPreview.height, zIndex: 2000,
            boxSizing: "border-box", pointerEvents: "none", userSelect: "none",
            background: "var(--card)", border: `2px solid ${dragPreview.item.color}`,
            borderRadius: 12, padding: "14px", display: "flex", alignItems: "center", gap: 12,
            boxShadow: "0 16px 36px rgba(43, 39, 34, 0.24)", opacity: 0.96,
            transform: "scale(1.025) rotate(0.6deg)", transformOrigin: `${dragPreview.offsetX}px ${dragPreview.offsetY}px`,
          }}>
            <GripVertical size={15} strokeWidth={2} style={{ color: "var(--ink-faint)", flexShrink: 0 }} />
            <div style={{
              width: 36, height: 36, borderRadius: 9, flexShrink: 0,
              background: `color-mix(in srgb, ${dragPreview.item.color} 12%, transparent)`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <PreviewIcon size={18} strokeWidth={1.8} style={{ color: dragPreview.item.color }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {dragPreview.item.label}
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2, lineHeight: 1.3 }}>
                {dragPreview.item.desc}
              </div>
            </div>
          </div>
        );
      })()}

      {toast && <div style={toastStyle}>{toast}</div>}

      {membersOpen && (
        <ModalBackdrop onClose={() => setMembersOpen(false)}>
          <div style={{
            width: "100%", maxWidth: 420, background: "var(--card)", borderRadius: 18,
            overflow: "hidden", maxHeight: "76vh", display: "flex", flexDirection: "column",
          }}>
            <div style={{ borderBottom: "1px solid var(--hairline)", padding: "15px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: 7 }}>
                <Users size={16} strokeWidth={2} /> 참여 멤버
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-faint)" }}>
                  {deptMembers ? `${deptMembers.length}명` : `${dept.member_count}명`}
                </span>
              </div>
              <button onClick={() => setMembersOpen(false)} style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "var(--bg-soft)", color: "var(--ink-mid)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <X size={16} strokeWidth={2} />
              </button>
            </div>
            <div style={{ padding: 18, overflowY: "auto" }}>
              {membersLoading || !deptMembers ? (
                <LoadingView padding={30} />
              ) : deptMembers.length === 0 ? (
                <EmptyState icon={<Users size={22} strokeWidth={1.6} />} message="참여 중인 멤버가 없습니다" padding={20} />
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(74px, 1fr))", gap: "14px 8px" }}>
                  {deptMembers.map((m) => (
                    <div key={m.user_id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
                      {m.photoUrl ? (
                        <img
                          src={photoThumb(m.photoUrl, 128) ?? undefined}
                          alt={m.name || ""}
                          loading="lazy"
                          decoding="async"
                          style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", objectPosition: "top center", border: "2px solid var(--hairline)" }}
                        />
                      ) : (
                        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--bg-soft)", border: "2px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <User size={22} strokeWidth={1.6} style={{ color: "var(--ink-faint)" }} />
                        </div>
                      )}
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink)", textAlign: "center", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.name || "이름 없음"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ModalBackdrop>
      )}

      {editing && (
        <EditMenuPopup
          deptId={deptId}
          deptName={dept.name}
          catId={editing.catId}
          itemId={editing.itemId}
          setting={menuSettings[settingKeyOf(editing.catId, editing.itemId)]}
          sectionLabels={sectionLabels}
          myGrade={grade}
          onClose={() => setEditing(null)}
          onSaved={(next) => { setMenuSettings(next); setEditing(null); showToast("메뉴를 수정했습니다"); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// 단일 메뉴 수정 팝업 (편집모드에서 "수정" 클릭 시)
//  - 공통메뉴 일부: 접근범위 3(선생님만)/4(학부모까지)
//  - 부서관리: 접근범위 0(전도사·교육사만)/1(부장까지)/2(임원진까지) — 위임.
//    범위 안 등급은 제목/설명 수정 가능, 접근범위 변경은 전도사·교육사(0)만
//  - 그 외: 제목/설명만
// ─────────────────────────────────────────────────────────────────
function EditMenuPopup({
  deptId, deptName, catId, itemId, setting, sectionLabels, myGrade, onClose, onSaved,
}: {
  deptId: string;
  deptName: string;
  catId: string;
  itemId: string;
  setting?: MenuSetting;
  sectionLabels: SectionLabels;
  myGrade: number;
  onClose: () => void;
  onSaved: (next: MenuSettings) => void;
}) {
  const cat = MENU_CATEGORIES.find((c) => c.id === catId);
  const item = cat?.items.find((it) => it.id === itemId);
  const menuKey = settingKeyOf(catId, itemId);
  const defLabel = (item?.label ?? "").replace("{dept}", deptName);
  const defDesc = item?.desc ?? "";
  // 부서관리 접근 범위(권한) 변경은 전도사·교육사(0)만 — 그 외 등급은 제목/설명만
  const canSetAccess = catId !== "department" || myGrade === 0;
  const accessOptions =
    catId === "notices" && ACCESS_CONFIGURABLE.has(itemId)
      ? [{ g: 3, t: "선생님만" }, { g: 4, t: "학부모까지" }]
      : catId === "department" && canSetAccess
        ? [{ g: 0, t: "전도사·교육사만" }, { g: 1, t: "부장까지" }, { g: 2, t: "임원진까지" }]
        : null;
  const defaultMax = catId === "department" ? 1 : (item?.maxGrade ?? 4);
  const fixedAccessNote =
    catId === "department" ? "권한 설정은 전도사(교육사)만 가능합니다."
      : catId === "students" ? "이 메뉴는 반 담임 선생님에게 표시됩니다 (접근 범위 고정)"
        : catId === "admin" ? "이 메뉴는 임원진(전도사~서기)에게 표시됩니다 (접근 범위 고정)"
          : "이 메뉴는 항상 학부모까지 공개됩니다 (접근 범위 고정)";

  // 행정관리: 섹션 배정 변경 가능
  const sectionEditable = catId === "admin";
  const defSection = item?.section ?? "ops";

  // 현재 적용값(없으면 기본값)을 채워서 시작
  const [label, setLabel] = useState(setting?.label && setting.label.trim() ? setting.label : defLabel);
  const [description, setDescription] = useState(setting?.description && setting.description.trim() ? setting.description : defDesc);
  const [section, setSection] = useState<string>(() =>
    setting?.section && ADMIN_SECTIONS.some((x) => x.id === setting.section) ? setting.section : defSection);
  const [maxGrade, setMaxGrade] = useState<number>(() => {
    if (!accessOptions) return defaultMax;
    return accessOptions.some((o) => o.g === setting?.max_grade) ? (setting!.max_grade as number) : defaultMax;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!label.trim()) { setError("메뉴 제목을 입력하세요"); return; }
    setSaving(true);
    setError("");
    const { error: e } = await supabase.rpc("set_dept_menu_setting", {
      p_department_id: deptId,
      p_menu_key: menuKey,
      p_label: label.trim() || null,
      p_description: description.trim() || null,
      p_max_grade: accessOptions ? maxGrade : null,
      ...(sectionEditable ? { p_section: section } : {}),
    });
    if (e) { setError(`저장 실패: ${e.message}`); setSaving(false); return; }
    const { data } = await supabase.rpc("get_dept_menu_settings", { p_department_id: deptId });
    setSaving(false);
    onSaved((data as MenuSettings) || {});
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ width: "100%", maxWidth: 440, background: "var(--card)", borderRadius: 18, overflow: "hidden" }}>
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
            <label style={modalLabel}>메뉴 제목</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={defLabel} maxLength={40} style={modalInput} />
          </div>
          <div>
            <label style={modalLabel}>메뉴 설명</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={defDesc} maxLength={60} style={modalInput} />
          </div>

          {sectionEditable && (
            <div>
              <label style={modalLabel}>섹션 (행정관리 내 묶음)</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                {ADMIN_SECTIONS.map((sec) => {
                  const active = section === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => setSection(sec.id)}
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                        padding: "10px 6px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                        border: `1.5px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
                        background: active ? "var(--accent-soft)" : "var(--card)",
                        color: active ? "var(--accent-strong)" : "var(--ink-soft)",
                      }}
                    >
                      <sec.icon size={13} strokeWidth={1.9} /> {sectionLabels[sec.id]?.trim() || sec.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {accessOptions ? (
            <div>
              <label style={modalLabel}>접근 범위</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {accessOptions.map((opt) => {
                  const active = maxGrade === opt.g;
                  return (
                    <button
                      key={opt.g}
                      type="button"
                      onClick={() => setMaxGrade(opt.g)}
                      style={{
                        flex: 1, padding: "10px", borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
                        border: `1.5px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
                        background: active ? "var(--accent-soft)" : "var(--card)",
                        color: active ? "var(--accent-strong)" : "var(--ink-soft)",
                      }}
                    >
                      {opt.t}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--ink-faint)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Lock size={12} strokeWidth={2} /> {fixedAccessNote}
            </div>
          )}

          {error && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)" }}>{error}</div>}
        </div>

        <div style={{ borderTop: "1px solid var(--hairline)", padding: "14px 18px", display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid var(--hairline-strong)", background: "var(--card)", color: "var(--ink-mid)", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: "12px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 14, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: "inherit" }}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

const sectionMoveBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6,
  border: "1px solid var(--hairline)", background: "var(--card)", color: disabled ? "var(--ink-faint)" : "var(--ink-mid)",
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
});
const sectionLabelInputStyle: React.CSSProperties = {
  width: "min(220px, 44vw)",
  minHeight: 28,
  border: "1px solid var(--hairline)",
  borderRadius: 7,
  background: "var(--card)",
  color: "var(--ink-mid)",
  padding: "4px 8px",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 800,
  outline: "none",
};

const modalLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", letterSpacing: 0.2 };
const modalInput: React.CSSProperties = { width: "100%", marginTop: 5, padding: "10px 12px", fontSize: 14, background: "var(--card)", border: "1.5px solid var(--hairline)", borderRadius: 9, outline: "none", fontFamily: "inherit", boxSizing: "border-box", color: "var(--ink)", fontWeight: 500 };

function MenuCard({ item, badgeCount = 0, onClick, onEdit, cardRef, dragging, onDragHandle }: {
  item: MenuItem;
  badgeCount?: number;
  onClick: () => void;
  onEdit?: () => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  dragging?: boolean;
  onDragHandle?: (e: React.PointerEvent) => void;
}) {
  const dim = !item.implemented;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStart = useRef<{ x: number; y: number; type: string } | null>(null);
  const dragElement = useRef<HTMLDivElement | null>(null);
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      try { dragElement.current?.setPointerCapture(pointerId); } catch { /* 이미 끝난 터치는 무시 */ }
      onDragHandle(e);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(25);
    }, 450);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragMoved.current || longPressFired.current) {
      e.preventDefault();
      e.stopPropagation();
      dragMoved.current = false;
      longPressFired.current = false;
      return;
    }
    (onEdit || onClick)();
  };

  return (
    <div
      ref={(el) => {
        dragElement.current = el;
        cardRef?.(el);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClick={handleClick}
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e) => { if (onDragHandle) e.preventDefault(); }}
      title={onDragHandle ? "PC에서는 카드를 드래그, 모바일에서는 길게 눌러 드래그" : undefined}
      style={{
        background: dim ? "var(--surface)" : "var(--card)",
        border: `1.5px solid ${dragging ? "var(--accent)" : dim ? "var(--hairline)" : `color-mix(in srgb, ${item.color} 26%, transparent)`}`,
        borderRadius: 12,
        padding: "14px 14px",
        cursor: onDragHandle ? (dragging ? "grabbing" : "grab") : "pointer",
        userSelect: onDragHandle ? "none" : undefined,
        WebkitUserSelect: onDragHandle ? "none" : undefined,
        WebkitTouchCallout: onDragHandle ? "none" : undefined,
        transition: dragging ? "none" : "all 0.15s",
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: dragging ? 0.18 : dim ? 0.7 : 1,
        boxShadow: dragging ? "none" : undefined,
        position: "relative",
      }}
      onMouseOver={(e) => {
        if (dim) return;
        e.currentTarget.style.borderColor = item.color;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = `0 8px 20px color-mix(in srgb, ${item.color} 13%, transparent)`;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = dim ? "var(--hairline)" : `color-mix(in srgb, ${item.color} 26%, transparent)`;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {onDragHandle && (
        <span
          onClick={(e) => e.stopPropagation()}
          title="PC: 카드 전체 드래그 · 모바일: 길게 누른 뒤 드래그"
          style={{
            cursor: dragging ? "grabbing" : "grab",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 40, marginLeft: -8, marginRight: -6,
            color: "var(--ink-faint)", flexShrink: 0,
          }}
        >
          <GripVertical size={15} strokeWidth={2} />
        </span>
      )}
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: dim ? "var(--hairline)" : `color-mix(in srgb, ${item.color} 9%, transparent)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <item.icon size={18} strokeWidth={1.8} style={{ color: dim ? "var(--ink-faint)" : item.color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: dim ? "var(--ink-faint)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.label}
          {dim && <span style={{ fontSize: 9, color: "var(--ink-faint)", marginLeft: 6, fontWeight: 500 }}>(준비 중)</span>}
        </div>
        <div style={{ fontSize: 10, color: "var(--ink-faint)", marginTop: 2, lineHeight: 1.3 }}>{item.desc}</div>
      </div>
      {onEdit && (
        <span style={{
          position: "absolute", top: "50%", right: 10, transform: "translateY(-50%)",
          display: "inline-flex", alignItems: "center", gap: 3,
          padding: "3px 8px", borderRadius: 99, fontSize: 11, fontWeight: 800,
          background: "var(--accent)", color: "#fff",
        }}>
          <Pencil size={11} strokeWidth={2.4} /> 수정
        </span>
      )}
      {!onEdit && badgeCount > 0 && (
        <span style={{
          position: "absolute", top: -6, right: -6,
          minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999,
          background: "var(--danger)", color: "#fff",
          border: "2px solid var(--card)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 900, lineHeight: 1,
          boxSizing: "border-box",
        }}>
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </div>
  );
}

const GRADE_LABEL: Record<number, string> = {
  0: "전도사·교육사",
  1: "부장",
  2: "부부장·총무·서기",
  3: "교사",
  4: "학부모",
};

const GRADE_BADGE: Record<number, { label: string; bg: string; color: string }> = {
  0: { label: "전도사", bg: "var(--success-soft)", color: "var(--success)" },
  1: { label: "부장", bg: "var(--warning-soft)", color: "var(--warning)" },
  2: { label: "총무·서기", bg: "var(--accent-soft)", color: "var(--accent-strong)" },
  3: { label: "교사", bg: "var(--bg-soft)", color: "var(--ink-mid)" },
  4: { label: "학부모", bg: "var(--danger-soft)", color: "var(--danger)" },
};

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-soft)",
  fontFamily: "'Noto Sans KR', sans-serif",
};


const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--bg-soft)",
  border: "none",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--ink-mid)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 40,
  left: "50%",
  transform: "translateX(-50%)",
  background: "rgba(43, 39, 34,0.88)",
  color: "#fff",
  padding: "12px 24px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  zIndex: 999,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
