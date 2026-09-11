"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BookOpen, ChevronLeft, ChevronRight, Copy, RefreshCw, RotateCcw } from "lucide-react";
import HeaderLogo from "@/components/HeaderLogo";
import BibleAttribution from "@/components/BibleAttribution";
import { LoadingView } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";
import { DEFAULT_BIBLE_VERSION, parseBibleVersions, type BibleVersion } from "@/lib/bible/versions";
import { fromPublicRow } from "@/lib/copyright";
import {
  type BibleVerse,
  buildWorshipLeaderSections,
  isFirstSunday,
  normalizeBibleReference,
  normalizeClassToken,
  parseGuideMessage,
  withoutWorshipLeaderSectionEdit,
  worshipLeaderScriptText,
} from "@/lib/worshipLeaderScript";
import {
  type DeptBulletinFields,
  normText,
  parseDeptBulletinFields,
} from "@/lib/bulletin/dept-bulletin-fields";
import { correctNamesIn } from "@/lib/bulletin/name-correction";

type ClassRow = { class_no: string };
type GuideFields = { prayerClass?: string; prayerNext?: string; prayerFixed?: boolean };
type GuideRecord = { fields?: GuideFields } | null;
type PlanFields = { prayerClass?: string; scripture?: string; sermonTitle?: string; preacher?: string };
type PlanInfo = { fields: PlanFields; sourceFile: string; sheetName: string } | null;

/** 기기에 저장해 두는 대본 재료 — 다시 들어올 때 즉시 띄우기 위한 것 */
type CachedScript = {
  prayerClass?: string;
  verses?: BibleVerse[];
  normalizedScripture?: string;
  testament?: "구약" | "신약";
  plan?: PlanInfo;
  savedAt?: string;
};

function toISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function upcomingSunday() {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  return toISO(date);
}

function shiftSunday(iso: string, weeks: number) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + weeks * 7);
  return toISO(date);
}

function dateLabel(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function sortClasses(classes: ClassRow[]) {
  return classes
    .map((row) => row.class_no)
    .filter((value) => /^\d+-\d+$/.test(value))
    .sort((a, b) => {
      const [ag, ac] = a.split("-").map(Number);
      const [bg, bc] = b.split("-").map(Number);
      return bg - ag || bc - ac;
    });
}

function nextClass(current: string | undefined, classes: string[]) {
  if (!classes.length) return "";
  const index = current ? classes.indexOf(current) : -1;
  return classes[(index + 1) % classes.length];
}

function ScriptEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
  }, []);

  useLayoutEffect(resize, [resize, value]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth !== width) { width = nextWidth; resize(); }
    });
    observer.observe(element);
    let active = true;
    void document.fonts.ready.then(() => { if (active) resize(); });
    return () => { active = false; observer.disconnect(); };
  }, [resize]);

  return <textarea ref={ref} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} rows={1} style={textareaStyle} />;
}

/** 주보 PDF 에서 글자를 뽑는다 (예배안내 화면과 같은 방식) */
async function extractPdfText(url: string, fromPage: number, toPage: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ url }).promise;
  let text = "";
  const last = Math.min(doc.numPages, toPage);
  for (let page = Math.max(1, fromPage); page <= last; page += 1) {
    const content = await (await doc.getPage(page)).getTextContent();
    text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + " ";
  }
  return normText(text);
}

/** 그 주일 초등1부 주보에서 예배순서 값을 읽는다. 없으면 빈 객체. */
async function readBulletinFields(token: string, sunday: string): Promise<DeptBulletinFields> {
  try {
    const response = await fetchWithAuth(`/api/dept-bulletin/latest?dept=${encodeURIComponent("초등1부")}`, token);
    const data = await response.json();
    if (!response.ok || !data.ok) return {};
    type Item = { issue_date: string | null; pdf_url?: string | null };
    const item = ((data.items || []) as Item[]).find((row) => row.issue_date === sunday && row.pdf_url);
    if (!item?.pdf_url) return {};
    const text = await extractPdfText(item.pdf_url, 1, 3);
    return text ? parseDeptBulletinFields(text) : {};
  } catch {
    // 주보를 못 읽어도 나머지 출처로 계속 간다
    return {};
  }
}

