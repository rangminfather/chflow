"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────
// 폼 정의
// ─────────────────────────────────────────────────────────────────
const EMPTY_FORM = {
  date: "",
  issueNumber: "",      // 호수 (자동값 default + 수정 가능)

  // 1부 예배
  guide: "",
  praise1: "",
  praise2: "",
  leader: "",
  theme: "",            // 주제제창 (연도 표어에서 자동 채움, 수정 가능)
  prayerClass: "",
  scripture: "",
  sermonTitle: "",
  preacher: "",
  nextPrayer: "",

  tithe: "",
  thanksgiving: "",

  lessonNum: "",
  q1: "",
  q1c1: "",
  q1c2: "",
  q1c3: "",
  q1c4: "",
  q2: "",
  q2c1: "",
  q2c2: "",
  q2c3: "",
  q2c4: "",
  q3: "",
  q3c1: "",
  q3c2: "",
  q3c3: "",
  q3c4: "",

  // 광고 / 2부행사 (현재 23년 템플릿엔 치환 자리 없음 — 26년 양식 받으면 매핑 추가)
  announcement: "",      // 광고/공지
  twoPartActivity: "",   // 2부행사 안내

  newFriend: "",
};

type FormState = typeof EMPTY_FORM;

const SUPPORTED_DEPT = "초등1부";

interface YearlyTheme {
  theme: string;
  scripture_ref: string | null;
  updated_at: string;
}

interface DraftMeta {
  last_edited_by: string | null;
  last_edited_at: string;
}

// ─────────────────────────────────────────────────────────────────
// 호수 계산
// ─────────────────────────────────────────────────────────────────
function calcIssueNumber(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  if (d.getDay() !== 0) return "";
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const firstSun = new Date(jan1);
  while (firstSun.getDay() !== 0) firstSun.setDate(firstSun.getDate() + 1);
  const diffDays = Math.round((d.getTime() - firstSun.getTime()) / 86400000);
  const nn = Math.floor(diffDays / 7) + 1;
  const yy = year % 100;
  return `제${yy}-${nn}호`;
}

function nextSundayDate(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatKoreanDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return `${Math.floor(diffSec / 86400)}일 전`;
}

// ─────────────────────────────────────────────────────────────────
// hwpx 치환
// ─────────────────────────────────────────────────────────────────
function buildReplacements(form: FormState): Record<string, string> {
  return {
    "2023년 8월 20일": formatKoreanDate(form.date),
    "✿안내 :김찬규 선생님": `✿안내 : ${form.guide || "(미입력)"} 선생님`,
    "신예슬 최성현 선생님": `${form.praise1 || ""} ${form.praise2 || ""} 선생님`,
    "최성헌부장선생님": `${form.leader || "(미입력)"}부장선생님`,
    "복음 들고 GO! 땅끝까지 GOGO!": form.theme || "(주제 미입력)",
    "1-1반 어린이": `${form.prayerClass || "?"}반 어린이`,
    "데살로니가후서 2장 13~17절": form.scripture || "(성경본문 미입력)",
    "교회는 무엇을 지켜야 하나요?": form.sermonTitle || "(설교제목 미입력)",
    "김희숙전도사님": `${form.preacher || "?"}전도사님`,
    "✿다음 주 기도 : 3-4반": `✿다음 주 기도 : ${form.nextPrayer || "(미입력)"}`,
    "십일조 : ": `십일조 : ${form.tithe || ""}`,
    "감사헌금 : ": `감사헌금 : ${form.thanksgiving || ""}`,
    "25과 공과 퀴즈 ": `${form.lessonNum || "?"}과 공과 퀴즈 `,
    "1. 주의 날에 대한 설명으로 바른 것은 무엇인가요?": `1. ${form.q1 || "(문제 미입력)"}`,
    "   ① 때와 시기는 우리가 알지 못한다.  ": `   ① ${form.q1c1 || ""}  `,
    "   ② 열심히 계산하면 알 수 있다.  ": `   ② ${form.q1c2 || ""}  `,
    "   ③ 모르니까 준비하지 않아도 된다.  ": `   ③ ${form.q1c3 || ""}  `,
    "   ④ 주의 날이 오지 않을 수도 있다.": `   ④ ${form.q1c4 || ""}`,
    " 2. 예수님을 믿는 우리는 어떻게 살아가야 하나요?": ` 2. ${form.q2 || ""}`,
    // 퀴즈 2번 보기는 한 줄에 4개 ─ 23년 원본 그대로 형식 보존
    "   ① 어둠의 자녀 ② 빛의 자녀 ③ 사탄의 자녀 ④ 죄의 자녀":
      `   ① ${form.q2c1 || ""} ② ${form.q2c2 || ""} ③ ${form.q2c3 || ""} ④ ${form.q2c4 || ""}`,
    " 3. 깨어 있는 모습은 어떤 모습인가요?": ` 3. ${form.q3 || ""}`,
    "  ① 일찍 일어나는 모습": `  ① ${form.q3c1 || ""}`,
    "  ② 졸려도 꾹 참는 모습": `  ② ${form.q3c2 || ""}`,
    "  ③ 다시오실 예수님을 기다리는 모습": `  ③ ${form.q3c3 || ""}`,
    "  ④ 다시오실 예수님을 잊어버리는 모습": `  ④ ${form.q3c4 || ""}`,
    "   영 상": form.newFriend || "(미입력)",
  };
}

// ─────────────────────────────────────────────────────────────────
// 사진 처리 — 브라우저 Canvas 로 jpg 변환 + 리사이즈
// ─────────────────────────────────────────────────────────────────
async function fileToJpgBytes(file: File, maxLongSide = 1500, quality = 0.85): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    i.src = url;
  });
  const longSide = Math.max(img.width, img.height);
  const scale = longSide > maxLongSide ? maxLongSide / longSide : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => b ? res(b) : rej(new Error("jpg 변환 실패")), "image/jpeg", quality)
  );
  return new Uint8Array(await blob.arrayBuffer());
}

// 빈 슬롯용 흰색 plain jpg (사진 부족할 때 채워넣음)
let cachedWhiteJpg: Uint8Array | null = null;
async function getWhitePlaceholder(): Promise<Uint8Array> {
  if (cachedWhiteJpg) return cachedWhiteJpg;
  const canvas = document.createElement("canvas");
  canvas.width = 1500; canvas.height = 1000;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1500, 1000);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => b ? res(b) : rej(new Error("placeholder 생성 실패")), "image/jpeg", 0.6)
  );
  cachedWhiteJpg = new Uint8Array(await blob.arrayBuffer());
  return cachedWhiteJpg;
}

