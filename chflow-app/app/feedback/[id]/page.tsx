"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type FeedbackStatus = "submitted" | "received" | "reviewing" | "resolved" | "rejected";

type Attachment = {
  id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
};

type Author = { id: string; name: string | null; sub_role: string | null };

type Comment = {
  id: string;
  body: string;
  is_admin_reply: boolean;
  is_mine: boolean;
  created_at: string;
  author: Author;
  attachments: Attachment[];
};

type PostDetail = {
  id: string;
  seq: number;
  title: string;
  body: string;
  status: FeedbackStatus;
  is_private: boolean;
  is_mine: boolean;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
  author: Author;
  attachments: Attachment[];
  comments: Comment[];
};

const STATUS_META: Record<FeedbackStatus, { label: string; bg: string; fg: string }> = {
  submitted: { label: "미접수", bg: "#fee2e2", fg: "#b91c1c" },
  received:  { label: "접수",   bg: "#fef3c7", fg: "#92400e" },
  reviewing: { label: "검토중", bg: "#dbeafe", fg: "#1e40af" },
  resolved:  { label: "처리완료", bg: "#dcfce7", fg: "#166534" },
  rejected:  { label: "처리불가", bg: "#e2e8f0", fg: "#475569" },
};

const STATUSES: FeedbackStatus[] = ["submitted", "received", "reviewing", "resolved", "rejected"];
const MAX_FILES = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

type LocalAtt = {
  localId: string;
  file: File;
  previewUrl: string;
  uploadedPath?: string;
  uploading: boolean;
  error?: string;
};

