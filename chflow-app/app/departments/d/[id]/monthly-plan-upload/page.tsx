"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

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

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

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
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
            <div className="text-[48px]">🔒</div>
            <div className="mt-4 text-[18px] font-extrabold text-slate-800">월간교육등록 권한이 없습니다</div>
            <div className="mt-2 text-[15px] leading-6 text-slate-500">부서 행정 권한이 필요합니다.</div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto w-full max-w-4xl px-4 py-5">
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="text-[20px] font-extrabold text-slate-900">월간교육등록</div>
            <div className="mt-1 text-[15px] font-semibold text-slate-500">
              월간 교육계획서를 등록하면 선생님들이 공지사항에서 조회하게 될 화면입니다.
            </div>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-[17px] font-extrabold text-slate-800">계획서 정보</div>
              <label className="mb-3 block">
                <div className="mb-1 text-[14px] font-bold text-slate-500">연도</div>
                <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className={inputClass} />
              </label>
              <label className="mb-3 block">
                <div className="mb-1 text-[14px] font-bold text-slate-500">월</div>
                <select value={month} onChange={(event) => setMonth(Number(event.target.value))} className={inputClass}>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
              </label>
              <label className="mb-3 block">
                <div className="mb-1 text-[14px] font-bold text-slate-500">제목</div>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 6월 월간 교육계획서" className={inputClass} />
              </label>
              <label className="mb-3 block">
                <div className="mb-1 text-[14px] font-bold text-slate-500">파일</div>
                <input
                  type="file"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] || null;
                    setFile(nextFile);
                    setFileName(nextFile?.name || "");
                  }}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-[15px] font-bold text-slate-700"
                />
              </label>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="mb-3 text-[17px] font-extrabold text-blue-900">등록 미리보기</div>
              <div className="rounded-lg border border-blue-100 bg-white p-4">
                <div className="text-[15px] font-bold text-slate-400">{year}년 {month}월</div>
                <div className="mt-1 text-[18px] font-extrabold text-slate-900">{title || "월간 교육계획서 제목"}</div>
                <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] font-bold text-slate-500">
                  {fileName || "선택된 파일 없음"}
                </div>
              </div>
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[15px] leading-6 text-amber-900">
                등록한 파일은 공지사항의 월간 교육계획서에서 선생님들이 조회할 수 있습니다.
              </div>
              <button
                type="button"
                onClick={handleUpload}
                disabled={saving || !file}
                className="mt-4 min-h-12 w-full rounded-md bg-blue-700 text-[16px] font-extrabold text-white disabled:bg-slate-300"
              >
                {saving ? "등록 중..." : "등록"}
              </button>
              {message && (
                <div className="mt-3 text-center text-[15px] font-extrabold text-slate-700">{message}</div>
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
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backBtnStyle}>← 부서홈</button>
        <HeaderLogo />
      </div>
      <div style={titleStyle}>🗓️ 월간교육등록</div>
      <div style={{ width: 80 }} />
    </div>
  );
}

const inputClass = "min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[16px] font-bold text-slate-800 outline-none focus:border-blue-400";
const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "#1e293b" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 14, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const loadingStyle: React.CSSProperties = { ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" };
