"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Lock, CalendarDays } from "lucide-react";

export default function MonthlyPlanUploadPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const now = new Date();
  const [authChecked, setAuthChecked] = useState(false);
  const [grade, setGrade] = useState<number | null>(null);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      const gradeResp = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      setGrade(typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data));
      setAuthChecked(true);
    })();
  }, [deptId, router]);

  if (!authChecked) return <LoadingView full />;

  async function handleUpload() {
    if (!file) {
      setMessage("파일을 선택하세요");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    const form = new FormData();
    form.append("dept_id", deptId);
    form.append("year", String(year));
    form.append("month", String(month));
    form.append("title", title);
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
    if (!response.ok || !result.ok) {
      setMessage(result.error || "등록 실패");
      return;
    }
    setMessage("등록되었습니다");
    setTitle("");
    setFile(null);
    setFileName("");
  }

  if (grade === null || grade > 2) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-hairline bg-white text-center">
            <EmptyState icon={<Lock size={24} strokeWidth={1.8} />} message="월간교육등록 권한이 없습니다" hint="부서 행정 권한이 필요합니다." />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-hairline bg-white">
          <div className="border-b border-hairline px-5 py-4">
            <div className="text-[20px] font-extrabold text-ink">월간교육등록</div>
            <div className="mt-1 text-[15px] font-semibold text-ink-soft">
              월간 교육계획서를 등록하면 선생님들이 공지사항에서 조회하게 될 화면입니다.
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="rounded-lg border border-hairline bg-surface p-4">
              <div className="mb-3 text-[17px] font-extrabold text-ink">계획서 정보</div>
              <label className="mb-3 block">
                <div className="mb-1 text-[14px] font-bold text-ink-soft">연도</div>
                <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className={inputClass} />
              </label>
              <label className="mb-3 block">
                <div className="mb-1 text-[14px] font-bold text-ink-soft">월</div>
                <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className={inputClass}>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </label>
              <label className="mb-3 block">
                <div className="mb-1 text-[14px] font-bold text-ink-soft">제목</div>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 6월 월간 교육계획서" className={inputClass} />
              </label>
              <label className="mb-3 block">
                <div className="mb-1 text-[14px] font-bold text-ink-soft">파일</div>
                <input
                  type="file"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] || null;
                    setFile(nextFile);
                    setFileName(nextFile?.name || "");
                  }}
                  className="w-full rounded-md border border-hairline-strong bg-white px-3 py-3 text-[15px] font-bold text-ink-mid"
                />
              </label>
            </div>

            <div className="rounded-lg border border-accent-line bg-accent-soft p-4">
              <div className="mb-3 text-[17px] font-extrabold text-accent-strong">등록 미리보기</div>
              <div className="rounded-lg border border-accent-soft bg-white p-4">
                <div className="text-[15px] font-bold text-ink-faint">{year}년 {month}월</div>
                <div className="mt-1 text-[18px] font-extrabold text-ink">{title || "월간 교육계획서 제목"}</div>
                <div className="mt-3 rounded-md border border-hairline bg-surface px-3 py-2 text-[15px] font-bold text-ink-soft">
                  {fileName || "선택된 파일 없음"}
                </div>
              </div>
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[15px] leading-6 text-amber-900">
                등록한 파일은 월간 교육계획서 화면에서 선생님들이 조회합니다.
                <br />이미지(JPG·PNG)·PDF는 누르면 <b>바로 화면에 표시</b>되고, 엑셀·한글 파일은 <b>다운로드</b>로 제공됩니다. 바로 보기를 원하시면 이미지나 PDF로 올려주세요.
              </div>
              <button
                type="button"
                onClick={handleUpload}
                disabled={saving || !file}
                className="mt-4 min-h-12 w-full rounded-md bg-accent-strong text-[16px] font-extrabold text-white disabled:bg-hairline-strong"
              >
                {saving ? "등록 중..." : "등록"}
              </button>
              {message && (
                <div className="mt-3 text-center text-[15px] font-extrabold text-ink-mid">{message}</div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function PageHeader({ deptId, router }: { deptId: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div style={headerStyle}>
      <HeaderLogo />
      <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
      <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}><CalendarDays size={18} strokeWidth={1.8} /> 월간교육등록</div>
      <div style={{ width: 80 }} />
    </div>
  );
}

const inputClass = "min-h-11 w-full rounded-md border border-hairline-strong bg-white px-3 py-2 text-[16px] font-bold text-ink outline-none focus:border-accent-muted";
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