async function fetchWithAuth(url: string, token: string) {
  let response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status !== 401) return response;
  const { data } = await supabase.auth.refreshSession();
  if (!data.session) return response;
  response = await fetch(url, { headers: { Authorization: `Bearer ${data.session.access_token}` } });
  return response;
}

export default function WorshipLeaderPage() {
  const params = useParams();
  const router = useRouter();
  const deptId = params.id as string;
  const [sunday, setSunday] = useState(upcomingSunday());
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(true);
  const [plan, setPlan] = useState<PlanInfo>(null);
  const [prayerClass, setPrayerClass] = useState("");
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [normalizedScripture, setNormalizedScripture] = useState("");
  const [testament, setTestament] = useState<"구약" | "신약" | undefined>();
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [bibleVersion, setBibleVersion] = useState<BibleVersion | null>(null);
  const [copyrightNotice, setCopyrightNotice] = useState("");
  // 한 번 만든 대본은 이 기기에 주일별로 남긴다 — 다시 들어올 때 즉시 뜨고,
  // 최신 값은 뒤에서 조용히 맞춘다 (주보 PDF 를 매번 새로 받으면 느리다)
  const cacheKey = `worship-leader-cache:${deptId}:${sunday}`;
  const [editedContents, setEditedContents] = useState<Record<number, string>>({});

  // 고친 대본은 이 브라우저에 주일별로 남긴다.
  // 예배 직전에 손보는 경우가 많은데 새로고침 한 번에 날아가면 안 된다.
  const editStorageKey = `worship-leader-edits:${deptId}:${sunday}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(editStorageKey);
      setEditedContents(saved ? (JSON.parse(saved) as Record<number, string>) : {});
    } catch {
      setEditedContents({});
    }
  }, [editStorageKey]);

  // 본문 역본의 저작권 표시 의무를 대본에 자동으로 붙인다 — 역본이 바뀌거나
  // 승인 문구가 바뀌어도 여기 손댈 필요 없이 bible_versions.copyright_slug 를 따라간다.
  useEffect(() => {
    void (async () => {
      const { data: versionRows } = await supabase.rpc("list_bible_versions");
      const versions = parseBibleVersions(versionRows);
      const version = versions.find((v) => v.code === DEFAULT_BIBLE_VERSION) ?? null;
      setBibleVersion(version);
      if (!version?.copyright_slug) return;
      const { data: noticeRows } = await supabase.rpc("get_public_copyright_notices", { p_slug: version.copyright_slug });
      const notice = (Array.isArray(noticeRows) ? noticeRows : []).map(fromPublicRow)[0];
      if (notice?.requiredNotice) setCopyrightNotice(notice.requiredNotice);
    })();
  }, []);

  const updateSection = useCallback((sectionNumber: number, value: string) => {
    setEditedContents((current) => {
      const next = { ...current, [sectionNumber]: value };
      try { window.localStorage.setItem(editStorageKey, JSON.stringify(next)); } catch { /* 저장 실패는 무시 */ }
      return next;
    });
  }, [editStorageKey]);

  const resetSections = useCallback(() => {
    setEditedContents({});
    try { window.localStorage.removeItem(editStorageKey); } catch { /* 무시 */ }
  }, [editStorageKey]);

  /** 새로 조회한 본문을 과거의 빈 7번 편집값이 가리지 않게 한다. */
  const resetScriptureSectionEdit = useCallback(() => {
    setEditedContents((current) => {
      const next = withoutWorshipLeaderSectionEdit(current, 7);
      if (next === current) return current;
      try {
        if (Object.keys(next).length) window.localStorage.setItem(editStorageKey, JSON.stringify(next));
        else window.localStorage.removeItem(editStorageKey);
      } catch { /* 저장 실패는 무시 */ }
      return next;
    });
  }, [editStorageKey]);

  /** 본문 표기 하나를 성경에서 찾아 화면에 채운다. 찾으면 true. */
  const lookupScripture = useCallback(async (rawReference: string) => {
    const reference = normalizeBibleReference(rawReference);
    if (!reference) return false;
    setNormalizedScripture(reference);
    resetScriptureSectionEdit();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return false;
    }
    try {
      const response = await fetch(`/api/bible/reference?ref=${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const payload = await response.json() as {
        ok?: boolean;
        normalizedLabel?: string;
        bookId?: number;
        rows?: BibleVerse[];
        error?: string;
      };
      if (response.ok && payload.ok && Array.isArray(payload.rows) && payload.rows.length) {
        const rows = payload.rows;
        setVerses(rows.map((row) => ({ chapter: row.chapter, verse: row.verse, endVerse: row.endVerse, text: row.text })));
        setNormalizedScripture(payload.normalizedLabel || reference);
        setTestament(Number(payload.bookId) <= 39 ? "구약" : "신약");
        return true;
      }
      setVerses([]);
      setTestament(undefined);
      const detail = payload.error ? ` (${payload.error})` : "";
      setNotice(`"${rawReference}" 을(를) 성경에서 찾지 못했습니다. 표기를 확인해주세요.${detail}`);
      return false;
    } catch {
      setVerses([]);
      setTestament(undefined);
      setNotice("개역개정 본문을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      return false;
    }
  }, [resetScriptureSectionEdit, router]);

  const load = useCallback(async (date: string, silent = false) => {
    // 조용히 갱신할 때는 화면에 이미 저장본이 떠 있으므로 지우지 않는다
    if (!silent) {
      setLoading(true);
      setVerses([]);
      setNormalizedScripture("");
      setTestament(undefined);
    }
    setNotice("");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    const [guideResponse, classResponse, planResponse, bulletinFields] = await Promise.all([
      supabase.rpc("worship_guide_get", { p_dept_id: deptId, p_sunday: date }),
      supabase.rpc("list_dept_classes_full", { p_dept_id: deptId }),
      fetchWithAuth(`/api/edu/monthly-plans/bulletin-import?dept_id=${deptId}&date=${date}`, session.access_token)
        .then(async (response) => ({ status: response.status, ...(await response.json()) }))
        .catch(() => null),
      readBulletinFields(session.access_token, date),
    ]);

    if (guideResponse.error) {
      if (guideResponse.error.message.includes("권한")) setAuthorized(false);
      else setNotice(`예배안내 정보를 불러오지 못했습니다: ${guideResponse.error.message}`);
      setLoading(false);
      return;
    }
    setAuthorized(true);

    const classes = sortClasses(((classResponse.data as ClassRow[]) || []).filter((row) => row.class_no));

    // 주보에 섞인 확인된 오타만 고친다 (name-correction.ts 의 목록)
    const bulletin = correctNamesIn(bulletinFields, ["leader", "preacher", "prayer", "guide", "praise"]);
    const payload = (guideResponse.data || {}) as { current?: GuideRecord; prev?: GuideRecord };
    const current = payload.current?.fields || {};
    const previous = payload.prev?.fields || {};
    const planInfo: PlanInfo = planResponse?.ok && planResponse.plan
      ? {
          fields: planResponse.plan.fields as PlanFields,
          sourceFile: planResponse.plan.sourceFile,
          sheetName: planResponse.plan.sheetName,
        }
      : null;
    setPlan(planInfo);

    let resolvedPrayerClass = current.prayerClass && classes.includes(current.prayerClass)
      ? current.prayerClass
      : "";
    if (!resolvedPrayerClass && previous.prayerNext && classes.includes(previous.prayerNext)) {
      resolvedPrayerClass = previous.prayerNext;
    }
    if (!resolvedPrayerClass && previous.prayerClass && classes.includes(previous.prayerClass)) {
      resolvedPrayerClass = nextClass(previous.prayerClass, classes);
    }
    if (!resolvedPrayerClass) {
      const planned = normalizeClassToken(planInfo?.fields.prayerClass);
      if (classes.includes(planned)) resolvedPrayerClass = planned;
    }
    if (!resolvedPrayerClass) resolvedPrayerClass = classes[0] || "";
    setPrayerClass(resolvedPrayerClass);

    // 본문 표기 찾기 — 예배안내 저장본이 가장 확실하다.
    // 예배안내는 매주 사람이 직접 채워 저장하므로, 월간교육계획이 아직 안 올라온
    // 주일에도 본문이 들어 있다. 계획서·주보 초안은 그다음 순서로 본다.
    const guideMessage = (payload.current as { message?: string } | null | undefined)?.message ?? "";
    const fromGuide = parseGuideMessage(guideMessage);

    // 그 주일 주보가 가장 확실하다 — 실제로 나눠 준 종이에 적힌 값이다
    let scripture = (bulletin.scripture || "").trim();
    let source = scripture ? "주보" : "";

    if (!scripture) {
      scripture = fromGuide.scripture.trim();
      source = scripture ? "예배안내" : "";
    }

    if (!scripture) {
      scripture = planInfo?.fields.scripture?.trim() || "";
      source = scripture ? "월간교육계획" : "";
    }
    if (!scripture) {
      const { data: draft } = await supabase.rpc("bulletin_get_draft", {
        p_dept_id: deptId,
        p_issue_date: date,
      });
      const form = (draft as { form_data?: { scripture?: string } }[] | null)?.[0]?.form_data;
      const fromDraft = form?.scripture?.trim() || "";
      if (fromDraft) { scripture = fromDraft; source = "주보 초안"; }
    }

    // 설교 제목도 계획서에 없으면 예배안내 문구에서 보완한다
    const titleFallback = (bulletin.sermonTitle || "").trim() || fromGuide.sermonTitle;
    if (!planInfo?.fields.sermonTitle?.trim() && titleFallback) {
      setPlan((current) => current
        ? { ...current, fields: { ...current.fields, sermonTitle: titleFallback } }
        : { fields: { sermonTitle: titleFallback }, sourceFile: source || "예배안내", sheetName: "" });
    }

    if (scripture) {
      await lookupScripture(scripture);
    } else {
      resetScriptureSectionEdit();
      setNotice(
        planResponse?.ok === false && planResponse?.error
          ? planResponse.error
          : "이 주일의 말씀 본문이 아직 정해지지 않았습니다.",
      );
    }
    setLoading(false);
  }, [deptId, router, lookupScripture, resetScriptureSectionEdit]);

  // 만들어진 대본 재료를 기기에 남긴다 — 다음에 들어올 때 즉시 뜬다
  useEffect(() => {
    if (loading) return;
    try {
      const payload: CachedScript = {
        prayerClass,
        verses,
        normalizedScripture,
        testament,
        plan,
        savedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch {
      /* 저장 실패는 무시 — 다음에 다시 만들면 된다 */
    }
  }, [cacheKey, loading, prayerClass, verses, normalizedScripture, testament, plan]);

  useEffect(() => {
    // 저장해 둔 대본이 있으면 먼저 띄우고, 최신 값은 뒤에서 맞춘다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void (async () => {
      let hadCache = false;
      try {
        const raw = window.localStorage.getItem(cacheKey);
        if (raw) {
          const cached = JSON.parse(raw) as CachedScript;
          setPrayerClass(cached.prayerClass || "");
          setVerses(cached.verses || []);
          setNormalizedScripture(cached.normalizedScripture || "");
          setTestament(cached.testament);
          setPlan(cached.plan ?? null);
          setLoading(false);
          hadCache = true;
        }
      } catch { /* 캐시가 깨졌으면 그냥 새로 만든다 */ }
      await load(sunday, hadCache);
    })();
  }, [load, sunday, cacheKey]);

  const generatedSections = useMemo(() => buildWorshipLeaderSections({
    sunday,
    prayerClass,
    scripture: plan?.fields.scripture || "",
    normalizedScripture,
    testament,
    verses,
    sermonTitle: plan?.fields.sermonTitle || "",
    preacher: plan?.fields.preacher || "",
    versionName: bibleVersion?.name_ko || "개역개정",
    copyrightNotice,
  }), [bibleVersion, copyrightNotice, normalizedScripture, plan, prayerClass, sunday, testament, verses]);

  const sections = useMemo(() => generatedSections.map((section) => ({
    ...section,
    content: editedContents[section.number] ?? section.content,
  })), [editedContents, generatedSections]);

  const scriptText = useMemo(
    () => worshipLeaderScriptText(dateLabel(sunday), sections),
    [sections, sunday],
  );

  const copyScript = async () => {
    await navigator.clipboard.writeText(scriptText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (loading) return <LoadingView full label="예배인도 스크립트를 만들고 있습니다..." />;

  if (!authorized) {
    return (
      <main style={{ minHeight: "100vh", background: "var(--bg)", padding: 24 }}>
        <div style={{ maxWidth: 680, margin: "80px auto", textAlign: "center" }}>
          <BookOpen size={42} color="var(--ink-faint)" />
          <h2 style={{ marginTop: 18 }}>접근 권한이 없습니다</h2>
          <p style={{ color: "var(--ink-soft)" }}>예배인도 메뉴는 초등1부 부서관리 권한이 있는 사용자만 볼 수 있습니다.</p>
          <button onClick={() => router.push(`/departments/d/${deptId}?menu=department`)} style={buttonStyle}>부서관리로 돌아가기</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: 64 }}>
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "color-mix(in srgb, var(--surface) 94%, transparent)", borderBottom: "1px solid var(--line)", backdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 820, margin: "0 auto", minHeight: 64, padding: "0 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <button aria-label="부서관리로 돌아가기" onClick={() => router.push(`/departments/d/${deptId}?menu=department`)} style={iconButtonStyle}><ChevronLeft size={22} /></button>
          <HeaderLogo />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)" }}>예배인도</div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>초등1부 주일 예배 스크립트</div>
          </div>
          <button onClick={() => void load(sunday)} aria-label="새로고침" style={iconButtonStyle}><RefreshCw size={19} /></button>
        </div>
      </header>

      <div style={{ maxWidth: 820, margin: "0 auto", padding: "20px 16px" }}>
        <section style={{ ...cardStyle, padding: 16, display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setSunday(shiftSunday(sunday, -1))} aria-label="이전 주" style={iconButtonStyle}><ChevronLeft size={20} /></button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{dateLabel(sunday)} 주일</div>
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-soft)" }}>
              {plan ? `월간교육계획 · ${plan.sourceFile} · ${plan.sheetName}` : "월간교육계획 정보 없음"}
            </div>
          </div>
          <button onClick={() => setSunday(shiftSunday(sunday, 1))} aria-label="다음 주" style={iconButtonStyle}><ChevronRight size={20} /></button>
        </section>

        <div style={{ margin: "12px 0", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: "1 1 260px", fontSize: 12, color: "var(--ink-soft)" }}>
각 내용을 눌러 직접 수정할 수 있습니다. 고친 내용은 이 기기에 주일별로 저장됩니다. 시작기도는 주차별로 다르게 자동 생성됩니다. {isFirstSunday(sunday) ? "첫째 주 고정 대표기도" : prayerClass ? `대표기도 ${prayerClass}반` : "대표기도 반 확인 필요"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginLeft: "auto" }}>
            {Object.keys(editedContents).length > 0 && (
              <button onClick={resetSections} style={{ ...secondaryButtonStyle, whiteSpace: "nowrap" }}><RotateCcw size={15} /> 원본 복원</button>
            )}
            <button onClick={() => void copyScript()} style={{ ...buttonStyle, whiteSpace: "nowrap" }}><Copy size={16} /> {copied ? "복사됨" : "전체 복사"}</button>
          </div>
        </div>

        {notice && <div role="alert" style={{ padding: "12px 14px", marginBottom: 12, borderRadius: 12, background: "color-mix(in srgb, var(--warning) 12%, var(--surface))", color: "var(--ink-soft)", fontSize: 13 }}>{notice}</div>}

        <div style={{ display: "grid", gap: 12 }}>
          {sections.map((section) => (
            <section key={section.number} style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
                <span style={{ width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", background: "#3E7D74", color: "white", fontSize: 13, fontWeight: 800 }}>{section.number}</span>
                <h2 style={{ margin: 0, fontSize: 16, color: "var(--ink)" }}>{section.title}</h2>
              </div>
              <ScriptEditor
                label={`${section.title} 내용 수정`}
                value={section.content}
                onChange={(value) => updateSection(section.number, value)}
              />
              {section.number === 7 && verses.length > 0 && <BibleAttribution version={bibleVersion} />}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 16,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  boxShadow: "0 4px 18px rgba(0,0,0,0.035)",
};

const iconButtonStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  display: "grid",
  placeItems: "center",
  borderRadius: 11,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  cursor: "pointer",
};

const buttonStyle: React.CSSProperties = {
  minHeight: 38,
  padding: "0 14px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  border: 0,
  borderRadius: 11,
  background: "#3E7D74",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink-soft)",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 74,
  padding: 12,
  resize: "none",
  overflow: "hidden",
  boxSizing: "border-box",
  display: "block",
  border: "1px solid var(--line)",
  borderRadius: 11,
  outline: "none",
  background: "var(--bg-soft)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: 15,
  lineHeight: 1.85,
  wordBreak: "keep-all",
};