// ─────────────────────────────────────────────────────────────────
// hwpx 생성 — 텍스트 치환 + 사진 4슬롯 교체
// ─────────────────────────────────────────────────────────────────
async function generateHwpx(form: FormState, photos: Array<File | null>): Promise<Blob> {
  const JSZipMod = (await import("jszip")).default;
  const res = await fetch("/templates/elem1-bulletin-template.hwpx");
  if (!res.ok) throw new Error(`템플릿 로드 실패: ${res.status}`);
  const templateBuf = await res.arrayBuffer();

  const inZip = await JSZipMod.loadAsync(templateBuf);
  const sectionFile = inZip.file("Contents/section0.xml");
  if (!sectionFile) throw new Error("템플릿에 section0.xml 없음");

  let xml = await sectionFile.async("string");
  for (const [oldStr, newStr] of Object.entries(buildReplacements(form))) {
    xml = xml.split(`<hp:t>${oldStr}</hp:t>`).join(`<hp:t>${newStr}</hp:t>`);
  }

  // 사진 슬롯 4개 처리: image3.jpg ~ image6.jpg
  // photos[0] → image3, ..., photos[3] → image6
  // null 인 슬롯은 흰색 placeholder
  const photoBytes: Uint8Array[] = [];
  for (let i = 0; i < 4; i++) {
    const f = photos[i];
    if (f) {
      photoBytes.push(await fileToJpgBytes(f));
    } else {
      photoBytes.push(await getWhitePlaceholder());
    }
  }

  const outZip = new JSZipMod();
  const mimeFile = inZip.file("mimetype");
  if (mimeFile) {
    const mime = await mimeFile.async("uint8array");
    outZip.file("mimetype", mime, { compression: "STORE" });
  }
  for (const name of Object.keys(inZip.files)) {
    if (name === "mimetype") continue;
    const f = inZip.files[name];
    if (f.dir) continue;
    if (name === "Contents/section0.xml") {
      outZip.file(name, xml);
    } else if (name === "BinData/image3.jpg") {
      outZip.file(name, photoBytes[0]);
    } else if (name === "BinData/image4.jpg") {
      outZip.file(name, photoBytes[1]);
    } else if (name === "BinData/image5.jpg") {
      outZip.file(name, photoBytes[2]);
    } else if (name === "BinData/image6.jpg") {
      outZip.file(name, photoBytes[3]);
    } else {
      outZip.file(name, await f.async("uint8array"));
    }
  }
  return outZip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

// ─────────────────────────────────────────────────────────────────
// UMS 등록용 텍스트 빌더
// ─────────────────────────────────────────────────────────────────
function buildPostSubject(form: FormState): string {
  if (!form.date) return "초등1초원주보입니다";
  const [, m, d] = form.date.split("-");
  return `${parseInt(m, 10)}월${parseInt(d, 10)}일 초등1초원주보입니다`;
}

function buildPostMemo(form: FormState): string {
  const lines: string[] = [];
  lines.push(`초등1부 주보 (${form.date})`);
  if (form.issueNumber) lines.push(form.issueNumber);
  lines.push("");
  if (form.theme) lines.push(`주제 : ${form.theme}`);
  if (form.scripture) lines.push(`본문 : ${form.scripture}`);
  lines.push("");
  lines.push("─ 주일예배 순서 ─");
  if (form.guide) lines.push(`안내 : ${form.guide}`);
  if (form.praise1 || form.praise2) lines.push(`찬양 : ${[form.praise1, form.praise2].filter(Boolean).join(" ")}`);
  if (form.leader) lines.push(`예배인도 : ${form.leader} 부장`);
  if (form.prayerClass) lines.push(`기도 : ${form.prayerClass}반`);
  if (form.scripture) lines.push(`성경봉독 : ${form.scripture}`);
  if (form.sermonTitle) lines.push(`설교제목 : ${form.sermonTitle}`);
  if (form.preacher) lines.push(`강론자 : ${form.preacher} 전도사`);
  if (form.nextPrayer) lines.push(`다음 주 기도 : ${form.nextPrayer}`);
  lines.push("");
  if (form.tithe || form.thanksgiving) {
    lines.push("─ 헌금 ─");
    if (form.tithe) lines.push(`십일조 : ${form.tithe}`);
    if (form.thanksgiving) lines.push(`감사헌금 : ${form.thanksgiving}`);
    lines.push("");
  }
  if (form.twoPartActivity) {
    lines.push(`✿2부행사 : ${form.twoPartActivity}`);
  }
  if (form.announcement) {
    lines.push("");
    lines.push("─ 광고 ─");
    lines.push(form.announcement);
  }
  if (form.newFriend) {
    lines.push("");
    lines.push(`새 친구 : ${form.newFriend}`);
  }
  lines.push("");
  lines.push("(chflow 자동작성)");
  return lines.join("\n");
}

// UMS 사이트가 referer/세션 검증을 하므로, 글쓰기 페이지로 직접 가지 말고
// 게시판 리스트 → 글쓰기 자연 경로를 권장. 직접 링크는 fallback.
const UMS_BOARD_URL = "http://www.ums.or.kr/bbs/zboard.php?id=samusil&page=1";
const UMS_WRITE_URL = "http://www.ums.or.kr/bbs/write.php?id=samusil&page=1&category=2&mode=write";
const UMS_LOGIN_URL = "http://www.ums.or.kr/bbs/login.php?id=samusil";

// ─────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────
export default function WeeklyBulletinPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [form, setForm] = useState<FormState>(() => ({ ...EMPTY_FORM, date: nextSundayDate() }));
  const [toast, setToast] = useState("");
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const [yearlyTheme, setYearlyTheme] = useState<YearlyTheme | null>(null);
  const [themeEditMode, setThemeEditMode] = useState(false);
  const [themeForm, setThemeForm] = useState({ theme: "", scripture_ref: "" });
  const [themeSaving, setThemeSaving] = useState(false);

  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [draftList, setDraftList] = useState<Array<{
    issue_date: string;
    issue_number: string | null;
    last_edited_at: string;
  }>>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [photos, setPhotos] = useState<Array<File | null>>([null, null, null, null]);
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [umsLoginConfirmed, setUmsLoginConfirmed] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [autoPosting, setAutoPosting] = useState(false);
  const [autoPostResult, setAutoPostResult] = useState<
    | { ok: true; postNo: number; redirectUrl: string }
    | { ok: false; error: string }
    | null
  >(null);
  const [userscriptVersion, setUserscriptVersion] = useState<string | null>(null);
  const skipNextLoadRef = useRef(false);

  // 유저스크립트 설치 감지 (data-chflow-userscript 속성)
  useEffect(() => {
    const check = () => {
      const v = document.documentElement.getAttribute("data-chflow-userscript");
      setUserscriptVersion(v);
    };
    check();
    const t = setInterval(check, 1000);  // 페이지 로드 후 늦게 주입될 수도
    return () => clearInterval(t);
  }, []);

  // sessionStorage 로 로그인 확인 상태 유지 (탭 닫으면 풀림 — UMS 세션 만료 가능성 고려)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = sessionStorage.getItem("chflow:ums-login-confirmed");
    if (saved === "1") setUmsLoginConfirmed(true);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (umsLoginConfirmed) sessionStorage.setItem("chflow:ums-login-confirmed", "1");
    else sessionStorage.removeItem("chflow:ums-login-confirmed");
  }, [umsLoginConfirmed]);

  // 데스크톱 여부 감지 (>= 1024px)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 인증 + 부서 + 표어 + 첫 draft
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const { data: deptInfo } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
      if (deptInfo && deptInfo[0]) setDeptName(deptInfo[0].name || "");

      await loadYearlyTheme();
      await loadDraftsList();
      await loadDraft(form.date);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDraftsList() {
    const { data, error } = await supabase.rpc("bulletin_list_drafts", { p_dept_id: deptId });
    if (error) {
      console.warn("[bulletin] loadDraftsList error:", error);
      return;
    }
    setDraftList(data || []);
  }

  // 발행일자 변경 시 draft 다시 로드 (단, save 직후에는 skip)
  useEffect(() => {
    if (!authChecked) return;
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    loadDraft(form.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, authChecked]);

  async function loadYearlyTheme() {
    const year = new Date().getFullYear();
    const { data, error } = await supabase.rpc("bulletin_get_yearly_theme", {
      p_dept_id: deptId, p_year: year,
    });
    if (error) return;
    if (data && data[0]) {
      const t = data[0] as YearlyTheme;
      setYearlyTheme(t);
      setThemeForm({ theme: t.theme || "", scripture_ref: t.scripture_ref || "" });
      // 폼의 주제제창이 비어있으면 표어로 자동 채움
      setForm((f) => f.theme ? f : { ...f, theme: t.theme || "" });
    } else {
      setYearlyTheme(null);
    }
  }

  async function loadDraft(date: string) {
    if (!date) return;
    console.log("[bulletin] loadDraft called for", date);
    const { data, error } = await supabase.rpc("bulletin_get_draft", {
      p_dept_id: deptId, p_issue_date: date,
    });
    if (error) {
      console.error("[bulletin] loadDraft error:", error);
      showToast("Draft 조회 실패: " + error.message);
      return;
    }
    console.log("[bulletin] loadDraft response:", data);
    const row = data && data[0];
    if (row && row.exists_) {
      const draft = row.form_data as Partial<FormState>;
      console.log("[bulletin] draft loaded with fields:", Object.keys(draft).length);
      setForm({
        ...EMPTY_FORM,
        date,
        issueNumber: row.issue_number || calcIssueNumber(date),
        ...draft,
      });
      setDraftMeta({ last_edited_by: row.last_edited_by, last_edited_at: row.last_edited_at });
      showToast(`💾 임시저장본 불러옴 (${formatRelativeTime(row.last_edited_at)})`);
      if (yearlyTheme && !draft.theme) {
        setForm((f) => ({ ...f, theme: yearlyTheme.theme }));
      }
    } else {
      console.log("[bulletin] no draft for", date);
      setForm((f) => ({
        ...EMPTY_FORM,
        date,
        issueNumber: calcIssueNumber(date),
        theme: yearlyTheme?.theme || "",
      }));
      setDraftMeta(null);
    }
  }

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2800);
  };

  const handleDateChange = (newDate: string) => {
    setForm((f) => ({ ...f, date: newDate, issueNumber: calcIssueNumber(newDate) }));
    // useEffect 가 loadDraft 트리거함
  };

  const handleSaveDraft = async () => {
    if (!form.date) {
      showToast("날짜를 먼저 선택하세요");
      return;
    }
    setSavingDraft(true);
    try {
      const { data, error } = await supabase.rpc("bulletin_save_draft", {
        p_dept_id: deptId,
        p_issue_date: form.date,
        p_form_data: form,
        p_issue_number: form.issueNumber || null,
      });
      if (error) throw error;
      const meta = data && data[0];
      if (meta) {
        setDraftMeta({ last_edited_at: meta.last_edited_at, last_edited_by: meta.last_edited_by });
      }
      skipNextLoadRef.current = true;
      showToast("임시저장 완료 ✅");
      await loadDraftsList();
    } catch (e: unknown) {
      showToast("저장 실패: " + (e as Error).message);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSaveYearlyTheme = async () => {
    if (!themeForm.theme.trim()) {
      showToast("표어를 입력하세요");
      return;
    }
    setThemeSaving(true);
    try {
      const year = new Date().getFullYear();
      const { error } = await supabase.rpc("bulletin_set_yearly_theme", {
        p_dept_id: deptId,
        p_year: year,
        p_theme: themeForm.theme.trim(),
        p_scripture_ref: themeForm.scripture_ref.trim() || null,
      });
      if (error) throw error;
      showToast(`${year}년 표어 저장 완료 ✅`);
      await loadYearlyTheme();
      setThemeEditMode(false);
      // 폼 주제제창도 새 표어로 갱신 (단 사용자가 다른 값 입력했을 수 있어 덮어쓰진 않음)
      if (!form.theme) setForm((f) => ({ ...f, theme: themeForm.theme.trim() }));
    } catch (e: unknown) {
      showToast("표어 저장 실패: " + (e as Error).message);
    } finally {
      setThemeSaving(false);
    }
  };

  const handleDeleteDraft = async (issueDate: string) => {
    const confirmed = confirm(
      `${issueDate} 임시저장본을 삭제하시겠습니까?\n\n⚠️ 삭제하면 복구할 수 없습니다.\n작성한 모든 내용이 사라집니다.`
    );
    if (!confirmed) return;
    try {
      const { error } = await supabase.rpc("bulletin_delete_draft", {
        p_dept_id: deptId, p_issue_date: issueDate,
      });
      if (error) throw error;
      showToast(`${issueDate} 임시저장본 삭제됨`);
      await loadDraftsList();
      // 현재 보고있던 draft 가 삭제됐으면 폼 초기화
      if (form.date === issueDate) {
        setForm({ ...EMPTY_FORM, date: form.date, issueNumber: calcIssueNumber(form.date), theme: yearlyTheme?.theme || "" });
        setDraftMeta(null);
      }
    } catch (e: unknown) {
      showToast("삭제 실패: " + (e as Error).message);
    }
  };

  const setPhoto = (idx: number, file: File | null) => {
    setPhotos((prev) => {
      const next = [...prev];
      next[idx] = file;
      return next;
    });
  };

  const compactPhotos = () => {
    // 빈 슬롯 제거하고 앞으로 채움 (사용자가 1, 3번에 올렸으면 1, 2번으로)
    const filled = photos.filter((p) => p !== null) as File[];
    while (filled.length < 4) filled.push(null as unknown as File);
    setPhotos(filled);
  };

  const handleCopyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} 복사됨`);
    } catch {
      showToast("복사 실패 — 브라우저가 클립보드 권한 차단했을 수 있음");
    }
  };

  const handleOpenUmsTab = (target: "write" | "board" | "login") => {
    const url = target === "login" ? UMS_LOGIN_URL : target === "board" ? UMS_BOARD_URL : UMS_WRITE_URL;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // 🚀 1클릭 자동등록 (Tampermonkey 유저스크립트 호출)
  const handleAutoPost = async () => {
    if (!userscriptVersion) {
      showToast("유저스크립트가 설치되지 않음. 설치 후 새로고침하세요");
      return;
    }
    if (!pdfFile) {
      showToast("PDF 파일을 먼저 첨부하세요");
      return;
    }
    if (!form.theme && !form.scripture) {
      showToast("주제와 본문을 채우세요");
      return;
    }

    setAutoPosting(true);
    setAutoPostResult(null);

    // PDF → base64
    const pdfBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("PDF 읽기 실패"));
      reader.readAsDataURL(pdfFile);
    });

    const subject = buildPostSubject(form);
    const memo = buildPostMemo(form);

    const requestId = Math.random().toString(36).slice(2);

    const onResponse = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      document.removeEventListener(`chflow:ums-post-response-${requestId}`, onResponse);
      setAutoPosting(false);
      if (detail.ok) {
        setAutoPostResult({ ok: true, postNo: detail.postNo, redirectUrl: detail.redirectUrl });
      } else {
        setAutoPostResult({ ok: false, error: detail.error || "알 수 없는 오류" });
      }
    };
    document.addEventListener(`chflow:ums-post-response-${requestId}`, onResponse);

    document.dispatchEvent(new CustomEvent("chflow:ums-post-request", {
      detail: {
        requestId,
        payload: {
          subject,
          memo,
          pdfBase64,
          pdfFilename: pdfFile.name || `초등1초원주보_${form.date}.pdf`,
        },
      },
    }));

    // 60초 타임아웃
    setTimeout(() => {
      document.removeEventListener(`chflow:ums-post-response-${requestId}`, onResponse);
      if (autoPosting) {
        setAutoPosting(false);
        setAutoPostResult({ ok: false, error: "60초 타임아웃 — 유저스크립트가 응답 없음" });
      }
    }, 60000);
  };

  // 1️⃣ 로그인 팝업 열고, 닫히면 자동으로 로그인 완료로 간주
  const handleOpenLoginPopup = () => {
    const w = 720, h = 640;
    const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
    const popup = window.open(
      UMS_LOGIN_URL,
      "umsLoginPopup",
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!popup) {
      showToast("팝업이 차단됐어요. 브라우저 설정에서 팝업 허용 후 다시 시도해주세요");
      return;
    }
    showToast("팝업에서 로그인 후 창을 닫으면 다음 단계가 활성화됩니다");
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        setUmsLoginConfirmed(true);
        showToast("로그인 완료로 인식됐습니다 ✅");
      }
    }, 500);
  };

  const handleDownloadHwpx = async () => {
    if (!form.date) {
      showToast("날짜를 선택해주세요");
      return;
    }
    setGenerating(true);
    try {
      const blob = await generateHwpx(form, photos);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `초등1초원주보_${form.date}.hwpx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast("hwpx 다운로드 완료 ✅");
    } catch (e: unknown) {
      showToast("생성 실패: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  const isSupported = deptName === SUPPORTED_DEPT;
  const currentYear = new Date().getFullYear();

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap" rel="stylesheet" />

      <div style={headerStyle}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📰 주보 만들기</div>
        <div style={{ display: "flex", gap: 6 }}>
          {!isDesktop && (
            <button onClick={() => setDrawerOpen(true)} style={iconBtnStyle} title="임시저장 목록">
              📂{draftList.length > 0 && <span style={{ fontSize: 11, marginLeft: 3 }}>{draftList.length}</span>}
            </button>
          )}
          <button onClick={handleSaveDraft} disabled={savingDraft} style={draftBtnStyle}>
            {savingDraft ? "저장 중..." : "💾"}
          </button>
        </div>
      </div>

      <div style={{
        display: "flex",
        gap: 20,
        maxWidth: isDesktop ? 1080 : 720,
        margin: "0 auto",
        padding: 16,
        alignItems: "flex-start",
      }}>
        <div style={{ flex: 1, maxWidth: 720, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {!isSupported && (
          <div style={warnCardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>현재 {SUPPORTED_DEPT}만 지원합니다</div>
          </div>
        )}

        {/* 직전 저장 정보 (현재 발행일자 기준) */}
        {draftMeta && (
          <div style={{ ...cardStyle, padding: "10px 16px", background: "#ecfeff", border: "1px solid #67e8f9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#0369a1", fontWeight: 700 }}>
                💾 이 발행일자에 임시저장본 있음 — <b>{formatRelativeTime(draftMeta.last_edited_at)}</b> 저장
              </div>
              <div style={{ fontSize: 11, color: "#0e7490" }}>
                {new Date(draftMeta.last_edited_at).toLocaleString("ko-KR")}
              </div>
            </div>
          </div>
        )}

        {/* ① 기본 정보 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>① 기본 정보</div>
          <FormRow label="발행 일자 (주일)">
            <input
              type="date"
              value={form.date}
              onChange={(e) => handleDateChange(e.target.value)}
              style={inputStyle}
            />
            <div style={hintStyle}>일요일을 선택하세요</div>
          </FormRow>
          <FormRow label="호수">
            <input
              type="text"
              value={form.issueNumber}
              onChange={(e) => set("issueNumber", e.target.value)}
              placeholder={calcIssueNumber(form.date) || "예: 제26-18호"}
              style={inputStyle}
            />
            <div style={hintStyle}>
              자동 계산값: <b>{calcIssueNumber(form.date) || "(일요일 선택 시 자동)"}</b> — 다르게 표기하려면 직접 수정
            </div>
          </FormRow>
        </div>

        {/* ② 올해 표어 */}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ ...sectionLabel, marginBottom: 0 }}>② {currentYear}년 표어 (주제제창)</div>
            {!themeEditMode && (
              <button onClick={() => setThemeEditMode(true)} style={smallBtnStyle}>✏️ 수정</button>
            )}
          </div>
          {!themeEditMode ? (
            yearlyTheme ? (
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>
                  {yearlyTheme.theme}
                </div>
                {yearlyTheme.scripture_ref && (
                  <div style={{ fontSize: 12, color: "#64748b" }}>{yearlyTheme.scripture_ref}</div>
                )}
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                  매 주보 작성 시 주제제창 자동 채움
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#64748b" }}>
                {currentYear}년 표어가 등록되지 않았습니다.
                <button onClick={() => setThemeEditMode(true)} style={{ ...smallBtnStyle, marginLeft: 8 }}>+ 등록하기</button>
              </div>
            )
          ) : (
            <div>
              <FormRow label="표어">
                <input
                  type="text"
                  value={themeForm.theme}
                  onChange={(e) => setThemeForm((t) => ({ ...t, theme: e.target.value }))}
                  placeholder="예: 하나님의 안경으로 세상을 바라보는 어린이"
                  style={inputStyle}
                />
              </FormRow>
              <FormRow label="근거 구절 (선택)">
                <input
                  type="text"
                  value={themeForm.scripture_ref}
                  onChange={(e) => setThemeForm((t) => ({ ...t, scripture_ref: e.target.value }))}
                  placeholder="예: 히 11:3"
                  style={inputStyle}
                />
              </FormRow>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => { setThemeEditMode(false); setThemeForm({ theme: yearlyTheme?.theme || "", scripture_ref: yearlyTheme?.scripture_ref || "" }); }} style={cancelBtnStyle}>취소</button>
                <button onClick={handleSaveYearlyTheme} disabled={themeSaving} style={primaryBtnStyle}>
                  {themeSaving ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ③ 1부 예배 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>③ 1부 예배 (인명 / 멘트)</div>

          <FormRow label="안내">
            <input type="text" value={form.guide} onChange={(e) => set("guide", e.target.value)} placeholder="예: 박희연" style={inputStyle} />
          </FormRow>
          <FormRow label="찬양 (2명)">
            <div style={{ display: "flex", gap: 8 }}>
              <input type="text" value={form.praise1} onChange={(e) => set("praise1", e.target.value)} placeholder="이름1" style={inputStyle} />
              <input type="text" value={form.praise2} onChange={(e) => set("praise2", e.target.value)} placeholder="이름2" style={inputStyle} />
            </div>
          </FormRow>
          <FormRow label="예배인도 (부장)">
            <input type="text" value={form.leader} onChange={(e) => set("leader", e.target.value)} placeholder="예: 최성헌" style={inputStyle} />
          </FormRow>
          <FormRow label="주제제창 (이번 주 사용 멘트)">
            <input type="text" value={form.theme} onChange={(e) => set("theme", e.target.value)} placeholder="기본은 올해 표어" style={inputStyle} />
            <div style={hintStyle}>비우고 저장 시 올해 표어 그대로 사용</div>
          </FormRow>
          <FormRow label="기도 (반)">
            <input type="text" value={form.prayerClass} onChange={(e) => set("prayerClass", e.target.value)} placeholder="예: 2-3" style={inputStyle} />
          </FormRow>
          <FormRow label="성경봉독">
            <input type="text" value={form.scripture} onChange={(e) => set("scripture", e.target.value)} placeholder="예: 창세기 11장 1~9절" style={inputStyle} />
          </FormRow>
          <FormRow label="강론 제목">
            <input type="text" value={form.sermonTitle} onChange={(e) => set("sermonTitle", e.target.value)} placeholder="예: 우리는 배울 때 무엇을 조심해야 할까요?" style={inputStyle} />
          </FormRow>
          <FormRow label="강론자">
            <input type="text" value={form.preacher} onChange={(e) => set("preacher", e.target.value)} placeholder="예: 김희숙" style={inputStyle} />
          </FormRow>
          <FormRow label="다음 주 기도">
            <input type="text" value={form.nextPrayer} onChange={(e) => set("nextPrayer", e.target.value)} placeholder="예: 3-4반 또는 김정권장로님" style={inputStyle} />
          </FormRow>
        </div>

        {/* ④ 헌금 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>④ 헌금</div>
          <FormRow label="십일조">
            <input type="text" value={form.tithe} onChange={(e) => set("tithe", e.target.value)} placeholder="예: 50,000원" style={inputStyle} />
          </FormRow>
          <FormRow label="감사헌금">
            <input type="text" value={form.thanksgiving} onChange={(e) => set("thanksgiving", e.target.value)} placeholder="예: 30,000원" style={inputStyle} />
          </FormRow>
        </div>

        {/* ⑤ 공과 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>⑤ 공과 / 퀴즈</div>
          <FormRow label="공과 회차">
            <input type="text" value={form.lessonNum} onChange={(e) => set("lessonNum", e.target.value)} placeholder="예: 14" style={inputStyle} />
          </FormRow>
          <FormRow label="퀴즈 1번 — 문제">
            <textarea value={form.q1} onChange={(e) => set("q1", e.target.value)} placeholder="예: 사람들은 왜 바벨탑을 쌓으려고 했나요?" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </FormRow>
          <FormRow label="① 보기">
            <input type="text" value={form.q1c1} onChange={(e) => set("q1c1", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="② 보기">
            <input type="text" value={form.q1c2} onChange={(e) => set("q1c2", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="③ 보기">
            <input type="text" value={form.q1c3} onChange={(e) => set("q1c3", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="④ 보기">
            <input type="text" value={form.q1c4} onChange={(e) => set("q1c4", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="퀴즈 2번 — 문제">
            <textarea value={form.q2} onChange={(e) => set("q2", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </FormRow>
          <FormRow label="퀴즈 2번 보기 (한 줄에 4개)">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <input type="text" value={form.q2c1} onChange={(e) => set("q2c1", e.target.value)} placeholder="① 보기" style={inputStyle} />
              <input type="text" value={form.q2c2} onChange={(e) => set("q2c2", e.target.value)} placeholder="② 보기" style={inputStyle} />
              <input type="text" value={form.q2c3} onChange={(e) => set("q2c3", e.target.value)} placeholder="③ 보기" style={inputStyle} />
              <input type="text" value={form.q2c4} onChange={(e) => set("q2c4", e.target.value)} placeholder="④ 보기" style={inputStyle} />
            </div>
            <div style={hintStyle}>한 줄에 ① ② ③ ④ 가 가로로 배치됩니다 (23년 양식 그대로)</div>
          </FormRow>

          <FormRow label="퀴즈 3번 — 문제 (선택)">
            <textarea value={form.q3} onChange={(e) => set("q3", e.target.value)} placeholder="비우면 23년 템플릿의 기본 문제 그대로 남음" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </FormRow>
          <FormRow label="① 보기">
            <input type="text" value={form.q3c1} onChange={(e) => set("q3c1", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="② 보기">
            <input type="text" value={form.q3c2} onChange={(e) => set("q3c2", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="③ 보기">
            <input type="text" value={form.q3c3} onChange={(e) => set("q3c3", e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label="④ 보기">
            <input type="text" value={form.q3c4} onChange={(e) => set("q3c4", e.target.value)} style={inputStyle} />
          </FormRow>
        </div>

        {/* 광고 / 2부행사 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>⑥ 광고 / 2부행사</div>
          <FormRow label="2부 행사 안내">
            <input type="text" value={form.twoPartActivity} onChange={(e) => set("twoPartActivity", e.target.value)} placeholder="예: 14과 공과공부, 찬양연습" style={inputStyle} />
          </FormRow>
          <FormRow label="광고 / 공지">
            <textarea
              value={form.announcement}
              onChange={(e) => set("announcement", e.target.value)}
              placeholder={"한 줄에 하나씩 입력하세요.\n예:\n- 다음 주 부활절 분반활동\n- 5/3 야외예배 안내"}
              rows={5}
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
            />
          </FormRow>
          <div style={{ ...hintStyle, marginTop: 4, color: "#b45309" }}>
            ⓘ 23년 hwpx 양식엔 광고/2부행사 자리가 없어 현재 hwpx 출력엔 반영되지 않습니다. 26년 양식 받으면 자리 매핑 추가 예정.
          </div>
        </div>

        {/* ⑦ 새 친구 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>⑦ 새 친구</div>
          <FormRow label="이름">
            <input type="text" value={form.newFriend} onChange={(e) => set("newFriend", e.target.value)} placeholder="예: 차난(1학년)-자진" style={inputStyle} />
          </FormRow>
        </div>

        {/* ⑧ 사진 (1~4장) */}
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ ...sectionLabel, marginBottom: 0 }}>⑧ 사진 (최대 4장)</div>
            {photos.some((p) => p !== null) && (
              <button onClick={compactPhotos} style={smallBtnStyle}>빈칸 정리</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
            슬롯 4개 — 빈칸은 흰색으로 채워짐. (1·2·3장 전용 레이아웃은 추후 추가 예정)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <PhotoSlot
                key={i}
                index={i}
                file={photos[i]}
                onChange={(f) => setPhoto(i, f)}
              />
            ))}
          </div>
        </div>

        {/* ⑨ PDF 첨부 (자동등록용) */}
        <div style={cardStyle}>
          <div style={sectionLabel}>⑨ PDF 첨부 (자동등록용)</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 10 }}>
            한글에서 PDF로 저장한 파일을 여기에 첨부하면 1클릭 자동등록 가능
          </div>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            style={{ ...inputStyle, padding: 8 }}
          />
          {pdfFile && (
            <div style={{ fontSize: 11, color: "#15803d", marginTop: 6 }}>
              ✅ {pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)
            </div>
          )}
        </div>

        {/* ⑩ 액션 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>⑩ 주보 생성 / 등록</div>

          {!userscriptVersion ? (
            <div style={{ background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 12, color: "#9a3412", lineHeight: 1.6 }}>
              <b>🚀 1클릭 자동등록 활성화하려면</b> Tampermonkey + 우리 유저스크립트 설치 (1회):<br />
              1. Chrome 웹스토어에서 <b>Tampermonkey</b> 확장프로그램 설치<br />
              2. <a href="/userscripts/chflow-ums-auto.user.js" target="_blank" style={{ color: "#6366f1", fontWeight: 700 }}>유저스크립트 설치 링크 클릭</a><br />
              3. Tampermonkey 가 설치 페이지 띄우면 "설치" 클릭 → 이 페이지 새로고침<br />
              <br />
              아래 "📤 등록(클립보드 모드)" 는 유저스크립트 없이도 사용 가능
            </div>
          ) : (
            <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12, color: "#15803d" }}>
              ✅ 유저스크립트 v{userscriptVersion} 활성화됨 — 1클릭 등록 가능
            </div>
          )}

          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 12 }}>
            <b>흐름</b>: 폼 채움 → hwpx 다운 → 한글에서 PDF 저장 → ⑨에 첨부 → 🚀 1클릭 등록
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={handleSaveDraft} disabled={savingDraft} style={resetBtnStyle}>
              {savingDraft ? "저장 중..." : "💾 임시저장"}
            </button>
            <button onClick={handleDownloadHwpx} disabled={generating} style={resetBtnStyle}>
              {generating ? "생성 중..." : "📥 hwpx 다운로드"}
            </button>
            <button onClick={() => setPostModalOpen(true)} style={resetBtnStyle}>
              📤 등록 (클립보드 모드)
            </button>
            {userscriptVersion && (
              <button
                onClick={handleAutoPost}
                disabled={autoPosting || !pdfFile}
                style={{
                  ...primaryBtnStyle,
                  background: !pdfFile ? "#e2e8f0" : "linear-gradient(135deg, #ec4899, #8b5cf6)",
                  color: !pdfFile ? "#94a3b8" : "#fff",
                  cursor: !pdfFile ? "not-allowed" : "pointer",
                }}
              >
                {autoPosting ? "등록 중..." : "🚀 1클릭 자동등록"}
              </button>
            )}
          </div>
        </div>
        </div>
        {/* ─── 데스크톱: 우측 sticky 사이드바 ─── */}
        {isDesktop && (
          <DraftSidebar
            draftList={draftList}
            currentDate={form.date}
            onSelect={(d) => handleDateChange(d)}
            onDelete={handleDeleteDraft}
          />
        )}
      </div>

      {/* ─── 자동등록 진행/결과 모달 ─── */}
      {(autoPosting || autoPostResult) && (
        <div style={modalBackdropStyle}>
          <div style={{ ...postModalCardStyle, maxWidth: 420 }}>
            {autoPosting && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8, textAlign: "center" }}>🚀</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b", marginBottom: 6, textAlign: "center" }}>
                  UMS에 자동 등록 중...
                </div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, textAlign: "center" }}>
                  4단계 (write 폼 → PDF 업로드 → 글 등록)<br />
                  너 PC에서 너 IP로 진행 중.
                </div>
              </>
            )}
            {autoPostResult && autoPostResult.ok && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8, textAlign: "center" }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#15803d", marginBottom: 6, textAlign: "center" }}>
                  등록 완료!
                </div>
                <div style={{ fontSize: 13, color: "#1e293b", marginBottom: 14, textAlign: "center" }}>
                  글번호 #{autoPostResult.postNo}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <a
                    href={`http://www.ums.or.kr/bbs/zboard.php?id=samusil&no=${autoPostResult.postNo}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ ...resetBtnStyle, textDecoration: "none" }}
                  >
                    UMS에서 확인
                  </a>
                  <button onClick={() => setAutoPostResult(null)} style={primaryBtnStyle}>확인</button>
                </div>
              </>
            )}
            {autoPostResult && !autoPostResult.ok && (
              <>
                <div style={{ fontSize: 32, marginBottom: 8, textAlign: "center" }}>⚠️</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#b91c1c", marginBottom: 6, textAlign: "center" }}>
                  자동등록 실패
                </div>
                <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 14, wordBreak: "break-word" }}>
                  {autoPostResult.error}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={() => setAutoPostResult(null)} style={primaryBtnStyle}>닫기</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── 등록 도우미 모달 ─── */}
      {postModalOpen && (() => {
        const subject = buildPostSubject(form);
        const memo = buildPostMemo(form);
        return (
          <div style={modalBackdropStyle} onClick={() => setPostModalOpen(false)}>
            <div style={postModalCardStyle} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#1e293b" }}>📤 UMS 등록 도우미</div>
                <button onClick={() => setPostModalOpen(false)} style={iconBtnStyle}>✕</button>
              </div>

              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 12, background: "#f8fafc", padding: 10, borderRadius: 8 }}>
                <b>📋 순서</b>:<br />
                <b style={{ color: umsLoginConfirmed ? "#94a3b8" : "#1e293b" }}>1️⃣ 홈페이지 로그인</b> → 팝업 창에서 로그인 후 <b>창 닫기</b><br />
                <b style={{ color: umsLoginConfirmed ? "#15803d" : "#1e293b" }}>2️⃣ {umsLoginConfirmed ? "✅ 로그인 확인됨" : "로그인 완료 (수동 확인)"}</b><br />
                <b style={{ color: umsLoginConfirmed ? "#1e293b" : "#94a3b8" }}>3️⃣ 게시판 열기 → 우측 "글쓰기" 버튼 클릭</b><br />
                <span style={{ color: "#b45309", fontSize: 11 }}>
                  ⓘ <b>왜 게시판 거쳐야 하나요?</b> chflow(HTTPS) → UMS(HTTP) 직접 이동 시 브라우저가 Referer 를 자동 삭제해서 UMS 가 글쓰기 직접 접근을 차단함. 게시판에서 자연스럽게 "글쓰기" 클릭하면 정상 작동.
                </span>
              </div>

              {/* 제목 */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>제목</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text" value={subject} readOnly
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    style={{ ...inputStyle, background: "#f8fafc" }}
                  />
                  <button onClick={() => handleCopyToClipboard(subject, "제목")} style={{ ...primaryBtnStyle, padding: "9px 14px", fontSize: 12 }}>
                    복사
                  </button>
                </div>
              </div>

              {/* 본문 */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>본문</div>
                <textarea
                  value={memo} readOnly
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  rows={8}
                  style={{ ...inputStyle, background: "#f8fafc", resize: "vertical", lineHeight: 1.5, fontSize: 12 }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                  <button onClick={() => handleCopyToClipboard(memo, "본문")} style={{ ...primaryBtnStyle, padding: "8px 16px", fontSize: 12 }}>
                    본문 복사
                  </button>
                </div>
              </div>

              {/* 3-step buttons */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                <button onClick={handleOpenLoginPopup} style={{ ...resetBtnStyle, padding: "11px 14px", textAlign: "left" }}>
                  🔑 1️⃣ 홈페이지 로그인 (팝업)
                </button>

                <button
                  onClick={() => setUmsLoginConfirmed(!umsLoginConfirmed)}
                  style={{
                    padding: "11px 14px", textAlign: "left",
                    background: umsLoginConfirmed ? "#dcfce7" : "#f1f5f9",
                    color: umsLoginConfirmed ? "#15803d" : "#475569",
                    border: `1.5px solid ${umsLoginConfirmed ? "#86efac" : "#e2e8f0"}`,
                    borderRadius: 10, fontSize: 13, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {umsLoginConfirmed ? "✅ 2️⃣ 로그인 확인됨 (다시 클릭하면 해제)" : "2️⃣ 로그인 완료 (수동 확인)"}
                </button>

                <button
                  onClick={() => handleOpenUmsTab("board")}
                  disabled={!umsLoginConfirmed}
                  style={{
                    padding: "11px 14px", textAlign: "left",
                    background: umsLoginConfirmed ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "#e2e8f0",
                    color: umsLoginConfirmed ? "#fff" : "#94a3b8",
                    border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800,
                    cursor: umsLoginConfirmed ? "pointer" : "not-allowed",
                    fontFamily: "inherit",
                  }}
                >
                  3️⃣ 게시판 열기 → (UMS 에서 "글쓰기" 클릭)
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                <button onClick={() => handleOpenUmsTab("write")} style={{ ...smallBtnStyle, padding: "6px 10px" }} title="대부분 차단됨 — 시험용">
                  ⚠️ 글쓰기 직접 (실패 가능)
                </button>
                <button onClick={() => setPostModalOpen(false)} style={resetBtnStyle}>닫기</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── 모바일: 우측 drawer ─── */}
      {!isDesktop && drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 998 }}
          />
          <div style={{
            position: "fixed", top: 0, right: 0, height: "100vh", width: "min(320px, 85vw)",
            background: "#fff", zIndex: 999, padding: 16, overflowY: "auto",
            boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>📂 임시저장 목록</div>
              <button onClick={() => setDrawerOpen(false)} style={iconBtnStyle}>✕</button>
            </div>
            <DraftSidebar
              draftList={draftList}
              currentDate={form.date}
              onSelect={(d) => { handleDateChange(d); setDrawerOpen(false); }}
              onDelete={handleDeleteDraft}
              embedded
            />
          </div>
        </>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  );
}

function PhotoSlot({ index, file, onChange }: {
  index: number; file: File | null; onChange: (f: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    onChange(f);
    e.target.value = "";  // 같은 파일 다시 선택 가능하게
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) onChange(f);
  };

  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{
        position: "relative",
        aspectRatio: "3/2",
        borderRadius: 10,
        border: file ? "1.5px solid #6366f1" : "1.5px dashed #cbd5e1",
        background: file ? "#000" : "#f8fafc",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <input type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} />
      {preview ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={`슬롯 ${index + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onChange(null); }}
            style={{
              position: "absolute", top: 6, right: 6,
              padding: "3px 8px", background: "rgba(0,0,0,0.55)", color: "#fff",
              border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700,
              cursor: "pointer",
            }}
          >✕</button>
        </>
      ) : (
        <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          <div style={{ fontSize: 22, marginBottom: 4 }}>📷</div>
          <div>슬롯 {index + 1}</div>
          <div style={{ fontSize: 10, marginTop: 2 }}>탭/드래그</div>
        </div>
      )}
    </label>
  );
}

