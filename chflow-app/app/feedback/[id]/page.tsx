"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { LoadingView } from "@/components/StatusViews";
import { useConfirm } from "@/components/ConfirmDialog";
import { Lock, AlertTriangle, MessageSquare, Reply, Trash2 } from "lucide-react";

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
  parent_comment_id: string | null;
  body: string;
  is_admin_reply: boolean;
  is_mine: boolean;
  can_delete: boolean;
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

const STATUS_META: Record<FeedbackStatus, { label: string; desc: string; bg: string; fg: string }> = {
  submitted: { label: "미접수", desc: "접수된 내용을 운영자가 확인하기 전 입니다.", bg: "var(--danger-soft)", fg: "var(--danger)" },
  received:  { label: "접수",   desc: "접수된 내용을 운영자가 확인했습니다.", bg: "var(--warning-soft)", fg: "var(--warning)" },
  reviewing: { label: "검토중", desc: "접수된 내용에 대해 조치중입니다.", bg: "var(--accent-soft)", fg: "var(--accent-strong)" },
  resolved:  { label: "처리완료", desc: "접수된 내용에 대한 처리가 완료되었습니다.", bg: "var(--success-soft)", fg: "var(--success)" },
  rejected:  { label: "처리불가", desc: "접수된 내용에 대해 처리가 불가합니다.", bg: "var(--hairline)", fg: "var(--ink-mid)" },
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
  const { confirm } = useConfirm();
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
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [nestedReplyBody, setNestedReplyBody] = useState("");
  const [submittingNestedReply, setSubmittingNestedReply] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 이미지 뷰어
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  }, [postId]);

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
  }, [load, router]);

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

  function proxyUrl(path: string): string {
    return `/api/storage/feedback-attachments/${path}`;
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
      const form = new FormData();
      form.append("file", att.file);
      const uploadRes = await fetch(`/api/storage/feedback-attachments/${path}`, { method: "POST", body: form });
      const uploadResult = await uploadRes.json();
      const upErr = uploadResult.ok ? null : (uploadResult.error ?? "업로드 실패");
      setCommentAtts((prev) => prev.map((a) => a.localId === att.localId ? {
        ...a,
        uploading: false,
        uploadedPath: upErr ? undefined : path,
        error: upErr ? String(upErr) : undefined,
      } : a));
    }));
  }

  async function removeCommentAtt(att: LocalAtt) {
    if (att.uploadedPath) {
      await fetch(`/api/storage/feedback-attachments/${encodeURIComponent(att.uploadedPath)}`, { method: "DELETE" });
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

  async function submitNestedReply(e: React.FormEvent, parentCommentId: string) {
    e.preventDefault();
    setError("");
    if (!nestedReplyBody.trim()) return setError("대댓글 내용을 입력하세요");
    setSubmittingNestedReply(true);
    const { error: rpcErr } = await supabase.rpc("add_feedback_comment", {
      p_post_id: postId,
      p_body: nestedReplyBody.trim(),
      p_attachments: [],
      p_parent_comment_id: parentCommentId,
    });
    setSubmittingNestedReply(false);
    if (rpcErr) {
      setError(`대댓글 등록 실패: ${rpcErr.message}`);
      return;
    }
    setNestedReplyBody("");
    setReplyingToId(null);
    await load();
  }

  async function deleteComment(commentId: string) {
    const reason = window.prompt("삭제 사유를 입력하세요. (선택사항, 취소를 누르면 삭제하지 않습니다)", "");
    if (reason === null) return;
    setError("");
    setDeletingCommentId(commentId);
    const { error: rpcErr } = await supabase.rpc("delete_feedback_comment", {
      p_comment_id: commentId,
      p_reason: reason.trim() || null,
    });
    setDeletingCommentId(null);
    if (rpcErr) {
      setError(`댓글 삭제 실패: ${rpcErr.message}`);
      return;
    }
    if (replyingToId === commentId) {
      setReplyingToId(null);
      setNestedReplyBody("");
    }
    await load();
  }

  async function changeStatus(next: FeedbackStatus) {
    if (!post) return;
    if (post.status === next) return;
    // 확정 확인 — 실수로 여러 번 누르는 것을 방지. 확정 시 작성자에게 알림 발송됨.
    const notice = post.is_mine ? "" : "\n확정하면 작성자에게 알림이 발송됩니다.";
    const ok = await confirm(
      `처리 상태를 '${STATUS_META[post.status].label}' → '${STATUS_META[next].label}'(으)로 변경하시겠습니까?${notice}`,
    );
    if (!ok) return;
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

  if (loading) return <LoadingView full />;
  if (!post) return (
    <div style={loadingStyle}>
      <div>{error || "게시글을 찾을 수 없습니다"}</div>
      <button onClick={() => router.replace("/feedback")} style={{ ...backBtnStyle, marginTop: 16, width: "auto", padding: "8px 16px" }}>목록으로</button>
    </div>
  );

  const meta = STATUS_META[post.status];
  const topLevelComments = post.comments.filter((comment) => !comment.parent_comment_id);

  return (
    <div style={pageStyle}>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button onClick={() => router.replace("/feedback")} style={backBtnStyle}>←</button>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-mid)" }}>불편신고 / 건의</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={seqBadge}>#{post.seq}</span>
          {post.is_private && <span style={{ ...lockBadge, display: "inline-flex", alignItems: "center", gap: 4 }}><Lock size={12} strokeWidth={1.8} /> 비공개</span>}
          <span title={meta.desc} style={{
            padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800,
            background: meta.bg, color: meta.fg, cursor: "help",
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
              const url = proxyUrl(a.file_path);
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
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-mid)", marginBottom: 8 }}>처리 상태 변경 (관리자)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STATUSES.map((s) => {
                const sm = STATUS_META[s];
                const active = post.status === s;
                return (
                  <button
                    key={s}
                    title={sm.desc}
                    disabled={updatingStatus || active}
                    onClick={() => changeStatus(s)}
                    style={{
                      padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800,
                      cursor: active ? "default" : "pointer",
                      border: active ? `1.5px solid ${sm.fg}` : "1.5px solid transparent",
                      background: active ? sm.bg : "var(--card)",
                      color: active ? sm.fg : "var(--ink-soft)",
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
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-mid)", marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <MessageSquare size={14} strokeWidth={1.8} /> 댓글 {post.comments.length}개
          </div>
          {post.comments.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>
              아직 댓글이 없습니다
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topLevelComments.map((c) => (
              <div key={c.id}>
                <div style={{
                padding: 12,
                borderRadius: 12,
                background: c.is_admin_reply ? "var(--accent-soft)" : "var(--surface)",
                border: c.is_admin_reply ? "1px solid var(--accent-line)" : "1px solid var(--hairline)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                  {c.is_admin_reply && <span style={{ padding: "2px 6px", borderRadius: 6, background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 800 }}>관리자</span>}
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{c.author?.name || "익명"}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>· {formatDate(c.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.body}</div>
                {c.attachments.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6, marginTop: 8 }}>
                    {c.attachments.map((a) => {
                      const url = proxyUrl(a.file_path);
                      return (
                        <button key={a.id} type="button" onClick={() => setViewerUrl(url)} style={attBtn}>
                          <img src={url} alt={a.file_name} style={attImg} />
                        </button>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
                  {(post.is_mine || post.is_admin) && (
                    <button type="button" onClick={() => {
                      setReplyingToId(replyingToId === c.id ? null : c.id);
                      setNestedReplyBody("");
                    }} style={commentActionBtn}>
                      <Reply size={13} strokeWidth={1.8} /> 답글
                    </button>
                  )}
                  {c.can_delete && (
                    <button type="button" disabled={deletingCommentId === c.id} onClick={() => deleteComment(c.id)} style={{ ...commentActionBtn, color: "var(--danger)" }}>
                      <Trash2 size={13} strokeWidth={1.8} /> {deletingCommentId === c.id ? "삭제 중" : "삭제"}
                    </button>
                  )}
                </div>
                {replyingToId === c.id && (
                  <form onSubmit={(e) => submitNestedReply(e, c.id)} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--hairline)" }}>
                    <textarea value={nestedReplyBody} onChange={(e) => setNestedReplyBody(e.target.value)} rows={2}
                      placeholder={`${c.author?.name || "작성자"}님에게 답글`}
                      style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                      <button type="button" onClick={() => { setReplyingToId(null); setNestedReplyBody(""); }} style={commentActionBtn}>취소</button>
                      <button type="submit" disabled={submittingNestedReply} style={{ ...commentActionBtn, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}>
                        {submittingNestedReply ? "등록 중" : "대댓글 등록"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
              {post.comments.filter((reply) => reply.parent_comment_id === c.id).map((child) => (
                <div key={child.id} style={{ marginTop: 6, marginLeft: 20, padding: 12, borderRadius: 12, background: child.is_admin_reply ? "var(--accent-soft)" : "var(--card)", border: "1px solid var(--hairline)", borderLeft: "3px solid var(--accent-line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                    <Reply size={12} strokeWidth={1.8} color="var(--ink-faint)" />
                    {child.is_admin_reply && <span style={{ padding: "2px 6px", borderRadius: 6, background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 800 }}>관리자</span>}
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{child.author?.name || "익명"}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>· {formatDate(child.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{child.body}</div>
                  {child.can_delete && (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                      <button type="button" disabled={deletingCommentId === child.id} onClick={() => deleteComment(child.id)} style={{ ...commentActionBtn, color: "var(--danger)" }}>
                        <Trash2 size={13} strokeWidth={1.8} /> {deletingCommentId === child.id ? "삭제 중" : "삭제"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              </div>
            ))}
          </div>
        </div>

        {/* 댓글 입력 (작성자 or 관리자) */}
        {(post.is_mine || post.is_admin) && (
          <form onSubmit={submitComment} style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--hairline)" }}>
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
                  {att.error && <div style={{ ...thumbOverlay, background: "rgba(168, 68, 60, 0.8)" }}>{att.error}</div>}
                  <button type="button" onClick={() => removeCommentAtt(att)} style={thumbRemove}>×</button>
                </div>
              ))}
              {commentAtts.length < MAX_FILES && (
                <button type="button" onClick={pickFiles} style={addThumbBtn}>＋ 이미지</button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFilesChange} style={{ display: "none" }} />

            {error && <div style={{ ...errorStyle, display: "inline-flex", alignItems: "center", gap: 6, width: "100%" }}><AlertTriangle size={14} strokeWidth={1.8} /> {error}</div>}

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
  background: "linear-gradient(135deg, var(--info-soft) 0%, var(--warning-soft) 100%)",
  padding: "20px 16px 60px",
  fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
};
const cardStyle: React.CSSProperties = {
  maxWidth: 720, margin: "0 auto",
  background: "color-mix(in srgb, var(--card) 92%, transparent)",
  borderRadius: 16, padding: 20,
  boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
};
const titleStyle: React.CSSProperties = {
  fontSize: 20, fontWeight: 800, color: "var(--ink)", margin: "4px 0 4px",
};
const metaRowStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--ink-faint)", marginBottom: 14, display: "flex", flexWrap: "wrap",
};
const bodyStyle: React.CSSProperties = {
  fontSize: 14, color: "var(--ink)", lineHeight: 1.7, whiteSpace: "pre-wrap",
  padding: "14px 16px", background: "var(--surface)", borderRadius: 12,
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
  background: "var(--card)", border: "1.5px solid var(--hairline)", borderRadius: 10,
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
  color: "var(--ink)", fontWeight: 500,
};
const commentActionBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 8px",
  border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--card)",
  color: "var(--ink-soft)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "12px 16px", fontSize: 14, fontWeight: 800,
  color: "#fff", background: "linear-gradient(135deg, var(--accent), var(--accent-muted))",
  border: "none", borderRadius: 12, cursor: "pointer",
  boxShadow: "0 6px 16px rgba(62, 90, 74,0.25)", fontFamily: "inherit",
};
const errorStyle: React.CSSProperties = {
  padding: "10px 14px", background: "var(--danger-soft)", border: "1px solid var(--danger-soft)",
  borderRadius: 10, fontSize: 12, color: "var(--danger)", marginTop: 10,
};
const loadingStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  minHeight: "100vh", color: "var(--ink-soft)", padding: 20, textAlign: "center",
};
const attBtn: React.CSSProperties = {
  aspectRatio: "1", border: "1px solid var(--hairline)", borderRadius: 10,
  overflow: "hidden", padding: 0, cursor: "pointer", background: "var(--card)",
};
const attImg: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const statusBoxStyle: React.CSSProperties = {
  marginTop: 16, padding: 14, background: "var(--warning-soft)",
  border: "1px solid #E0C893", borderRadius: 12,
};
const lockBadge: React.CSSProperties = {
  padding: "2px 8px", borderRadius: 6, background: "var(--warning-soft)",
  color: "var(--warning)", fontSize: 11, fontWeight: 700,
};
const seqBadge: React.CSSProperties = {
  padding: "2px 8px", borderRadius: 6, background: "var(--bg-soft)",
  color: "var(--ink-mid)", fontSize: 11, fontWeight: 800,
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
  borderRadius: 10, fontSize: 11, fontWeight: 700, color: "var(--ink-soft)",
  cursor: "pointer", fontFamily: "inherit",
};
const viewerStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 16, cursor: "zoom-out",
};
