"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Lock, CalendarPlus, UploadCloud, Check, ChevronRight, Pencil } from "lucide-react";
import PdfCanvasViewer from "@/components/PdfCanvasViewer";
import { PlanMonthView, type CardsData } from "@/components/MonthlyPlanCards";

const ALLOWED_EXT = /\.(jpe?g|png|webp|gif|pdf|xlsx)$/i;
const MAX_MB = 20;

function isImageName(name: string) { return /\.(jpe?g|png|webp|gif)$/i.test(name); }
function isPdfName(name: string) { return /\.pdf$/i.test(name); }
function isXlsxName(name: string) { return /\.xlsx$/i.test(name); }

export default function MonthlyPlanUploadPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const now = new Date();

  const [authChecked, setAuthChecked] = useState(false);
  const [grade, setGrade] = useState<number | null>(null);

  // 마법사 상태
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // 미리보기 상태
  const [previewUrl, setPreviewUrl] = useState<string | null>(null); // 이미지/PDF object URL
  const [xlsxHtml, setXlsxHtml] = useState<string | null>(null);
  const [cardData, setCardData] = useState<CardsData | null>(null);
  const [previewErr, setPreviewErr] = useState("");

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const gradeResp = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      setGrade(typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data));
      setAuthChecked(true);
    })();
  }, [deptId, router]);

  // object URL 정리
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  if (!authChecked) return <LoadingView full />;

  if (grade === null || grade > 2) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-card text-center">
            <EmptyState icon={<Lock size={24} strokeWidth={1.8} />} message="월간교육등록 권한이 없습니다" hint="부서 행정 권한이 필요합니다." />
          </div>
        </main>
      </div>
    );
  }

  const autoTitle = `${year}년 ${month}월 교육계획서`;
  const effectiveTitle = titleTouched && title.trim() ? title.trim() : autoTitle;

  function pickFile(next: File | null) {
    if (!next) return;
    if (!ALLOWED_EXT.test(next.name)) {
      setMessage("이미지·PDF·엑셀(.xlsx)만 올릴 수 있습니다. 한글(.hwp)·구형 엑셀(.xls)은 PDF로 저장해 올려주세요.");
      return;
    }
    if (next.size > MAX_MB * 1024 * 1024) {
      setMessage(`파일 크기는 ${MAX_MB}MB 이하만 가능합니다.`);
      return;
    }
    setMessage("");
    setFile(next);
    setFileName(next.name);
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragActive(false);
    pickFile(e.dataTransfer.files?.[0] || null);
  }

  // Step 2 → 3: 미리보기 준비
  async function goPreview() {
    if (!file) return;
    setPreviewErr("");
    setXlsxHtml(null);
    setCardData(null);

    // 이전 object URL 정리
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    setPreviewUrl(null);

    if (isImageName(fileName) || isPdfName(fileName)) {
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      setPreviewUrl(url);
      setStep(3);
      return;
    }

    if (isXlsxName(fileName)) {
      setStep(3);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const form = new FormData();
      form.append("dept_id", deptId);
      form.append("file", file);
      form.append("format", "cards");
      form.append("year", String(year));
      const res = await fetch("/api/edu/monthly-plans/render", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { setPreviewErr(json.error || "표 변환 실패"); return; }
      if (json.template) {
        setCardData({ year: json.year, common: json.common || [], months: json.months || [] });
      } else {
        setXlsxHtml(json.html || "");
      }
      return;
    }

    setStep(3);
  }

  async function handleUpload() {
    if (!file) { setMessage("파일을 선택하세요"); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }

    const form = new FormData();
    form.append("dept_id", deptId);
    form.append("year", String(year));
    form.append("month", String(month));
    form.append("title", effectiveTitle);
    form.append("file", file);

    setSaving(true);
    setMessage("");
    const response = await fetch("/api/edu/monthly-plans", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: form,
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok || !result.ok) { setMessage(result.error || "등록 실패"); return; }

    // 완료 → 조회 화면으로 이동
    router.push(`/departments/d/${deptId}/monthly-plan`);
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto w-full max-w-3xl px-4 py-5">
        <Stepper step={step} />

        {/* ─────────── STEP 1: 업로드 ─────────── */}
        {step === 1 && (
          <section className="rounded-lg border border-hairline bg-card p-5">
            <div className="text-[19px] font-extrabold text-ink">파일 올리기</div>
            <div className="mt-1 text-[14px] font-semibold text-ink-soft">
              월간 교육계획서 파일을 한 개 선택하세요.
            </div>

            <label
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
              onDrop={handleDrop}
              className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-10 text-center transition ${dragActive ? "border-accent-strong bg-accent-soft" : "border-hairline-strong bg-surface hover:border-accent-muted"}`}
            >
              <UploadCloud size={32} strokeWidth={1.6} className={dragActive ? "text-accent-strong" : "text-ink-faint"} />
              <div className="text-[15px] font-bold text-ink">
                {fileName || (dragActive ? "여기에 놓으세요" : "여기를 눌러 파일 선택")}
              </div>
              <div className="text-[13px] font-semibold text-ink-faint sm:block">또는 파일을 끌어다 놓기 (PC)</div>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.xlsx,image/*,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] || null)}
              />
            </label>

            <div className="mt-4 rounded-md border border-hairline bg-surface px-4 py-3 text-[13px] leading-6 text-ink-soft">
              <div className="font-bold text-ink-mid">올릴 수 있는 형식</div>
              <div>· 이미지(JPG·PNG) — 캡처해서 올리면 가장 깔끔합니다</div>
              <div>· PDF — 원본 그대로 보입니다</div>
              <div>· 엑셀(.xlsx) — 표로 변환되어 보입니다</div>
              <div className="mt-1 text-ink-faint">최대 {MAX_MB}MB · 한글(.hwp)·구형 엑셀(.xls)은 PDF로 저장해 올려주세요.</div>
            </div>

            {message && <div className="mt-3 text-center text-[14px] font-bold text-danger">{message}</div>}

            <button
              type="button"
              onClick={() => { setMessage(""); setStep(2); }}
              disabled={!file}
              className="mt-5 min-h-12 w-full rounded-md bg-accent-strong text-[16px] font-extrabold text-white disabled:bg-hairline-strong"
            >
              다음
            </button>
          </section>
        )}

        {/* ─────────── STEP 2: 월 확인 ─────────── */}
        {step === 2 && (
          <section className="rounded-lg border border-hairline bg-card p-5">
            <div className="text-[19px] font-extrabold text-ink">언제 것인가요?</div>
            <div className="mt-1 text-[14px] font-semibold text-ink-soft">
              어느 달 교육계획서로 등록할지 확인하세요.
            </div>

            <label className="mt-4 block">
              <div className="mb-1 text-[14px] font-bold text-ink-soft">월</div>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={inputClass}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </label>

            <div className="mt-3 rounded-md border border-accent-line bg-accent-soft px-4 py-3 text-[15px] font-bold text-accent-strong">
              {effectiveTitle} 로 등록합니다
            </div>

            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-ink-soft"
            >
              <Pencil size={13} strokeWidth={2} /> 연도·제목 직접 수정
            </button>

            {showDetails && (
              <div className="mt-2 grid gap-3 rounded-md border border-hairline bg-surface p-4">
                <label className="block">
                  <div className="mb-1 text-[13px] font-bold text-ink-soft">연도</div>
                  <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass} />
                </label>
                <label className="block">
                  <div className="mb-1 text-[13px] font-bold text-ink-soft">제목</div>
                  <input
                    value={titleTouched ? title : autoTitle}
                    onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }}
                    className={inputClass}
                  />
                </label>
              </div>
            )}

            <div className="mt-3 rounded-md border border-hairline bg-surface px-4 py-2 text-[13px] font-bold text-ink-faint">
              파일: {fileName}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="min-h-12 flex-1 rounded-md border border-hairline-strong bg-card text-[15px] font-bold text-ink-mid"
              >
                뒤로
              </button>
              <button
                type="button"
                onClick={goPreview}
                className="min-h-12 flex-[2] rounded-md bg-accent-strong text-[16px] font-extrabold text-white"
              >
                다음
              </button>
            </div>
          </section>
        )}

        {/* ─────────── STEP 3: 미리보기 + 확인 ─────────── */}
        {step === 3 && (
          <section className="rounded-lg border border-hairline bg-card p-5">
            <div className="text-[19px] font-extrabold text-ink">이 화면이 맞습니까?</div>
            <div className="mt-1 text-[14px] font-semibold text-ink-soft">
              선생님들이 「월간 교육계획서」에서 보게 될 화면입니다.
            </div>

            <div className="mt-3 rounded-md border border-accent-line bg-accent-soft px-4 py-2 text-[14px] font-bold text-accent-strong">
              {effectiveTitle}
            </div>

            <div className="mt-3">
              {isImageName(fileName) && previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt={effectiveTitle} style={{ width: "100%", borderRadius: 12, display: "block", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }} />
              )}
              {isPdfName(fileName) && previewUrl && (
                <div style={{ width: "100%", height: "70vh", borderRadius: 12, border: "1px solid var(--hairline)", overflow: "hidden", background: "var(--card)" }}>
                  <PdfCanvasViewer key={previewUrl} url={previewUrl} fallbackUrl={previewUrl} />
                </div>
              )}
              {isXlsxName(fileName) && (
                <XlsxPreview cardData={cardData} html={xlsxHtml} err={previewErr} />
              )}
            </div>

            {message && <div className="mt-3 text-center text-[14px] font-bold text-danger">{message}</div>}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="min-h-12 flex-1 rounded-md border border-hairline-strong bg-card text-[15px] font-bold text-ink-mid"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="min-h-12 flex-1 rounded-md border border-hairline-strong bg-card text-[15px] font-bold text-ink-mid"
              >
                뒤로
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={saving}
                className="min-h-12 flex-[2] rounded-md bg-accent-strong text-[16px] font-extrabold text-white disabled:bg-hairline-strong"
              >
                {saving ? "업로드 중..." : "업로드"}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function XlsxPreview({ cardData, html, err }: { cardData: CardsData | null; html: string | null; err: string }) {
  if (err) return <div style={{ padding: 16, color: "var(--danger)", fontSize: 13 }}>{err}</div>;

  // 카드 미리보기: 월별 섹션으로 전부 표출
  if (cardData) {
    if (cardData.months.length === 0) {
      return <div style={{ padding: 24, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>표시할 주일 일정이 없습니다.</div>;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {cardData.months.map((m, i) => (
          <div key={m.month}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>{cardData.year}년 {m.month}월</div>
            <PlanMonthView
              year={cardData.year}
              month={m.month}
              common={i === 0 ? cardData.common : []}
              weeks={m.weeks}
              notes={m.notes}
            />
          </div>
        ))}
      </div>
    );
  }

  // 양식 불일치 폴백: 표 HTML
  if (html === null) return <div style={{ padding: 24, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>표 변환 중...</div>;
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--hairline)", borderRadius: 12, background: "var(--card)", padding: 12 }}>
      <style>{`
        .mp-sheet + .mp-sheet { margin-top: 18px; }
        .mp-sheet-name { font-size: 12px; font-weight: 700; color: var(--ink-faint); margin-bottom: 6px; }
        .mp-table { border-collapse: collapse; font-size: 12px; color: var(--ink); }
        .mp-table td { border: 1px solid var(--hairline); padding: 4px 7px; white-space: nowrap; vertical-align: middle; }
      `}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: "업로드" },
    { n: 2, label: "월 확인" },
    { n: 3, label: "미리보기" },
  ];
  return (
    <div className="mb-4 flex items-center justify-center gap-1.5">
      {steps.map((s, i) => {
        const active = step === s.n;
        const done = step > s.n;
        return (
          <div key={s.n} className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-extrabold"
                style={{
                  background: active ? "var(--accent-strong)" : done ? "var(--accent-soft)" : "var(--bg-soft)",
                  color: active ? "#fff" : done ? "var(--accent-strong)" : "var(--ink-faint)",
                  border: active || done ? "none" : "1px solid var(--hairline-strong)",
                }}
              >
                {done ? <Check size={14} strokeWidth={2.5} /> : s.n}
              </span>
              <span className="text-[13px] font-bold" style={{ color: active ? "var(--ink)" : "var(--ink-faint)" }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && <ChevronRight size={14} strokeWidth={2} className="text-ink-faint" />}
          </div>
        );
      })}
    </div>
  );
}

function PageHeader({ deptId, router }: { deptId: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div className="app-subpage-header" style={headerStyle}>
      <HeaderLogo />
      <button className="app-header-back" onClick={() => router.back()} style={backBtnStyle}>← 뒤로</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarPlus size={18} strokeWidth={1.8} /> 월간교육등록</div>
      <div style={{ width: 80 }} />
    </div>
  );
}

const inputClass = "min-h-11 w-full rounded-md border border-hairline-strong bg-card px-3 py-2 text-[16px] font-bold text-ink outline-none focus:border-accent-muted";
const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  flex: 1,
  minWidth: 0,
};
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit",
  whiteSpace: "nowrap", flexShrink: 0,
};
