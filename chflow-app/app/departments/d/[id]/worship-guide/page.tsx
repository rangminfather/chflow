"use client";

// ─────────────────────────────────────────────────────────────────
// 예배안내 — 주일 예배 안내 메시지 생성·공유 (초등1부, 전도사·부장)
//
// 생성 소스 우선순위:
//  · 예배인도/설교자/제목/성경/찬양율동/2부활동 → 월간 교육계획서 (bulletin-import API)
//  · 안내반 → 직전 저장분의 guideNext (없으면 계획서 → 로테이션 첫 반). 3-2반 제외 로테이션.
//  · 기도반 → 매월 첫째 주일 = 김정권 장로님 고정(로테이션 소모 없음),
//             그 외 = 직전 저장분의 prayerNext (전 반 로테이션, 순서 스왑은 select 로 수동 조정)
//  · 주보 이중체크 → 해당 주일 교회주보 PDF 3페이지 초등1부 칼럼 텍스트 대조 (best-effort)
// ─────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  RefreshCw, Copy, Share2, Save, ChevronLeft, ChevronRight,
  CircleCheck, CircleAlert, CircleHelp, Lock, Newspaper, CalendarDays,
} from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";

// ───────────────────────── 타입 ─────────────────────────

type ClassRow = {
  class_no: string;
  grade_year: number | null;
  teacher_name: string | null;
};

type TeacherRow = { name: string; teacher_role: string | null };

type PlanFields = {
  guide?: string; praise1?: string; praise2?: string; leader?: string;
  prayerClass?: string; scripture?: string; sermonTitle?: string; preacher?: string;
  twoPartActivity?: string; versePassage?: string;
};

type PlanInfo = { fields: PlanFields; sourceFile: string; sheetName: string } | null;

type GuideFields = {
  guideClass?: string; guideNext?: string;
  prayerClass?: string; prayerNext?: string; prayerFixed?: boolean;
};

type GuideRecord = { sunday_date: string; fields: GuideFields; message: string | null } | null;

type BulletinCheck =
  | { status: "idle" | "checking" }
  | { status: "missing" }                       // 해당 주일 주보 미등록
  | { status: "notext" }                        // PDF 텍스트 추출 불가 (스캔본 등)
  | { status: "error"; detail: string }
  | { status: "done"; found: { title: boolean; scripture: boolean; preacher: boolean }; sectionFound: boolean };

// ───────────────────────── 상수 ─────────────────────────

const GUIDE_EXCLUDE = ["3-2"];              // 안내 로테이션 제외 반 (안근정 선생님 반)
const PRAYER_FIXED_LABEL = "김정권 장로님"; // 매월 첫째 주일 고정 기도
const DEFAULT_THEME_LINE = "더욱 충만한 교회! (성령, 은혜, 말씀)";

// ───────────────────────── 날짜 헬퍼 ─────────────────────────

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function upcomingSunday(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return toISO(d);
}

function shiftSunday(iso: string, weeks: number): string {
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() + weeks * 7);
  return toISO(d);
}

/** 매월 첫째 주일 여부 */
function isFirstSunday(iso: string) {
  return Number(iso.slice(8, 10)) <= 7;
}

