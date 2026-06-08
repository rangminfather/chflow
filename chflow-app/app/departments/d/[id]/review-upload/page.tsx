"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";

interface ReviewFile {
  id: string;
  path: string;
  name: string;
  title: string;
  lessonNum: string;
  specialTitle: string;
  quizzes: { type: string; question: string; choices: string[] }[];
  created_at: string | null;
  size: number | null;
}

export default function ReviewUploadPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [grade, setGrade] = useState<number | null>(null);
  const [files, setFiles] = useState<ReviewFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const showMsg = (text: string, ok = true) => {
    setMessage({ text, ok });
    setTimeout(() => setMessage(null), 3000);
  };

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/edu/review-problems?dept_id=${deptId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (json.ok) setFiles(json.problems || []);
    } catch {
      showMsg("목록 로드 실패", false);
    } finally {
      setLoading(false);
    }
  }, [deptId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }
      const gradeResp = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      const g = typeof gradeResp.data === "number" ? gradeResp.data : Number(gradeResp.data);
      setGrade(g);
      setAuthChecked(true);
      if (g <= 2) await loadFiles();
    })();
  }, [deptId, router, loadFiles]);

  async function handleUpload(fileList: FileList | null) {
    const selected = Array.from(fileList || []).filter((f) => /\.pptx$/i.test(f.name));
    if (selected.length === 0) { showMsg("PPTX 파일을 선택하세요", false); return; }
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const form = new FormData();
      form.append("dept_id", deptId);
      selected.forEach((f) => form.append("files", f));
      const res = await fetch("/api/edu/review-problems", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "업로드 실패");
      showMsg(`${selected.length}개 업로드 완료`);
      await loadFiles();
    } catch (e: unknown) {
      showMsg((e as Error).message, false);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(file: ReviewFile) {
    if (!confirm(`"${file.title}" 복습문제를 삭제하시겠습니까?\n삭제하면 복구할 수 없습니다.`)) return;
    setDeletingPath(file.path);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(
        `/api/edu/review-problems?dept_id=${deptId}&path=${encodeURIComponent(file.path)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "삭제 실패");
      showMsg(`"${file.title}" 삭제됨`);
      await loadFiles();
    } catch (e: unknown) {
      showMsg((e as Error).message, false);
    } finally {
      setDeletingPath(null);
    }
  }

  if (!authChecked) return <div style={loadingStyle}>로딩 중...</div>;

  if (grade === null || grade > 2) {
    return (
      <div style={pageStyle}>
        <PageHeader deptId={deptId} router={router} />
        <main className="mx-auto max-w-lg px-4 py-14">
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-10 text-center">
            <div className="text-[48px]">🔒</div>
            <div className="mt-4 text-[18px] font-extrabold text-slate-800">복습문제 관리 권한이 없습니다</div>
            <div className="mt-2 text-[15px] leading-6 text-slate-500">교육사 / 전도사 이상 권한이 필요합니다.</div>
          </div>
        </main>
      </div>
    );
  }

  const lessonFiles = files.filter((f) => f.lessonNum);
  const specialFiles = files.filter((f) => !f.lessonNum);

  return (
    <div style={pageStyle}>
      <PageHeader deptId={deptId} router={router} />

      <main className="mx-auto w-full max-w-4xl px-4 py-5 flex flex-col gap-4">

        {/* 업로드 섹션 */}
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="text-[20px] font-extrabold text-slate-900">복습문제 업로드</div>
            <div className="mt-1 text-[14px] text-slate-500 leading-5">
              공과 PPTX 파일을 업로드하면 주보 만들기에서 해당 주차에 자동 매칭됩니다.<br />
              파일명에 <b>과 번호</b>가 포함되어야 합니다 (예: <code>복습 문제 14과.pptx</code>).
            </div>
          </div>
          <div className="p-5">
            <label className={`
              flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed
              ${uploading ? "border-slate-300 bg-slate-50 cursor-default" : "border-blue-300 bg-blue-50 hover:bg-blue-100 cursor-pointer"}
              p-8 text-center transition-colors
            `}>
              <div className="text-[32px]">{uploading ? "⏳" : "📁"}</div>
              <div className="text-[15px] font-extrabold text-blue-800">
                {uploading ? "업로드 중..." : "PPTX 파일 선택 (복수 가능)"}
              </div>
              <div className="text-[13px] text-blue-600">.pptx 파일만 허용</div>
              <input
                type="file"
                accept=".pptx"
                multiple
                disabled={uploading}
                className="hidden"
                onChange={(e) => { handleUpload(e.target.files); e.currentTarget.value = ""; }}
              />
            </label>
          </div>
        </section>

        {/* 메시지 토스트 */}
        {message && (
          <div className={`rounded-lg px-4 py-3 text-[14px] font-bold ${message.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
            {message.ok ? "✅ " : "❌ "}{message.text}
          </div>
        )}

        {/* 목록 */}
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4 flex justify-between items-center">
            <div>
              <div className="text-[18px] font-extrabold text-slate-900">
                등록된 복습문제 ({files.length}개)
              </div>
              <div className="text-[13px] text-slate-500 mt-0.5">
                공과 {lessonFiles.length}개 · 절기특별 {specialFiles.length}개
              </div>
            </div>
            <button
              onClick={loadFiles}
              disabled={loading}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] font-bold text-slate-600 disabled:opacity-50"
            >
              {loading ? "로딩..." : "새로고침"}
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-[14px] text-slate-400">불러오는 중...</div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center">
              <div className="text-[36px]">📭</div>
              <div className="mt-3 text-[15px] font-bold text-slate-500">등록된 복습문제가 없습니다</div>
              <div className="mt-1 text-[13px] text-slate-400">위에서 PPTX 파일을 업로드하세요</div>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {files.map((file) => (
                <li key={file.path} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-[18px]">
                    📄
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {file.lessonNum && (
                        <span className="inline-block rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-extrabold text-blue-800">
                          {file.lessonNum}과
                        </span>
                      )}
                      {file.specialTitle && (
                        <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-extrabold text-purple-800">
                          절기
                        </span>
                      )}
                      <span className="text-[14px] font-bold text-slate-800 truncate">{file.title}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-400">
                      {file.quizzes.length}문제
                      {file.created_at && ` · ${new Date(file.created_at).toLocaleDateString("ko-KR")}`}
                      {file.size && ` · ${(file.size / 1024).toFixed(0)}KB`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(file)}
                    disabled={deletingPath === file.path}
                    className="flex-shrink-0 rounded-md border border-red-200 bg-white px-3 py-1.5 text-[12px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    {deletingPath === file.path ? "삭제 중..." : "삭제"}
                  </button>
                </li>
              ))}
            </ul>
          )}
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
      <div style={titleStyle}>📚 복습문제 관리</div>
      <div style={{ width: 80 }} />
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "#1e293b" };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 8, fontSize: 14, color: "#475569", cursor: "pointer", fontFamily: "inherit" };
const loadingStyle: React.CSSProperties = { minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Noto Sans KR', sans-serif", display: "flex", alignItems: "center", justifyContent: "center" };
