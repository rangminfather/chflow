"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";

type Attachment = {
  localId: string;
  file: File;
  previewUrl: string;
  uploadedPath?: string;
  uploading: boolean;
  error?: string;
};

const MAX_FILES = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default function NewFeedbackPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
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
    })();
  }, [router]);

  // 안드로이드 뒤로가기 → 목록으로
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ chflowFeedbackNewGuard: true }, "");
    const onPop = () => router.replace("/feedback");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [router]);

  function pickFiles() { fileInputRef.current?.click(); }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !userId) return;
    if (attachments.length + files.length > MAX_FILES) {
      setError(`이미지는 최대 ${MAX_FILES}장까지 첨부 가능합니다`);
      return;
    }

    const newOnes: Attachment[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) {
        setError(`이미지 파일만 업로드 가능합니다: ${f.name}`);
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(`파일 크기는 10MB 이하여야 합니다: ${f.name}`);
        continue;
      }
      newOnes.push({
        localId: crypto.randomUUID(),
        file: f,
        previewUrl: URL.createObjectURL(f),
        uploading: true,
      });
    }
    if (!newOnes.length) return;
    setAttachments((prev) => [...prev, ...newOnes]);

    // 업로드 (병렬)
    await Promise.all(newOnes.map(async (att) => {
      const ext = att.file.name.split(".").pop() || "png";
      const path = `${userId}/posts/${Date.now()}_${att.localId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("feedback-attachments")
        .upload(path, att.file, { contentType: att.file.type, upsert: false });
      setAttachments((prev) => prev.map((a) => a.localId === att.localId ? {
        ...a,
        uploading: false,
        uploadedPath: upErr ? undefined : path,
        error: upErr ? upErr.message : undefined,
      } : a));
    }));
  }

  async function removeAttachment(att: Attachment) {
    if (att.uploadedPath) {
      await supabase.storage.from("feedback-attachments").remove([att.uploadedPath]);
    }
    URL.revokeObjectURL(att.previewUrl);
    setAttachments((prev) => prev.filter((a) => a.localId !== att.localId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!title.trim()) return setError("제목을 입력하세요");
    if (!body.trim()) return setError("내용을 입력하세요");
    if (attachments.some((a) => a.uploading)) return setError("이미지 업로드가 끝날 때까지 기다려주세요");
    const ready = attachments.filter((a) => a.uploadedPath);

    setSubmitting(true);
    const payload = ready.map((a) => ({
      file_path: a.uploadedPath!,
      file_name: a.file.name,
      mime_type: a.file.type,
      size_bytes: a.file.size,
    }));

    const { data, error: rpcErr } = await supabase.rpc("create_feedback_post", {
      p_title: title.trim(),
      p_body: body.trim(),
      p_is_private: isPrivate,
      p_attachments: payload,
    });

    setSubmitting(false);
    if (rpcErr) {
      setError(`등록 실패: ${rpcErr.message}`);
      return;
    }
    const newId = data as string;
    router.replace(`/feedback/${newId}`);
  }

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={pageStyle}>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button onClick={() => router.replace("/feedback")} style={backBtnStyle}>←</button>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>새 글 작성</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>제목 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 주보 PDF가 안 열려요"
              maxLength={100}
              style={{ ...inputStyle, marginTop: 6 }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>내용 *</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="언제, 어디서, 어떤 일이 있었는지 알려주세요. 스크린샷을 함께 첨부해주시면 더 빠르게 해결할 수 있습니다."
              rows={8}
              style={{ ...inputStyle, marginTop: 6, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>이미지 첨부 (선택, 최대 {MAX_FILES}장)</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8, marginTop: 6 }}>
              {attachments.map((att) => (
                <div key={att.localId} style={thumbWrap}>
                  <img src={att.previewUrl} alt="" style={thumbImg} />
                  {att.uploading && <div style={thumbOverlay}>업로드중...</div>}
                  {att.error && <div style={{ ...thumbOverlay, background: "rgba(168, 68, 60, 0.8)" }}>{att.error}</div>}
                  <button type="button" onClick={() => removeAttachment(att)} style={thumbRemove}>×</button>
                </div>
              ))}
              {attachments.length < MAX_FILES && (
                <button type="button" onClick={pickFiles} style={addThumbBtn}>＋ 이미지</button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFilesChange} style={{ display: "none" }} />
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--surface)", borderRadius: 10, cursor: "pointer", fontSize: 13, color: "var(--ink-mid)", fontWeight: 600, marginBottom: 14 }}>
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
            🔒 비공개 글 (다른 사용자에게는 제목/내용이 보이지 않음. 관리자와 본인만 열람 가능)
          </label>

          {error && <div style={errorStyle}>⚠️ {error}</div>}

          <button type="submit" disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.6 : 1 }}>
            {submitting ? "등록 중..." : "등록하기"}
          </button>
        </form>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, #EFF5F7 0%, var(--warning-soft) 100%)",
  padding: "20px 16px 60px",
  fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
};
const cardStyle: React.CSSProperties = {
  maxWidth: 640, margin: "0 auto",
  background: "rgba(255,255,255,0.92)",
  borderRadius: 16, padding: 20,
  boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
};
const backBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, background: "var(--bg-soft)",
  border: "none", fontSize: 16, cursor: "pointer", color: "var(--ink-mid)",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", letterSpacing: 0.3,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", fontSize: 14,
  background: "#fff", border: "1.5px solid var(--hairline)", borderRadius: 10,
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  color: "var(--ink)", fontWeight: 500,
};
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "14px 16px", fontSize: 15, fontWeight: 800,
  color: "#fff", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  border: "none", borderRadius: 12, cursor: "pointer",
  boxShadow: "0 8px 20px rgba(62, 90, 74,0.3)", fontFamily: "inherit",
};
const errorStyle: React.CSSProperties = {
  padding: "10px 14px", background: "var(--danger-soft)", border: "1px solid var(--danger-soft)",
  borderRadius: 10, fontSize: 12, color: "var(--danger)", marginBottom: 12,
};
const thumbWrap: React.CSSProperties = {
  position: "relative", aspectRatio: "1", borderRadius: 10,
  overflow: "hidden", border: "1.5px solid var(--hairline)", background: "var(--surface)",
};
const thumbImg: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const thumbOverlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)",
  color: "#fff", fontSize: 10, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 6, textAlign: "center",
};
const thumbRemove: React.CSSProperties = {
  position: "absolute", top: 4, right: 4, width: 22, height: 22,
  borderRadius: "50%", border: "none", background: "rgba(43, 39, 34,0.7)",
  color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", lineHeight: 1,
};
const addThumbBtn: React.CSSProperties = {
  aspectRatio: "1", border: "2px dashed var(--hairline-strong)", background: "var(--surface)",
  borderRadius: 10, fontSize: 12, fontWeight: 700, color: "var(--ink-soft)",
  cursor: "pointer", fontFamily: "inherit",
};