function monthDayLabel(iso: string) {
  return `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
}

// ───────────────────────── 로테이션 헬퍼 ─────────────────────────

/** "3-3 → 3-2 → … → 1-1 → 3-3" 내림차순 로테이션 순서 */
function sortClassesDesc(classes: ClassRow[]): string[] {
  return classes
    .map((c) => c.class_no)
    .filter((no) => /^\d+-\d+$/.test(no))
    .sort((a, b) => {
      const [ag, an] = a.split("-").map(Number);
      const [bg, bn] = b.split("-").map(Number);
      return bg - ag || bn - an;
    });
}

function nextOf(classNo: string | undefined, list: string[]): string {
  if (!list.length) return "";
  const idx = classNo ? list.indexOf(classNo) : -1;
  return list[(idx + 1) % list.length];
}

/** 계획서 값("3-3" / 교사 이름 / "김정권장로님")을 반 번호 또는 "FIXED" 로 정규화 */
function normalizeClassToken(value: string | undefined, classes: ClassRow[]): string | null {
  const v = (value || "").trim();
  if (!v) return null;
  if (v.includes("장로")) return "FIXED";
  const m = v.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return `${Number(m[1])}-${Number(m[2])}`;
  const byTeacher = classes.find((c) => c.teacher_name && (v.includes(c.teacher_name) || c.teacher_name.includes(v)));
  return byTeacher ? byTeacher.class_no : null;
}

// ───────────────────────── 호칭 헬퍼 ─────────────────────────

const TITLE_DONE_RE = /(선생님|전도사님|목사님|장로님|선교사님|권사님|집사님|교육사님)$/;
const TITLE_BARE_RE = /(전도사|목사|장로|선교사|권사|집사|교육사)$/;

/** 예배인도자 호칭: 교사 직책(부장 등) 반영 */
function leaderHonorific(name: string, teachers: TeacherRow[]): string {
  const v = name.trim();
  if (!v) return "";
  if (TITLE_DONE_RE.test(v)) return v;
  if (TITLE_BARE_RE.test(v)) return `${v}님`;
  const t = teachers.find((t) => t.name === v || v.includes(t.name));
  if (t?.teacher_role === "부장") return `${t.name} 부장선생님`;
  if (t?.teacher_role === "부부장") return `${t.name} 부부장선생님`;
  return `${v} 선생님`;
}

/** 설교자 호칭: 직함 있으면 "님"만 보정, 외부 강사 이름만 있으면 그대로 둠(수정 가능) */
function preacherHonorific(name: string, teachers: TeacherRow[]): string {
  const v = name.trim();
  if (!v) return "";
  if (TITLE_DONE_RE.test(v)) return v;
  if (TITLE_BARE_RE.test(v)) return `${v}님`;
  const t = teachers.find((t) => t.name === v);
  if (t) return leaderHonorific(v, teachers);
  return v;
}

// ───────────────────────── 컴포넌트 ─────────────────────────

export default function WorshipGuidePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [canShare, setCanShare] = useState(false);

  const [sunday, setSunday] = useState(upcomingSunday());
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [themeLine, setThemeLine] = useState(DEFAULT_THEME_LINE);
  const [plan, setPlan] = useState<PlanInfo>(null);
  const [planError, setPlanError] = useState("");
  const [record, setRecord] = useState<GuideRecord>(null);
  const [prevRecord, setPrevRecord] = useState<GuideRecord>(null);

  const [guideClass, setGuideClass] = useState("");
  const [prayerClass, setPrayerClass] = useState("");
  const [prayerFixed, setPrayerFixed] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [bulletinCheck, setBulletinCheck] = useState<BulletinCheck>({ status: "idle" });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const classOrder = useMemo(() => sortClassesDesc(classes), [classes]);
  const guideOrder = useMemo(() => classOrder.filter((no) => !GUIDE_EXCLUDE.includes(no)), [classOrder]);
  const teacherOf = useCallback(
    (classNo: string) => classes.find((c) => c.class_no === classNo)?.teacher_name || "",
    [classes],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  // ── 메시지 생성 ──
  const buildMessage = useCallback((opts: {
    date: string; guideCls: string; prayerCls: string; fixed: boolean;
    planFields: PlanFields | null; theme: string;
  }) => {
    const f = opts.planFields || {};
    const need = "(직접 입력)";
    const year = opts.date.slice(0, 4);

    const guideTeacher = teacherOf(opts.guideCls);
    const guideLine = opts.guideCls
      ? `${opts.guideCls}반${guideTeacher ? ` ${guideTeacher}` : ""} 선생님`
      : need;

    const praiseNames = [f.praise1, f.praise2].filter(Boolean).join(", ");
    const praiseLine = praiseNames ? `${praiseNames} 선생님` : need;

    const leaderLine = f.leader ? leaderHonorific(f.leader, teachers) : need;

    let prayerLine: string;
    if (opts.fixed) {
      prayerLine = PRAYER_FIXED_LABEL;
    } else if (opts.prayerCls) {
      const t = teacherOf(opts.prayerCls);
      prayerLine = `${opts.prayerCls}반 어린이${t ? `(${t}선생님반)` : ""}`;
    } else {
      prayerLine = need;
    }

    const preacherLine = f.preacher ? preacherHonorific(f.preacher, teachers) : need;

    return [
      `샬롬 ${year}년 `,
      opts.theme,
      "주일 예배 안내드립니다!",
      "",
      `~ ${monthDayLabel(opts.date)} 초등1부 예배 ~ `,
      "",
      `1. 안내 : ${guideLine}`,
      "",
      `2. 찬양율동 : ${praiseLine}`,
      "",
      `3. 예배인도 : ${leaderLine}`,
      "",
      `4. 봉헌기도 :  ${prayerLine}`,
      "",
      `5. 말씀강론 : ${preacherLine}`,
      `  가. 제목 : ${f.sermonTitle || need}`,
      `  나. 성경 : ${f.scripture || need}`,
      "6. 2부 활동",
      `  - ${f.twoPartActivity || need}`,
      "오늘 하루도 좋은 하루되시고 주일날 뵙겠습니다^^*",
    ].join("\n");
  }, [teacherOf, teachers]);

  // ── 로테이션 제안값 계산 ──
  const suggestRotation = useCallback((prev: GuideRecord, planFields: PlanFields | null, date: string) => {
    const pf = prev?.fields || {};

    // 안내: 직전 저장분의 "다음 반" → 계획서 → 로테이션 첫 반
    let g = pf.guideNext && guideOrder.includes(pf.guideNext) ? pf.guideNext : "";
    if (!g && pf.guideClass) g = nextOf(pf.guideClass, guideOrder);
    if (!g) {
      const fromPlan = normalizeClassToken(planFields?.guide, classes);
      if (fromPlan && fromPlan !== "FIXED") g = fromPlan;
    }
    if (!g) g = guideOrder[0] || "";

    // 기도: 첫째 주일은 장로님 고정 (어린이 로테이션은 멈춤)
    const fixed = isFirstSunday(date);
    let p = pf.prayerNext && classOrder.includes(pf.prayerNext) ? pf.prayerNext : "";
    if (!p && pf.prayerClass && classOrder.includes(pf.prayerClass)) p = nextOf(pf.prayerClass, classOrder);
    if (!p) {
      const fromPlan = normalizeClassToken(planFields?.prayerClass, classes);
      if (fromPlan && fromPlan !== "FIXED") p = fromPlan;
    }
    if (!p) p = classOrder[0] || "";

    return { guide: g, prayer: p, fixed };
  }, [classes, classOrder, guideOrder]);

  // ── 주보 이중체크 (best-effort) ──
  const runBulletinCheck = useCallback(async (token: string, date: string, planFields: PlanFields | null) => {
    if (!planFields?.sermonTitle && !planFields?.scripture && !planFields?.preacher) {
      setBulletinCheck({ status: "idle" });
      return;
    }
    setBulletinCheck({ status: "checking" });
    try {
      const res = await fetch("/api/bulletin/latest", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "주보 목록 조회 실패");
      type Item = { issue_date: string | null; pdf_url?: string | null };
      const item = ((data.items || []) as Item[]).find((i) => i.issue_date === date && i.pdf_url);
      if (!item?.pdf_url) { setBulletinCheck({ status: "missing" }); return; }

      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ url: item.pdf_url }).promise;
      let text = "";
      // 초등1부 칼럼은 3페이지 — 지면 변동 대비 2~4페이지 스캔
      for (let p = 2; p <= Math.min(doc.numPages, 4); p += 1) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        text += tc.items.map((it) => ("str" in it ? it.str : "")).join(" ") + " ";
      }
      const whole = text.replace(/\s+/g, "");
      if (!whole) { setBulletinCheck({ status: "notext" }); return; }

      const idx = whole.indexOf("초등1부");
      const sectionFound = idx >= 0;
      const section = sectionFound ? whole.slice(idx, idx + 900) : whole;
      const norm = (s: string) => s.replace(/\s+/g, "");
      const inSection = (v?: string) => {
        const n = norm(v || "");
        return !!n && (section.includes(n) || whole.includes(n));
      };
      const preacherName = (planFields.preacher || "").trim().split(/\s+/)[0] || "";

      setBulletinCheck({
        status: "done",
        sectionFound,
        found: {
          title: inSection(planFields.sermonTitle),
          scripture: inSection(planFields.scripture),
          preacher: inSection(preacherName),
        },
      });
    } catch {
      setBulletinCheck({ status: "error", detail: "주보 PDF 확인 중 오류가 발생했습니다" });
    }
  }, []);

  // ── 데이터 로드 ──
  const load = useCallback(async (date: string) => {
    setLoading(true);
    setPlanError("");
    setBulletinCheck({ status: "idle" });
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }
    const token = session.access_token;

    const [guideResp, classResp, teacherResp, themeResp, planResp] = await Promise.all([
      supabase.rpc("worship_guide_get", { p_dept_id: deptId, p_sunday: date }),
      supabase.rpc("list_dept_classes_full", { p_dept_id: deptId }),
      supabase.from("edu_teachers").select("name,teacher_role").eq("department_id", deptId).eq("is_active", true),
      supabase.rpc("bulletin_get_yearly_theme", { p_dept_id: deptId, p_year: Number(date.slice(0, 4)) }),
      fetch(`/api/edu/monthly-plans/bulletin-import?dept_id=${deptId}&date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()).catch(() => null),
    ]);

    if (guideResp.error) {
      if (guideResp.error.message.includes("권한")) { setAuthorized(false); setLoading(false); return; }
      showToast("조회 실패: " + guideResp.error.message);
      setLoading(false);
      return;
    }
    setAuthorized(true);

    const cls = ((classResp.data as ClassRow[]) || []).filter((c) => c.class_no);
    setClasses(cls);
    setTeachers(((teacherResp.data as TeacherRow[]) || []));

    const themeRow = Array.isArray(themeResp.data) ? themeResp.data[0] : themeResp.data;
    const theme = (themeRow as { theme?: string } | null)?.theme?.trim();
    const line = theme && !DEFAULT_THEME_LINE.startsWith(theme) ? theme : DEFAULT_THEME_LINE;
    setThemeLine(line);

    let planInfo: PlanInfo = null;
    if (planResp?.ok && planResp.plan) {
      planInfo = { fields: planResp.plan.fields as PlanFields, sourceFile: planResp.plan.sourceFile, sheetName: planResp.plan.sheetName };
    } else {
      setPlanError(planResp?.error || "월간 교육계획서에서 해당 주를 찾지 못했습니다");
    }
    setPlan(planInfo);

    const payload = (guideResp.data || {}) as { current?: GuideRecord; prev?: GuideRecord };
    const current = payload.current || null;
    const prev = payload.prev || null;
    setRecord(current);
    setPrevRecord(prev);

    // 저장본이 있으면 그대로, 없으면 자동 생성
    const order = sortClassesDesc(cls);
    const gOrder = order.filter((no) => !GUIDE_EXCLUDE.includes(no));
    if (current) {
      const f = current.fields || {};
      const fixed = f.prayerFixed ?? isFirstSunday(date);
      setGuideClass(f.guideClass || "");
      setPrayerClass(f.prayerClass && order.includes(f.prayerClass) ? f.prayerClass : "");
      setPrayerFixed(fixed);
      setMessage(current.message || "");
    } else {
      // suggestRotation 은 state 기반이라 여기서는 로컬 계산으로 초기값 구성
      const pf = prev?.fields || {};
      let g = pf.guideNext && gOrder.includes(pf.guideNext) ? pf.guideNext : "";
      if (!g && pf.guideClass) g = nextOf(pf.guideClass, gOrder);
      if (!g) {
        const fromPlan = normalizeClassToken(planInfo?.fields.guide, cls);
        if (fromPlan && fromPlan !== "FIXED") g = fromPlan;
      }
      if (!g) g = gOrder[0] || "";

      const fixed = isFirstSunday(date);
      let p = pf.prayerNext && order.includes(pf.prayerNext) ? pf.prayerNext : "";
      if (!p && pf.prayerClass && order.includes(pf.prayerClass)) p = nextOf(pf.prayerClass, order);
      if (!p) {
        const fromPlan = normalizeClassToken(planInfo?.fields.prayerClass, cls);
        if (fromPlan && fromPlan !== "FIXED") p = fromPlan;
      }
      if (!p) p = order[0] || "";

      setGuideClass(g);
      setPrayerClass(p);
      setPrayerFixed(fixed);
      setMessage("");
      // 메시지는 아래 useEffect 에서 buildMessage 로 생성 (teachers state 반영 후)
    }

    setLoading(false);
    runBulletinCheck(token, date, planInfo?.fields || null);
  }, [deptId, router, runBulletinCheck, showToast]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      setCanShare(typeof navigator !== "undefined" && !!navigator.share);
      await load(sunday);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 저장본 없이 로드가 끝났으면 자동 생성 (teachers/classes state 반영 후 1회)
  useEffect(() => {
    if (loading || !authorized || record || message) return;
    if (!guideClass && !prayerClass && !plan) return;
    setMessage(buildMessage({
      date: sunday, guideCls: guideClass, prayerCls: prayerClass,
      fixed: prayerFixed, planFields: plan?.fields || null, theme: themeLine,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, authorized, record, guideClass, prayerClass, prayerFixed, plan, themeLine]);

  // textarea 높이 자동
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 4}px`;
  }, [message, loading]);

  const changeSunday = (weeks: number) => {
    const next = shiftSunday(sunday, weeks);
    setSunday(next);
    setRecord(null);
    setPrevRecord(null);
    setMessage("");
    load(next);
  };

  const regenerate = (over?: { guideCls?: string; prayerCls?: string; fixed?: boolean }) => {
    const g = over?.guideCls ?? guideClass;
    const p = over?.prayerCls ?? prayerClass;
    const fx = over?.fixed ?? prayerFixed;
    setMessage(buildMessage({
      date: sunday, guideCls: g, prayerCls: p, fixed: fx,
      planFields: plan?.fields || null, theme: themeLine,
    }));
  };

  const buildFields = (): GuideFields => {
    const prevF = prevRecord?.fields || {};
    const carry = prevF.prayerNext || (prevF.prayerClass ? nextOf(prevF.prayerClass, classOrder) : classOrder[0] || "");
    return {
      guideClass,
      guideNext: nextOf(guideClass, guideOrder),
      prayerFixed,
      prayerClass: prayerFixed ? PRAYER_FIXED_LABEL : prayerClass,
      // 첫째주(장로님 고정)는 어린이 로테이션을 소모하지 않고 이월
      prayerNext: prayerFixed ? carry : nextOf(prayerClass, classOrder),
    };
  };

  const saveGuide = async (silent = false): Promise<boolean> => {
    setSaving(true);
    const { error } = await supabase.rpc("worship_guide_save", {
      p_dept_id: deptId,
      p_sunday: sunday,
      p_fields: buildFields(),
      p_message: message,
    });
    setSaving(false);
    if (error) { showToast("저장 실패: " + error.message); return false; }
    setRecord({ sunday_date: sunday, fields: buildFields(), message });
    if (!silent) showToast("저장되었습니다");
    return true;
  };

  const doCopy = async () => {
    if (!(await saveGuide(true))) return;
    try {
      await navigator.clipboard.writeText(message);
      showToast("복사되었습니다 — 카톡방에 붙여넣기 하세요");
    } catch {
      showToast("복사에 실패했습니다. 메시지를 길게 눌러 직접 복사해주세요");
    }
  };

  const doShare = async () => {
    if (!(await saveGuide(true))) return;
    try {
      await navigator.share({ text: message });
      showToast("공유 완료");
    } catch {
      /* 사용자가 공유 취소 — 무시 */
    }
  };

  // ───────────────────────── 렌더 ─────────────────────────

  if (!authChecked) return <main style={pageStyle}><LoadingView full /></main>;

  if (!authorized) {
    return (
      <main style={pageStyle}>
        <section style={shellStyle}>
          <div style={emptyStyle}>
            <Lock size={40} strokeWidth={1.6} style={{ color: "var(--ink-faint)" }} />
            <div style={emptyTitleStyle}>예배안내 접근 권한이 없습니다</div>
            <div style={emptyTextStyle}>전도사·부장(등급 0~1)만 이용할 수 있습니다.</div>
            <button type="button" onClick={() => router.push(`/departments/d/${deptId}`)} style={primaryButtonStyle}>부서홈으로</button>
          </div>
        </section>
      </main>
    );
  }

  const suggestion = suggestRotation(prevRecord, plan?.fields || null, sunday);

  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <header className="app-subpage-header" style={headerStyle}>
          <button className="app-header-back" type="button" onClick={() => router.push(`/departments/d/${deptId}`)} aria-label="부서홈으로" style={{ ...iconButtonStyle, width: "auto", padding: "0 12px", whiteSpace: "nowrap" }}>
            ← 부서홈
          </button>
          <HeaderLogo />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={eyebrowStyle}>교육사역국 · 초등1부</div>
            <h1 style={titleStyle}>예배안내</h1>
          </div>
        </header>

        {/* 주일 선택 */}
        <div style={weekBarStyle}>
          <button type="button" onClick={() => changeSunday(-1)} aria-label="이전 주일" style={iconButtonStyle}>
            <ChevronLeft size={19} strokeWidth={1.8} />
          </button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{monthDayLabel(sunday)} 주일</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 500 }}>
              {isFirstSunday(sunday) ? `매월 첫째 주일 — 봉헌기도 ${PRAYER_FIXED_LABEL} 고정` : "봉헌기도 어린이 로테이션 주간"}
            </div>
          </div>
          <button type="button" onClick={() => changeSunday(1)} aria-label="다음 주일" style={iconButtonStyle}>
            <ChevronRight size={19} strokeWidth={1.8} />
          </button>
        </div>

        {loading ? (
          <div style={loadingPanelStyle}>안내 자료 불러오는 중...</div>
        ) : (
          <>
            {/* 소스 상태 */}
            <div style={chipRowStyle}>
              <SourceChip
                ok={!!plan}
                okText={`월간계획서 반영됨 (${plan?.sourceFile || ""})`}
                badText={`월간계획서 없음 — ${planError} · 빈 항목은 직접 입력해주세요`}
              />
              <BulletinChip check={bulletinCheck} />
              {record && (
                <span style={{ ...chipStyle, background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }}>
                  <CircleCheck size={13} strokeWidth={2} /> 저장된 안내가 있습니다
                </span>
              )}
            </div>

            {/* 안내반 / 기도반 조정 */}
            <div style={controlCardStyle}>
              <div style={controlRowStyle}>
                <label style={controlLabelStyle}>안내</label>
                <select
                  value={guideClass}
                  onChange={(e) => { setGuideClass(e.target.value); regenerate({ guideCls: e.target.value }); }}
                  style={selectStyle}
                >
                  <option value="">직접 입력</option>
                  {classOrder.map((no) => (
                    <option key={no} value={no}>
                      {no}반{teacherOf(no) ? ` (${teacherOf(no)})` : ""}{GUIDE_EXCLUDE.includes(no) ? " — 로테이션 제외 반" : ""}
                    </option>
                  ))}
                </select>
                {suggestion.guide && suggestion.guide !== guideClass && (
                  <span style={hintStyle}>규칙상 {suggestion.guide}반 차례</span>
                )}
              </div>
              <div style={controlRowStyle}>
                <label style={controlLabelStyle}>봉헌기도</label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
                  <input
                    type="checkbox"
                    checked={prayerFixed}
                    onChange={(e) => { setPrayerFixed(e.target.checked); regenerate({ fixed: e.target.checked }); }}
                  />
                  {PRAYER_FIXED_LABEL} (첫째주)
                </label>
                <select
                  value={prayerClass}
                  disabled={prayerFixed}
                  onChange={(e) => { setPrayerClass(e.target.value); regenerate({ prayerCls: e.target.value }); }}
                  style={{ ...selectStyle, opacity: prayerFixed ? 0.45 : 1 }}
                >
                  <option value="">직접 입력</option>
                  {classOrder.map((no) => (
                    <option key={no} value={no}>{no}반{teacherOf(no) ? ` (${teacherOf(no)})` : ""}</option>
                  ))}
                </select>
                {!prayerFixed && suggestion.prayer && suggestion.prayer !== prayerClass && (
                  <span style={hintStyle}>규칙상 {suggestion.prayer}반 차례</span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
                순서를 바꿔 진행한 주는 여기서 반만 바꾸면, 다음 주 차례 계산에도 그대로 반영됩니다.
              </div>
            </div>

            {/* 핸드폰 목업 */}
            <div style={phoneWrapStyle}>
              <div style={phoneFrameStyle}>
                <div style={phoneNotchStyle} />
                <div style={phoneScreenStyle}>
                  <div style={chatHeaderStyle}>초등1부 교사방</div>
                  <div style={{ padding: "12px 10px 16px" }}>
                    <textarea
                      ref={textareaRef}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      spellCheck={false}
                      style={bubbleStyle}
                      aria-label="예배안내 메시지 (수정 가능)"
                    />
                    <div style={{ fontSize: 10.5, color: "var(--ink-faint)", textAlign: "right", marginTop: 4 }}>
                      말풍선을 눌러 자유롭게 수정하세요
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 액션 */}
            <div style={actionRowStyle}>
              <button type="button" onClick={() => regenerate()} style={secondaryButtonStyle}>
                <RefreshCw size={15} strokeWidth={2} /> 다시 생성
              </button>
              <button type="button" onClick={() => saveGuide()} disabled={saving} style={secondaryButtonStyle}>
                <Save size={15} strokeWidth={2} /> 저장
              </button>
              <button type="button" onClick={doCopy} disabled={saving} style={primaryActionStyle}>
                <Copy size={15} strokeWidth={2} /> 복사하기
              </button>
              {canShare && (
                <button type="button" onClick={doShare} disabled={saving} style={primaryActionStyle}>
                  <Share2 size={15} strokeWidth={2} /> 카톡으로 공유
                </button>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)", textAlign: "center", marginTop: 8, lineHeight: 1.55 }}>
              복사·공유 시 자동 저장됩니다. 공유 버튼은 휴대폰에서 카카오톡을 선택해 교사방으로 바로 보낼 수 있습니다.
            </div>
          </>
        )}
      </section>

      {toast && <div style={toastStyle}>{toast}</div>}
    </main>
  );
}

// ───────────────────────── 상태 칩 ─────────────────────────

function SourceChip({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return ok ? (
    <span style={{ ...chipStyle, background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)" }}>
      <CalendarDays size={13} strokeWidth={2} /> {okText}
    </span>
  ) : (
    <span style={{ ...chipStyle, background: "color-mix(in srgb, var(--warning) 14%, transparent)", color: "var(--warning)" }}>
      <CircleAlert size={13} strokeWidth={2} /> {badText}
    </span>
  );
}

function BulletinChip({ check }: { check: BulletinCheck }) {
  const base = { ...chipStyle };
  switch (check.status) {
    case "idle":
      return null;
    case "checking":
      return <span style={{ ...base, background: "var(--bg-soft)", color: "var(--ink-soft)" }}><Newspaper size={13} strokeWidth={2} /> 주보 이중체크 중...</span>;
    case "missing":
      return (
        <span style={{ ...base, background: "color-mix(in srgb, var(--warning) 14%, transparent)", color: "var(--warning)" }}>
          <CircleHelp size={13} strokeWidth={2} /> 해당 주일 주보 미등록 — 계획서 기준으로 생성됨. 주보 등록 후 다시 열면 자동 재확인됩니다
        </span>
      );
    case "notext":
      return (
        <span style={{ ...base, background: "var(--bg-soft)", color: "var(--ink-soft)" }}>
          <CircleHelp size={13} strokeWidth={2} /> 주보 PDF에서 텍스트를 읽을 수 없어 자동 대조 불가 — 주보보기에서 3페이지를 직접 확인해주세요
        </span>
      );
    case "error":
      return (
        <span style={{ ...base, background: "var(--bg-soft)", color: "var(--ink-soft)" }}>
          <CircleAlert size={13} strokeWidth={2} /> {check.detail}
        </span>
      );
    case "done": {
      const { title, scripture, preacher } = check.found;
      const all = title && scripture && preacher;
      if (all) {
        return (
          <span style={{ ...base, background: "color-mix(in srgb, var(--success) 12%, transparent)", color: "var(--success)" }}>
            <CircleCheck size={13} strokeWidth={2} /> 주보 이중체크 일치 (설교자·제목·본문)
          </span>
        );
      }
      const misses = [!title && "제목", !scripture && "본문", !preacher && "설교자"].filter(Boolean).join("·");
      return (
        <span style={{ ...base, background: "color-mix(in srgb, var(--warning) 14%, transparent)", color: "var(--warning)" }}>
          <CircleAlert size={13} strokeWidth={2} /> 주보에서 {misses} 확인 안 됨 — 표기 차이일 수 있으니 주보 3페이지와 대조해주세요
        </span>
      );
    }
  }
}

// ───────────────────────── 스타일 ─────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "'Noto Sans KR', var(--app-sans), sans-serif",
  padding: "clamp(12px, 4vw, 24px)",
};

const shellStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 720,
  margin: "0 auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 14,
};

const iconButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 10,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--ink)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "var(--accent)",
  lineHeight: 1.2,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: 1.25,
  fontWeight: 800,
};

const weekBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 12px",
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  background: "var(--surface)",
  marginBottom: 12,
};

const chipRowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 12,
};

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "flex-start",
  gap: 6,
  padding: "7px 11px",
  borderRadius: 9,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.45,
};

const controlCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px 14px",
  border: "1px solid var(--hairline)",
  borderRadius: 12,
  background: "var(--surface)",
  marginBottom: 16,
};

const controlRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const controlLabelStyle: React.CSSProperties = {
  width: 60,
  fontSize: 13,
  fontWeight: 700,
  flexShrink: 0,
};

const selectStyle: React.CSSProperties = {
  minHeight: 36,
  padding: "0 10px",
  borderRadius: 9,
  border: "1px solid var(--hairline)",
  background: "var(--card)",
  color: "var(--ink)",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "inherit",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--warning)",
};

const phoneWrapStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  marginBottom: 16,
};

const phoneFrameStyle: React.CSSProperties = {
  width: "min(390px, 100%)",
  border: "10px solid color-mix(in srgb, var(--ink) 82%, transparent)",
  borderRadius: 38,
  background: "color-mix(in srgb, var(--ink) 82%, transparent)",
  position: "relative",
  boxShadow: "0 18px 44px color-mix(in srgb, var(--ink) 22%, transparent)",
};

const phoneNotchStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: "50%",
  transform: "translateX(-50%)",
  width: 110,
  height: 20,
  borderRadius: "0 0 14px 14px",
  background: "color-mix(in srgb, var(--ink) 82%, transparent)",
  zIndex: 2,
};

const phoneScreenStyle: React.CSSProperties = {
  borderRadius: 28,
  overflow: "hidden",
  background: "var(--bg-soft)",
  minHeight: 480,
};

const chatHeaderStyle: React.CSSProperties = {
  padding: "26px 14px 10px",
  fontSize: 13.5,
  fontWeight: 700,
  textAlign: "center",
  borderBottom: "1px solid var(--hairline)",
  background: "var(--surface)",
};

const bubbleStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  border: "none",
  outline: "none",
  resize: "none",
  borderRadius: "16px 4px 16px 16px",
  padding: "12px 13px",
  background: "#FEE500",
  color: "#1F1500",
  fontSize: 13.5,
  lineHeight: 1.6,
  fontWeight: 500,
  fontFamily: "inherit",
  whiteSpace: "pre-wrap",
  overflow: "hidden",
  boxShadow: "0 1px 3px color-mix(in srgb, var(--ink) 12%, transparent)",
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "center",
};

const buttonBase: React.CSSProperties = {
  minHeight: 40,
  padding: "0 16px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontFamily: "inherit",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonBase,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  color: "var(--ink)",
};

const primaryActionStyle: React.CSSProperties = {
  ...buttonBase,
  border: "none",
  background: "#3E7D74",
  color: "#fff",
};

const loadingPanelStyle: React.CSSProperties = {
  minHeight: 180,
  borderRadius: 14,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--ink-soft)",
};

const emptyStyle: React.CSSProperties = {
  minHeight: 260,
  borderRadius: 14,
  border: "1px solid var(--hairline)",
  background: "var(--surface)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: 20,
  textAlign: "center",
};

const emptyTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
};

const emptyTextStyle: React.CSSProperties = {
  maxWidth: 420,
  fontSize: 13,
  color: "var(--ink-soft)",
  lineHeight: 1.5,
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonBase,
  border: "none",
  background: "#3E7D74",
  color: "#fff",
};

const toastStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 28,
  left: "50%",
  transform: "translateX(-50%)",
  padding: "11px 18px",
  borderRadius: 12,
  background: "color-mix(in srgb, var(--ink) 88%, transparent)",
  color: "var(--bg)",
  fontSize: 13,
  fontWeight: 600,
  zIndex: 100,
  maxWidth: "min(90vw, 420px)",
  textAlign: "center",
};