export default function FeedbackDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const postId = params?.id;

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 댓글 입력
  const [commentBody, setCommentBody] = useState("");
  const [commentAtts, setCommentAtts] = useState<LocalAtt[]>([]);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 이미지 뷰어
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setAuthUserId(session.user.id);
      await load();
    })();
    // eslint-disable-next-line
  }, []);

  // 페이지 진입 시 가드 entry 1개 추가
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ chflowFeedbackDetail: true }, "");
  }, []);

  // 뒤로가기: 뷰어 열려있으면 뷰어만 닫고 가드 보충, 아니면 목록으로
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      if (viewerUrl) {
        setViewerUrl(null);
        window.history.pushState({ chflowFeedbackDetail: true }, "");
        return;
      }
      router.replace("/feedback");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [viewerUrl, router]);

  async function load() {
    setLoading(true);
    const { data, error: e } = await supabase.rpc("get_feedback_post", { p_post_id: postId });
    if (e) {
      setError(e.message);
      setPost(null);
    } else if (!data) {
      setError("게시글을 찾을 수 없습니다");
      setPost(null);
    } else {
      setPost(data as PostDetail);
    }
    setLoading(false);
  }

  function publicUrl(path: string): string {
    const { data } = supabase.storage.from("feedback-attachments").getPublicUrl(path);
    return data.publicUrl;
  }

  function pickFiles() { fileInputRef.current?.click(); }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !authUserId) return;
    if (commentAtts.length + files.length > MAX_FILES) {
      setError(`이미지는 최대 ${MAX_FILES}장까지 첨부 가능합니다`);
      return;
    }
    const newOnes: LocalAtt[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
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
    setCommentAtts((prev) => [...prev, ...newOnes]);

    await Promise.all(newOnes.map(async (att) => {
      const ext = att.file.name.split(".").pop() || "png";
      const path = `${authUserId}/comments/${Date.now()}_${att.localId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("feedback-attachments")
        .upload(path, att.file, { contentType: att.file.type, upsert: false });
      setCommentAtts((prev) => prev.map((a) => a.localId === att.localId ? {
        ...a,
        uploading: false,
        uploadedPath: upErr ? undefined : path,
        error: upErr ? upErr.message : undefined,
      } : a));
    }));
  }

  async function removeCommentAtt(att: LocalAtt) {
    if (att.uploadedPath) {
      await supabase.storage.from("feedback-attachments").remove([att.uploadedPath]);
    }
    URL.revokeObjectURL(att.previewUrl);
    setCommentAtts((prev) => prev.filter((a) => a.localId !== att.localId));
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!commentBody.trim()) return setError("내용을 입력하세요");
    if (commentAtts.some((a) => a.uploading)) return setError("이미지 업로드가 끝날 때까지 기다려주세요");

    setSubmittingComment(true);
    const ready = commentAtts.filter((a) => a.uploadedPath);
    const payload = ready.map((a) => ({
      file_path: a.uploadedPath!,
      file_name: a.file.name,
      mime_type: a.file.type,
      size_bytes: a.file.size,
    }));

    const { error: rpcErr } = await supabase.rpc("add_feedback_comment", {
      p_post_id: postId,
      p_body: commentBody.trim(),
      p_attachments: payload,
    });

    setSubmittingComment(false);
    if (rpcErr) {
      setError(`댓글 등록 실패: ${rpcErr.message}`);
      return;
    }
    commentAtts.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setCommentBody("");
    setCommentAtts([]);
    await load();
  }

  async function changeStatus(next: FeedbackStatus) {
    if (!post) return;
    if (post.status === next) return;
    setUpdatingStatus(true);
    const { error: e } = await supabase.rpc("update_feedback_status", {
      p_post_id: postId,
      p_status: next,
    });
    setUpdatingStatus(false);
    if (e) {
      setError(`상태 변경 실패: ${e.message}`);
      return;
    }
    await load();
  }

  if (loading) return <div style={loadingStyle}>로딩 중...</div>;
  if (!post) return (
    <div style={loadingStyle}>
      <div>{error || "게시글을 찾을 수 없습니다"}</div>
      <button onClick={() => router.replace("/feedback")} style={{ ...backBtnStyle, marginTop: 16, width: "auto", padding: "8px 16px" }}>목록으로</button>
    </div>
  );

  const meta = STATUS_META[post.status];

  return (
    <div style={pageStyle}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button onClick={() => router.replace("/feedback")} style={backBtnStyle}>←</button>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#475569" }}>불편신고 / 건의</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={seqBadge}>#{post.seq}</span>
          {post.is_private && <span style={lockBadge}>🔒 비공개</span>}
          <span style={{
            padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800,
            background: meta.bg, color: meta.fg,
          }}>{meta.label}</span>
        </div>

        <h2 style={titleStyle}>{post.title}</h2>
        <div style={metaRowStyle}>
          <span>{post.author?.name || "익명"}{post.author?.sub_role ? ` · ${post.author.sub_role}` : ""}</span>
          <span> · {formatDate(post.created_at)}</span>
        </div>

        <div style={bodyStyle}>{post.body}</div>

        {post.attachments.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8, marginTop: 16 }}>
            {post.attachments.map((a) => {
              const url = publicUrl(a.file_path);
              return (
                <button key={a.id} type="button" onClick={() => setViewerUrl(url)} style={attBtn}>
                  <img src={url} alt={a.file_name} style={attImg} />
                </button>
              );
            })}
          </div>
        )}

        {/* 관리자 상태 변경 */}
        {post.is_admin && (
          <div style={statusBoxStyle}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 8 }}>처리 상태 변경 (관리자)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STATUSES.map((s) => {
                const sm = STATUS_META[s];
                const active = post.status === s;
                return (
                  <button
                    key={s}
                    disabled={updatingStatus || active}
                    onClick={() => changeStatus(s)}
                    style={{
                      padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800,
                      cursor: active ? "default" : "pointer",
                      border: active ? `1.5px solid ${sm.fg}` : "1.5px solid transparent",
                      background: active ? sm.bg : "#fff",
                      color: active ? sm.fg : "#64748b",
                      opacity: updatingStatus ? 0.5 : 1,
                      fontFamily: "inherit",
                    }}
                  >{sm.label}</button>
                );
              })}
            </div>
          </div>
        )}

        {/* 댓글 목록 */}
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#475569", marginBottom: 10 }}>
            💬 댓글 {post.comments.length}개
          </div>
          {post.comments.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              아직 댓글이 없습니다
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {post.comments.map((c) => (
              <div key={c.id} style={{
                padding: 12,
                borderRadius: 12,
                background: c.is_admin_reply ? "#eff6ff" : "#f8fafc",
                border: c.is_admin_reply ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  {c.is_admin_reply && <span style={{ padding: "2px 6px", borderRadius: 6, background: "#3b82f6", color: "#fff", fontSize: 10, fontWeight: 800 }}>관리자</span>}
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>{c.author?.name || "익명"}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>· {formatDate(c.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.body}</div>
                {c.attachments.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6, marginTop: 8 }}>
                    {c.attachments.map((a) => {
                      const url = publicUrl(a.file_path);
                      return (
                        <button key={a.id} type="button" onClick={() => setViewerUrl(url)} style={attBtn}>
                          <img src={url} alt={a.file_name} style={attImg} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 댓글 입력 (작성자 or 관리자) */}
        {(post.is_mine || post.is_admin) && (
          <form onSubmit={submitComment} style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid #e2e8f0" }}>
            <label style={labelStyle}>{post.is_admin && !post.is_mine ? "관리자 답변" : "댓글"}</label>
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="내용을 입력하세요"
              rows={3}
              style={{ ...inputStyle, marginTop: 6, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6, marginTop: 8 }}>
              {commentAtts.map((att) => (
                <div key={att.localId} style={thumbWrap}>
                  <img src={att.previewUrl} alt="" style={thumbImg} />
                  {att.uploading && <div style={thumbOverlay}>업로드중...</div>}
                  {att.error && <div style={{ ...thumbOverlay, background: "rgba(220, 38, 38, 0.8)" }}>{att.error}</div>}
                  <button type="button" onClick={() => removeCommentAtt(att)} style={thumbRemove}>×</button>
                </div>
              ))}
              {commentAtts.length < MAX_FILES && (
                <button type="button" onClick={pickFiles} style={addThumbBtn}>＋ 이미지</button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFilesChange} style={{ display: "none" }} />

            {error && <div style={errorStyle}>⚠️ {error}</div>}

            <button type="submit" disabled={submittingComment} style={{ ...primaryBtn, marginTop: 10, opacity: submittingComment ? 0.6 : 1 }}>
              {submittingComment ? "등록 중..." : "댓글 등록"}
            </button>
          </form>
        )}
      </div>

      {viewerUrl && (
        <div onClick={() => setViewerUrl(null)} style={viewerStyle}>
          <img src={viewerUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}일 전`;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(135deg, #f0f9ff 0%, #fef3c7 100%)",
  padding: "20px 16px 60px",
  fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
};
const cardStyle: React.CSSProperties = {
  maxWidth: 720, margin: "0 auto",
  background: "rgba(255,255,255,0.92)",
  borderRadius: 16, padding: 20,
  boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
};
const titleStyle: React.CSSProperties = {
  fontSize: 20, fontWeight: 900, color: "#1e293b", margin: "4px 0 4px",
};
const metaRowStyle: React.CSSProperties = {
  fontSize: 11, color: "#94a3b8", marginBottom: 14, display: "flex", flexWrap: "wrap",
};
const bodyStyle: React.CSSProperties = {
  fontSize: 14, color: "#1e293b", lineHeight: 1.7, whiteSpace: "pre-wrap",
  padding: "14px 16px", background: "#f8fafc", borderRadius: 12,
};
const backBtnStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10, background: "#f1f5f9",
  border: "none", fontSize: 16, cursor: "pointer", color: "#475569",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: 0.3,
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 14px", fontSize: 14,
  background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 10,
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  color: "#0f172a", fontWeight: 500,
};
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "12px 16px", fontSize: 14, fontWeight: 800,
  color: "#fff", background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
  border: "none", borderRadius: 12, cursor: "pointer",
  boxShadow: "0 6px 16px rgba(99,102,241,0.25)", fontFamily: "inherit",
};
const errorStyle: React.CSSProperties = {
  padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca",
  borderRadius: 10, fontSize: 12, color: "#b91c1c", marginTop: 10,
};
const loadingStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  minHeight: "100vh", color: "#64748b", padding: 20, textAlign: "center",
};
const attBtn: React.CSSProperties = {
  aspectRatio: "1", border: "1px solid #e2e8f0", borderRadius: 10,
  overflow: "hidden", padding: 0, cursor: "pointer", background: "#fff",
};
const attImg: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const statusBoxStyle: React.CSSProperties = {
  marginTop: 16, padding: 14, background: "#fefce8",
  border: "1px solid #fde047", borderRadius: 12,
};
const lockBadge: React.CSSProperties = {
  padding: "2px 8px", borderRadius: 6, background: "#fef3c7",
  color: "#92400e", fontSize: 11, fontWeight: 700,
};
const seqBadge: React.CSSProperties = {
  padding: "2px 8px", borderRadius: 6, background: "#f1f5f9",
  color: "#475569", fontSize: 11, fontWeight: 800,
};
const thumbWrap: React.CSSProperties = {
  position: "relative", aspectRatio: "1", borderRadius: 10,
  overflow: "hidden", border: "1.5px solid #e2e8f0", background: "#f8fafc",
};
const thumbImg: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const thumbOverlay: React.CSSProperties = {
  position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)",
  color: "#fff", fontSize: 10, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 6, textAlign: "center",
};
const thumbRemove: React.CSSProperties = {
  position: "absolute", top: 4, right: 4, width: 22, height: 22,
  borderRadius: "50%", border: "none", background: "rgba(15,23,42,0.7)",
  color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", lineHeight: 1,
};
const addThumbBtn: React.CSSProperties = {
  aspectRatio: "1", border: "2px dashed #cbd5e1", background: "#f8fafc",
  borderRadius: 10, fontSize: 11, fontWeight: 700, color: "#64748b",
  cursor: "pointer", fontFamily: "inherit",
};
const viewerStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 16, cursor: "zoom-out",
};