function DraftSidebar({
  draftList, currentDate, onSelect, onDelete, embedded,
}: {
  draftList: Array<{ issue_date: string; issue_number: string | null; last_edited_at: string }>;
  currentDate: string;
  onSelect: (date: string) => void;
  onDelete: (date: string) => void;
  embedded?: boolean;
}) {
  const wrapperStyle: React.CSSProperties = embedded
    ? {}
    : {
        width: 280, position: "sticky", top: 16, alignSelf: "flex-start",
        maxHeight: "calc(100vh - 32px)", overflowY: "auto",
        background: "#fff", borderRadius: 14, padding: 16,
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)", flexShrink: 0,
      };

  return (
    <div style={wrapperStyle}>
      {!embedded && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, marginBottom: 12 }}>
          📂 임시저장 목록 ({draftList.length}건)
        </div>
      )}
      {draftList.length === 0 ? (
        <div style={{ fontSize: 12, color: "#94a3b8", padding: 12, textAlign: "center" }}>
          저장된 임시본 없음
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {draftList.map((d) => {
            const isCurrent = d.issue_date === currentDate;
            return (
              <div
                key={d.issue_date}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: isCurrent ? "1.5px solid #6366f1" : "1px solid #e2e8f0",
                  background: isCurrent ? "#eef2ff" : "#fff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <div
                  onClick={() => !isCurrent && onSelect(d.issue_date)}
                  style={{ flex: 1, minWidth: 0, cursor: isCurrent ? "default" : "pointer" }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                    {d.issue_date}
                    {d.issue_number && <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>{d.issue_number}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                    {isCurrent && <span style={{ color: "#6366f1", marginRight: 6 }}>● 작성 중</span>}
                    {formatRelativeTime(d.last_edited_at)}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(d.issue_date); }}
                  title="삭제"
                  style={{
                    padding: "6px 8px", background: "#fef2f2", color: "#b91c1c",
                    border: "1px solid #fecaca", borderRadius: 6, fontSize: 11,
                    cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f1f5f9",
  fontFamily: "'Noto Sans KR', sans-serif",
};
const containerStyle: React.CSSProperties = {
  maxWidth: 720, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 14,
};
const headerStyle: React.CSSProperties = {
  background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 16px",
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
};
const cardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
};
const warnCardStyle: React.CSSProperties = {
  background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: 14, padding: 14, color: "#9a3412",
};
const sectionLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 0.5, marginBottom: 12,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", border: "1.5px solid #e2e8f0", borderRadius: 8,
  fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const hintStyle: React.CSSProperties = {
  fontSize: 11, color: "#94a3b8", marginTop: 4,
};
const backBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8,
  fontSize: 12, color: "#475569", cursor: "pointer", fontFamily: "inherit",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 22px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800,
  cursor: "pointer", fontFamily: "inherit",
};
const draftBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#ecfeff", color: "#0369a1",
  border: "1.5px solid #67e8f9", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const iconBtnStyle: React.CSSProperties = {
  padding: "8px 12px", background: "#f1f5f9", color: "#475569",
  border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center",
};
const modalBackdropStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 16, zIndex: 1000,
};
const postModalCardStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 14, padding: 20,
  width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};
const resetBtnStyle: React.CSSProperties = {
  padding: "10px 18px", background: "#f1f5f9", color: "#475569",
  border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const cancelBtnStyle: React.CSSProperties = {
  padding: "8px 14px", background: "#f1f5f9", color: "#475569",
  border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const smallBtnStyle: React.CSSProperties = {
  padding: "5px 12px", background: "#eef2ff", color: "#4f46e5",
  border: "1px solid #c7d2fe", borderRadius: 6, fontSize: 11, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit",
};
const toastStyle: React.CSSProperties = {
  position: "fixed", bottom: 40, left: "50%", transform: "translateX(-50%)",
  background: "rgba(15,23,42,0.88)", color: "#fff", padding: "12px 24px",
  borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 999,
  fontFamily: "inherit", whiteSpace: "nowrap", maxWidth: "90vw", textAlign: "center",
};
const loadingStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif",
};
