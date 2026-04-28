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

async function generateHwpx(form: FormState): Promise<Blob> {
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
    } else {
      outZip.file(name, await f.async("uint8array"));
    }
  }
  return outZip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

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
  const skipNextLoadRef = useRef(false);

  // 인증 + 부서 + 표어 + 첫 draft
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      setAuthChecked(true);
      const { data: deptInfo } = await supabase.rpc("get_department_info", { p_dept_id: deptId });
      if (deptInfo && deptInfo[0]) setDeptName(deptInfo[0].name || "");

      await loadYearlyTheme();
      await loadDraft(form.date);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const { data, error } = await supabase.rpc("bulletin_get_draft", {
      p_dept_id: deptId, p_issue_date: date,
    });
    if (error) {
      showToast("Draft 조회 실패: " + error.message);
      return;
    }
    const row = data && data[0];
    if (row && row.exists_) {
      const draft = row.form_data as Partial<FormState>;
      setForm({
        ...EMPTY_FORM,
        date,
        issueNumber: row.issue_number || calcIssueNumber(date),
        ...draft,
      });
      setDraftMeta({ last_edited_by: row.last_edited_by, last_edited_at: row.last_edited_at });
      // 표어가 등록돼있으면 주제제창 비어있을 때만 채워주기
      if (yearlyTheme && !draft.theme) {
        setForm((f) => ({ ...f, theme: yearlyTheme.theme }));
      }
    } else {
      // 새 draft (빈 폼) — 표어는 채워줌
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
      // 저장 직후엔 useEffect 의 loadDraft 가 다시 덮어쓰지 않게
      skipNextLoadRef.current = true;
      showToast("임시저장 완료 ✅");
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

  const handleDownloadHwpx = async () => {
    if (!form.date) {
      showToast("날짜를 선택해주세요");
      return;
    }
    setGenerating(true);
    try {
      const blob = await generateHwpx(form);
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
        <button onClick={handleSaveDraft} disabled={savingDraft} style={draftBtnStyle}>
          {savingDraft ? "저장 중..." : "💾 임시저장"}
        </button>
      </div>

      <div style={containerStyle}>
        {!isSupported && (
          <div style={warnCardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>현재 {SUPPORTED_DEPT}만 지원합니다</div>
          </div>
        )}

        {/* 직전 저장 정보 */}
        {draftMeta && (
          <div style={{ ...cardStyle, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              마지막 임시저장: <b style={{ color: "#1e293b" }}>{formatRelativeTime(draftMeta.last_edited_at)}</b>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {new Date(draftMeta.last_edited_at).toLocaleString("ko-KR")}
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

        {/* ⑧ 액션 */}
        <div style={cardStyle}>
          <div style={sectionLabel}>⑧ 주보 생성</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, marginBottom: 12 }}>
            현재 단계: hwpx 다운로드 (Phase 1).
            다음 단계: 사진 4장 + PDF 자동 생성 (Phase 2), UMS 자동 등록 (Phase 3).
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={handleSaveDraft} disabled={savingDraft} style={resetBtnStyle}>
              {savingDraft ? "저장 중..." : "💾 임시저장"}
            </button>
            <button onClick={handleDownloadHwpx} disabled={generating} style={primaryBtnStyle}>
              {generating ? "생성 중..." : "📥 hwpx 다운로드"}
            </button>
          </div>
        </div>
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
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
