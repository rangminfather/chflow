"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { supabase } from "@/lib/supabase";
import { BookOpen, Download, FileText, PencilLine, Trash2, Upload, X } from "lucide-react";

type StoredAttachment = {
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
};

type VerseMemoryRow = {
  id: string;
  memory_month: string;
  title: string;
  body: string;
  attachments: StoredAttachment[];
  author_name: string | null;
  author_sub_role: string | null;
  can_delete: boolean;
  created_at: string;
};

const BUCKET = "dept-notice-attachments";
const MAX_FILES = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function storageUrl(path: string, download = false) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `/api/storage/${BUCKET}/${encoded}${download ? "?download=1" : ""}`;
}

export default function VerseMemoryPage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const currentYear = new Date().getFullYear();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [year, setYear] = useState(currentYear);
  const [items, setItems] = useState<VerseMemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [targetMonth, setTargetMonth] = useState(monthValue());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (selectedYear: number) => {
    setLoading(true);
    setError("");
    const [{ data, error: listError }, { data: grade, error: gradeError }] = await Promise.all([
      supabase.rpc("list_dept_verse_memories", { p_department_id: deptId, p_year: selectedYear }),
      supabase.rpc("get_user_grade", { p_dept_id: deptId }),
    ]);
    if (listError || gradeError) {
      setError(listError?.message || gradeError?.message || "자료를 불러오지 못했습니다");
      setItems([]);
    } else {
      setItems((data || []) as VerseMemoryRow[]);
      setCanWrite(typeof grade === "number" && grade <= 2);
    }
    setLoading(false);
  }, [deptId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setUserId(session.user.id);
      setAuthChecked(true);
      await load(currentYear);
    })();
  }, [currentYear, load, router]);

  function selectFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length + picked.length > MAX_FILES) {
      setError(`첨부파일은 최대 ${MAX_FILES}개까지 가능합니다`);
      return;
    }
    const oversized = picked.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) {
      setError(`파일당 최대 크기는 20MB입니다: ${oversized.name}`);
      return;
    }
    setError("");
    setFiles((previous) => [...previous, ...picked]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return setError("제목을 입력하세요");
    if (!targetMonth) return setError("대상 월을 선택하세요");

    setSubmitting(true);
    setError("");
    const uploaded: StoredAttachment[] = [];

    try {
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${userId}/verse-memory/${crypto.randomUUID()}_${safeName}`;
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`/api/storage/${BUCKET}/${path}`, { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || `${file.name} 업로드 실패`);
        uploaded.push({ file_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size });
      }

      const { error: createError } = await supabase.rpc("create_dept_verse_memory", {
        p_department_id: deptId,
        p_memory_month: `${targetMonth}-01`,
        p_title: title.trim(),
        p_body: body.trim(),
        p_attachments: uploaded,
      });
      if (createError) throw createError;

      setTitle("");
      setBody("");
      setFiles([]);
      setFormOpen(false);
      const selectedYear = Number(targetMonth.slice(0, 4));
      setYear(selectedYear);
      await load(selectedYear);
    } catch (caught) {
      await Promise.all(uploaded.map((file) =>
        fetch(storageUrl(file.file_path), { method: "DELETE" }).catch(() => undefined)
      ));
      setError(caught instanceof Error ? caught.message : "등록하지 못했습니다");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeItem(item: VerseMemoryRow) {
    if (!confirm(`${Number(item.memory_month.slice(5, 7))}월 자료를 삭제하시겠습니까?`)) return;
    const { data, error: deleteError } = await supabase.rpc("delete_dept_verse_memory", { p_id: item.id });
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    const attachments = (data || []) as StoredAttachment[];
    await Promise.all(attachments.map((file) =>
      fetch(storageUrl(file.file_path), { method: "DELETE" }).catch(() => undefined)
    ));
    await load(year);
  }

  if (!authChecked) return <LoadingView full />;

  const yearOptions = Array.from({ length: Math.max(1, currentYear - 2024 + 2) }, (_, index) => currentYear + 1 - index);

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <HeaderLogo />
        <div style={headerTitle}><BookOpen size={19} /> 요절암송</div>
        <button onClick={() => router.push(`/departments/d/${deptId}`)} style={backButton}>← 부서홈</button>
      </header>

      <main style={mainStyle}>
        <section style={heroStyle}>
          <div>
            <div style={eyebrowStyle}>초등1부 · 공통게시판</div>
            <h1 style={titleStyle}>요절암송</h1>
            <p style={descriptionStyle}>월별 요절암송 보기</p>
          </div>
          {canWrite && (
            <button onClick={() => setFormOpen((open) => !open)} style={primaryButton}>
              {formOpen ? <X size={16} /> : <PencilLine size={16} />}
              {formOpen ? "작성 닫기" : "글쓰기"}
            </button>
          )}
        </section>

        {formOpen && canWrite && (
          <form onSubmit={submit} style={formStyle}>
            <div style={formHeading}>요절암송 자료 등록</div>
            <div style={formGrid}>
              <label style={fieldStyle}>
                <span style={labelStyle}>대상 월</span>
                <input type="month" value={targetMonth} onChange={(event) => setTargetMonth(event.target.value)} required style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>제목</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="예: 6월 요절암송" required style={inputStyle} />
              </label>
            </div>
            <label style={fieldStyle}>
              <span style={labelStyle}>내용</span>
              <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="암송 구절과 안내 내용을 입력하세요." style={textareaStyle} />
            </label>
            <input ref={fileInputRef} type="file" multiple onChange={selectFiles} style={{ display: "none" }} accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.hwp" />
            <button type="button" onClick={() => fileInputRef.current?.click()} style={uploadButton}>
              <Upload size={16} /> 파일 첨부 ({files.length}/{MAX_FILES})
            </button>
            {files.length > 0 && (
              <div style={selectedFilesStyle}>
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} style={selectedFileStyle}>
                    <FileText size={15} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                    <span>{fileSize(file.size)}</span>
                    <button type="button" onClick={() => setFiles((previous) => previous.filter((_, fileIndex) => fileIndex !== index))} style={iconButton}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <button type="submit" disabled={submitting} style={{ ...primaryButton, alignSelf: "flex-end", opacity: submitting ? 0.65 : 1 }}>
              {submitting ? "등록 중..." : "등록하기"}
            </button>
          </form>
        )}

        {error && <div style={errorStyle}>{error}</div>}

        <div style={toolbarStyle}>
          <strong>{year}년 자료</strong>
          <select value={year} onChange={(event) => { const selected = Number(event.target.value); setYear(selected); load(selected); }} style={yearSelectStyle}>
            {yearOptions.map((option) => <option key={option} value={option}>{option}년</option>)}
          </select>
        </div>

        {loading ? (
          <LoadingView padding={56} />
        ) : items.length === 0 ? (
          <div style={emptyWrap}><EmptyState icon={<BookOpen size={30} />} message={`${year}년에 등록된 요절암송 자료가 없습니다`} padding={56} /></div>
        ) : (
          <div style={listStyle}>
            {items.map((item) => (
              <article key={item.id} style={cardStyle}>
                <div style={monthBadgeStyle}>{Number(item.memory_month.slice(5, 7))}<small>월</small></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={cardHeadStyle}>
                    <div>
                      <h2 style={cardTitleStyle}>{item.title}</h2>
                      <div style={metaStyle}>{item.author_name || "작성자"}{item.author_sub_role ? ` · ${item.author_sub_role}` : ""} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</div>
                    </div>
                    {item.can_delete && <button onClick={() => removeItem(item)} title="삭제" style={deleteButton}><Trash2 size={16} /></button>}
                  </div>
                  {item.body && <div style={bodyStyle}>{item.body}</div>}
                  {item.attachments?.length > 0 && (
                    <div style={attachmentsStyle}>
                      {item.attachments.map((file) => (
                        <a key={file.file_path} href={storageUrl(file.file_path, true)} style={attachmentStyle}>
                          <FileText size={16} />
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.file_name}</span>
                          <span style={{ color: "var(--ink-faint)" }}>{fileSize(file.size_bytes)}</span>
                          <Download size={15} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", color: "var(--ink)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { height: 58, padding: "0 clamp(12px,4vw,24px)", display: "flex", alignItems: "center", gap: 14, background: "var(--card)", borderBottom: "1px solid var(--hairline)" };
const headerTitle: React.CSSProperties = { flex: 1, display: "flex", alignItems: "center", gap: 7, fontSize: 18, fontWeight: 800 };
const backButton: React.CSSProperties = { border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--card)", padding: "8px 11px", color: "var(--ink-mid)", fontWeight: 700, cursor: "pointer" };
const mainStyle: React.CSSProperties = { width: "min(900px, calc(100% - 24px))", margin: "0 auto", padding: "22px 0 48px" };
const heroStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: 22, borderRadius: 14, background: "linear-gradient(135deg, var(--card), var(--accent-soft))", border: "1px solid var(--hairline)", marginBottom: 14 };
const eyebrowStyle: React.CSSProperties = { color: "var(--accent)", fontSize: 12, fontWeight: 800 };
const titleStyle: React.CSSProperties = { margin: "5px 0 4px", fontSize: 24, fontWeight: 900 };
const descriptionStyle: React.CSSProperties = { margin: 0, color: "var(--ink-soft)", fontSize: 13 };
const primaryButton: React.CSSProperties = { minHeight: 40, border: 0, borderRadius: 9, padding: "0 15px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: "var(--accent)", color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const formStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 13, padding: 20, marginBottom: 14, borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)" };
const formHeading: React.CSSProperties = { fontSize: 17, fontWeight: 850 };
const formGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(150px, 0.38fr) minmax(220px, 1fr)", gap: 12 };
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--ink-mid)" };
const inputStyle: React.CSSProperties = { width: "100%", height: 42, border: "1px solid var(--hairline-strong)", borderRadius: 8, padding: "0 11px", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 14 };
const textareaStyle: React.CSSProperties = { ...inputStyle, height: "auto", resize: "vertical", padding: 11, lineHeight: 1.6 };
const uploadButton: React.CSSProperties = { alignSelf: "flex-start", minHeight: 38, border: "1px dashed var(--accent)", borderRadius: 8, padding: "0 12px", display: "inline-flex", alignItems: "center", gap: 6, background: "var(--accent-soft)", color: "var(--accent-strong)", fontWeight: 750, cursor: "pointer" };
const selectedFilesStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const selectedFileStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "var(--surface)", color: "var(--ink-soft)", fontSize: 12 };
const iconButton: React.CSSProperties = { width: 26, height: 26, border: 0, borderRadius: 6, display: "grid", placeItems: "center", background: "var(--hairline)", color: "var(--ink-mid)", cursor: "pointer" };
const errorStyle: React.CSSProperties = { marginBottom: 14, padding: "11px 13px", borderRadius: 9, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 700 };
const toolbarStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 2px" };
const yearSelectStyle: React.CSSProperties = { height: 38, border: "1px solid var(--hairline)", borderRadius: 8, padding: "0 10px", background: "var(--card)", color: "var(--ink)", fontWeight: 700 };
const emptyWrap: React.CSSProperties = { borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)" };
const listStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const cardStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 14, padding: 17, borderRadius: 12, background: "var(--card)", border: "1px solid var(--hairline)" };
const monthBadgeStyle: React.CSSProperties = { width: 52, height: 52, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "baseline", justifyContent: "center", paddingTop: 12, gap: 2, background: "var(--accent-soft)", color: "var(--accent-strong)", fontSize: 20, fontWeight: 900 };
const cardHeadStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 };
const cardTitleStyle: React.CSSProperties = { margin: 0, fontSize: 17, fontWeight: 850 };
const metaStyle: React.CSSProperties = { marginTop: 4, color: "var(--ink-faint)", fontSize: 11 };
const deleteButton: React.CSSProperties = { width: 34, height: 34, border: "1px solid var(--hairline)", borderRadius: 8, display: "grid", placeItems: "center", background: "var(--card)", color: "var(--danger)", cursor: "pointer" };
const bodyStyle: React.CSSProperties = { marginTop: 13, paddingTop: 12, borderTop: "1px solid var(--hairline)", whiteSpace: "pre-wrap", lineHeight: 1.7, color: "var(--ink-mid)", fontSize: 14 };
const attachmentsStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 7, marginTop: 12 };
const attachmentStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--hairline)", color: "var(--ink-mid)", textDecoration: "none", fontSize: 12, fontWeight: 700 };
