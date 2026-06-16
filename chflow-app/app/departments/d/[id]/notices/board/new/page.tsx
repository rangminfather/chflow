"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { AlertTriangle, FileText, X } from "lucide-react";

type Attachment = {
  localId: string;
  file: File;
  isImage: boolean;
  previewUrl?: string;
  uploadedPath?: string;
  uploading: boolean;
  error?: string;
};

const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const BUCKET = "dept-notice-attachments";

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function NewDeptNoticePage() {
  const router = useRouter();
  const params = useParams();
  const deptId = params.id as string;
  const boardUrl = `/departments/d/${deptId}/notices/board`;

  const [authChecked, setAuthChecked] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setUserId(session.user.id);
      setAuthChecked(true);
      const { data: grade } = await supabase.rpc("get_user_grade", { p_dept_id: deptId });
      setAllowed(typeof grade === "number" && grade <= 3);
    })();
  }, [router, deptId]);

  function pickFiles() { fileInputRef.current?.click(); }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !userId) return;
    if (attachments.length + files.length > MAX_FILES) {
      setError(`첨부는 최대 ${MAX_FILES}개까지 가능합니다`);
      return;
    }

    const newOnes: Attachment[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        setError(`파일 크기는 10MB 이하여야 합니다: ${f.name}`);
        continue;
      }
      const isImage = f.type.startsWith("image/");
      newOnes.push({
        localId: crypto.randomUUID(),
        file: f,
        isImage,
        previewUrl: isImage ? URL.createObjectURL(f) : undefined,
        uploading: true,
      });
    }
    if (!newOnes.length) return;
    setAttachments((prev) => [...prev, ...newOnes]);

    await Promise.all(newOnes.map(async (att) => {
      const ext = att.file.name.split(".").pop() || "bin";
      const path = `${userId}/dept-notice/${Date.now()}_${att.localId}.${ext}`;
      const form = new FormData();
      form.append("file", att.file);
      const uploadRes = await fetch(`/api/storage/${BUCKET}/${path}`, { method: "POST", body: form });
      const uploadResult = await uploadRes.json();
      const upErr = uploadResult.ok ? null : (uploadResult.error ?? "업로드 실패");
      setAttachments((prev) => prev.map((a) => a.localId === att.localId ? {
        ...a,
        uploading: false,
        uploadedPath: upErr ? undefined : path,
        error: upErr ? String(upErr) : undefined,
      } : a));
    }));
  }

  async function removeAttachment(att: Attachment) {
    if (att.uploadedPath) {
      await fetch(`/api/storage/${BUCKET}/${encodeURIComponent(att.uploadedPath)}`, { method: "DELETE" });
    }
    if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
    setAttachments((prev) => prev.filter((a) => a.localId !== att.localId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) return setError("제목을 입력하세요");
    if (attachments.some((a) => a.uploading)) return setError("첨부 업로드가 끝날 때까지 기다려주세요");
    const ready = attachments.filter((a) => a.uploadedPath);

    setSubmitting(true);
    const payload = ready.map((a) => ({
      file_path: a.uploadedPath!,
      file_name: a.file.name,
      mime_type: a.file.type,
      size_bytes: a.file.size,
    }));

    const { data, error: rpcErr } = await supabase.rpc("create_dept_notice", {
      p_department_id: deptId,
      p_title: title.trim(),
      p_body: body.trim(),
      p_attachments: payload,
    });

    setSubmitting(false);
    if (rpcErr) {
      setError(`등록 실패: ${rpcErr.message}`);
      return;
    }
    router.replace(`${boardUrl}/${data as string}`);
  }

  if (!authChecked || allowed === null) return <LoadingView full />;

  if (!allowed) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink)", fontWeight: 700 }}>
            <AlertTriangle size={18} strokeWidth={1.8} /> 공지 작성 권한이 없습니다
          </div>
          <div style={{ marginTop: 8, fontSize: 14, color: "var(--ink-soft)" }}>공지 작성은 임원진·교사만 가능합니다.</div>
          <button onClick={() => router.replace(boardUrl)} style={{ ...primaryBtn, marginTop: 16 }}>게시판으로</button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button onClick={() => router.replace(boardUrl)} style={backBtnStyle}>←</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>공지 작성</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>제목 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 6월 부서 연합예배 안내"
              maxLength={120}
              style={{ ...inputStyle, marginTop: 6 }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>내용</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="공지 내용을 입력하세요."
              rows={9}
              style={{ ...inputStyle, marginTop: 6, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>첨부 (이미지·파일, 최대 {MAX_FILES}개 / 개당 10MB)</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8, marginTop: 6 }}>
              {attachments.map((att) => (
                <div key={att.localId} style={thumbWrap}>
                  {att.isImage && att.previewUrl ? (
                    <img src={att.previewUrl} alt="" style={thumbImg} />
                  ) : (
                    <div style={fileThumb}>
                      <FileText size={22} strokeWidth={1.6} />
                      <span style={fileName}>{att.file.name}</span>
                      <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>{fmtSize(att.file.size)}</span>
                    </div>
                  )}
                  {att.uploading && <div style={thumbOverlay}>업로드중...</div>}
                  {att.error && <div style={{ ...thumbOverlay, background: "rgba(168, 68, 60, 0.8)" }}>{att.error}</div>}
                  <button type="button" onClick={() => removeAttachment(att)} style={thumbRemove}><X size={13} strokeWidth={2.5} /></button>
                </div>
              ))}
              {attachments.length < MAX_FILES && (
                <button type="button" onClick={pickFiles} style={addThumbBtn}>＋ 첨부</button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.hwp,.txt" multiple onChange={handleFilesChange} style={{ display: "none" }} />
          </div>

          {error && <div style={{ ...errorStyle, display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>}

          <button type="submit" disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "등록 중..." : "공지 등록"}
          </button>
        </form>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", padding: "20px 16px 60px", fontFamily: "'Noto Sans KR', -apple-system, sans-serif" };
const cardStyle: React.CSSProperties = { maxWidth: 640, margin: "0 auto", background: "color-mix(in srgb, var(--card) 92%, transparent)", borderRadius: 16, padding: 20, boxShadow: "0 10px 30px rgba(0,0,0,0.06)" };
const backBtnStyle: React.CSSProperties = { width: 36, height: 36, borderRadius: 10, background: "var(--bg-soft)", border: "none", fontSize: 16, cursor: "pointer", color: "var(--ink-mid)" };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", letterSpacing: 0.3 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 14px", fontSize: 14, background: "var(--card)", border: "1.5px solid var(--hairline)", borderRadius: 10, outline: "none", fontFamily: "inherit", boxSizing: "border-box", color: "var(--ink)", fontWeight: 500 };
const primaryBtn: React.CSSProperties = { width: "100%", padding: "14px 16px", fontSize: 15, fontWeight: 800, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 12, cursor: "pointer", fontFamily: "inherit" };
const errorStyle: React.CSSProperties = { padding: "10px 14px", background: "var(--danger-soft)", border: "1px solid var(--danger-soft)", borderRadius: 10, fontSize: 12, color: "var(--danger)", marginBottom: 12 };
const thumbWrap: React.CSSProperties = { position: "relative", aspectRatio: "1", borderRadius: 10, overflow: "hidden", border: "1.5px solid var(--hairline)", background: "var(--surface)" };
const thumbImg: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const fileThumb: React.CSSProperties = { width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: 6, color: "var(--ink-soft)", textAlign: "center" };
const fileName: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "var(--ink-mid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", lineHeight: 1.3 };
const thumbOverlay: React.CSSProperties = { position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: 6, textAlign: "center" };
const thumbRemove: React.CSSProperties = { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: "50%", border: "none", background: "rgba(43, 39, 34,0.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", lineHeight: 1 };
const addThumbBtn: React.CSSProperties = { aspectRatio: "1", border: "2px dashed var(--hairline-strong)", background: "var(--surface)", borderRadius: 10, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)", cursor: "pointer", fontFamily: "inherit" };
