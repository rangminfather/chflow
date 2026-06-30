"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import HeaderLogo from "@/components/HeaderLogo";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ConfirmDialog";
import { LoadingView, EmptyState } from "@/components/StatusViews";
import { Megaphone, Pin, PinOff, Trash2, FileText, Download, AlertTriangle, X, Send, Lock } from "lucide-react";

type Att = { id: string; file_path: string; file_name: string; mime_type: string | null; size_bytes: number | null };
type Person = { id: string; name: string | null; sub_role: string | null };
type Comment = { id: string; parent_comment_id: string | null; body: string; is_mine: boolean; can_delete: boolean; created_at: string; author: Person; attachments: Att[] };
type Notice = {
  id: string; notice_no: number; department_id: string; title: string; body: string;
  is_pinned: boolean; teachers_only: boolean; is_mine: boolean; my_grade: number;
  can_manage: boolean; can_reply: boolean;
  created_at: string; updated_at: string;
  author: Person; attachments: Att[]; comments: Comment[];
};

type Upload = { localId: string; file: File; isImage: boolean; previewUrl?: string; uploadedPath?: string; uploading: boolean; error?: string };

const BUCKET = "dept-notice-attachments";
const MAX_REPLY_FILES = 4;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function fmtSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function DeptNoticeDetailPage() {
  const router = useRouter();
  const { confirm } = useConfirm();
  const params = useParams();
  const deptId = params.id as string;
  const noticeId = params.noticeId as string;
  const boardUrl = `/departments/d/${deptId}/notices/board`;

  const [authChecked, setAuthChecked] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({});
  // signed는 이제 사용되지 않지만 AttachmentList 인터페이스 호환을 위해 유지

  const [reply, setReply] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [posting, setPosting] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [nestedReply, setNestedReply] = useState("");
  const [postingNestedReply, setPostingNestedReply] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcErr } = await supabase.rpc("get_dept_notice", { p_notice_id: noticeId });
    if (rpcErr) {
      setError(rpcErr.message);
      setNotice(null);
      setLoading(false);
      return;
    }
    if (!data) {
      setError("공지를 찾을 수 없습니다");
      setNotice(null);
      setLoading(false);
      return;
    }
    const n = data as Notice;
    setNotice(n);

    // API 라우트를 통해 파일을 서빙하므로 서명 URL 대신 프록시 URL 사용
    const paths = [
      ...n.attachments.map((a) => a.file_path),
      ...n.comments.flatMap((c) => c.attachments.map((a) => a.file_path)),
    ];
    if (paths.length) {
      const map: Record<string, string> = {};
      paths.forEach((p) => { map[p] = `/api/storage/${BUCKET}/${p}`; });
      setSigned(map);
    }
    setLoading(false);
  }, [noticeId]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login");
        return;
      }
      setUserId(session.user.id);
      setAuthChecked(true);
      await load();
    })();
  }, [router, load]);

  function pickFiles() { fileInputRef.current?.click(); }

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !userId) return;
    if (uploads.length + files.length > MAX_REPLY_FILES) {
      setError(`첨부는 최대 ${MAX_REPLY_FILES}개까지 가능합니다`);
      return;
    }
    const newOnes: Upload[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) { setError(`파일 크기는 10MB 이하여야 합니다: ${f.name}`); continue; }
      const isImage = f.type.startsWith("image/");
      newOnes.push({ localId: crypto.randomUUID(), file: f, isImage, previewUrl: isImage ? URL.createObjectURL(f) : undefined, uploading: true });
    }
    if (!newOnes.length) return;
    setUploads((prev) => [...prev, ...newOnes]);
    await Promise.all(newOnes.map(async (att) => {
      const ext = att.file.name.split(".").pop() || "bin";
      const path = `${userId}/dept-notice/${Date.now()}_${att.localId}.${ext}`;
      const form = new FormData();
      form.append("file", att.file);
      const uploadRes = await fetch(`/api/storage/${BUCKET}/${path}`, { method: "POST", body: form });
      const uploadResult = await uploadRes.json();
      const upErr = uploadResult.ok ? null : (uploadResult.error ?? "업로드 실패");
      setUploads((prev) => prev.map((a) => a.localId === att.localId ? { ...a, uploading: false, uploadedPath: upErr ? undefined : path, error: upErr ? String(upErr) : undefined } : a));
    }));
  }

  async function removeUpload(att: Upload) {
    if (att.uploadedPath) {
      await fetch(`/api/storage/${BUCKET}/${encodeURIComponent(att.uploadedPath)}`, { method: "DELETE" });
    }
    if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
    setUploads((prev) => prev.filter((a) => a.localId !== att.localId));
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!reply.trim()) return setError("답글 내용을 입력하세요");
    if (uploads.some((a) => a.uploading)) return setError("첨부 업로드가 끝날 때까지 기다려주세요");
    setPosting(true);
    const payload = uploads.filter((a) => a.uploadedPath).map((a) => ({
      file_path: a.uploadedPath!, file_name: a.file.name, mime_type: a.file.type, size_bytes: a.file.size,
    }));
    const { error: rpcErr } = await supabase.rpc("add_dept_notice_comment", {
      p_notice_id: noticeId, p_body: reply.trim(), p_attachments: payload,
    });
    setPosting(false);
    if (rpcErr) { setError(`답글 등록 실패: ${rpcErr.message}`); return; }
    setReply("");
    uploads.forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl));
    setUploads([]);
    await load();
  }

  async function submitNestedReply(e: React.FormEvent, parentCommentId: string) {
    e.preventDefault();
    setError("");
    if (!nestedReply.trim()) return setError("대댓글 내용을 입력하세요");
    setPostingNestedReply(true);
    const { error: rpcErr } = await supabase.rpc("add_dept_notice_comment", {
      p_notice_id: noticeId,
      p_body: nestedReply.trim(),
      p_attachments: [],
      p_parent_comment_id: parentCommentId,
    });
    setPostingNestedReply(false);
    if (rpcErr) { setError(`대댓글 등록 실패: ${rpcErr.message}`); return; }
    setNestedReply("");
    setReplyingToId(null);
    await load();
  }

  async function removeComment(commentId: string) {
    const reason = window.prompt("삭제 사유를 입력하세요. (선택사항, 취소를 누르면 삭제하지 않습니다)", "");
    if (reason === null) return;
    setError("");
    setDeletingCommentId(commentId);
    const { error: rpcErr } = await supabase.rpc("delete_dept_notice_comment", {
      p_comment_id: commentId,
      p_reason: reason.trim() || null,
    });
    setDeletingCommentId(null);
    if (rpcErr) { setError(`댓글 삭제 실패: ${rpcErr.message}`); return; }
    if (replyingToId === commentId) {
      setReplyingToId(null);
      setNestedReply("");
    }
    await load();
  }

  async function togglePin() {
    if (!notice) return;
    const { error: e } = await supabase.rpc("toggle_dept_notice_pin", { p_notice_id: noticeId, p_pinned: !notice.is_pinned });
    if (e) { setError(e.message); return; }
    await load();
  }

  async function removeNotice() {
    if (!await confirm("이 공지를 삭제할까요?")) return;
    const { error: e } = await supabase.rpc("delete_dept_notice", { p_notice_id: noticeId });
    if (e) { setError(e.message); return; }
    router.replace(boardUrl);
  }

  if (!authChecked) return <LoadingView full />;

  return (
    <div style={pageStyle}>
      <div className="app-subpage-header" style={headerStyle}>
        <HeaderLogo />
        <button className="app-header-back" onClick={() => router.push(boardUrl)} style={backBtnStyle}>← 게시판</button>
        <div style={{ ...titleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Megaphone size={18} strokeWidth={1.8} /> 공지
        </div>
        <div style={{ width: 80 }} />
      </div>

      <main className="mx-auto w-full max-w-3xl px-4 py-5">
        {loading ? (
          <LoadingView padding={60} />
        ) : !notice ? (
          <EmptyState message="공지를 불러오지 못했습니다" hint={error} padding={60} />
        ) : (
          <>
            {/* 원문 */}
            <article className="rounded-lg border border-hairline bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <h1 className="min-w-0 text-[20px] font-extrabold leading-snug text-ink">
                  {notice.is_pinned && <Pin size={16} strokeWidth={2} fill="currentColor" className="mr-1 inline text-accent align-[-2px]" />}
                  {notice.title}
                  {notice.teachers_only && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 align-[2px] text-[12px] font-bold text-accent" style={{ background: "var(--accent-soft)" }}>
                      <Lock size={11} strokeWidth={2.5} /> 선생님만
                    </span>
                  )}
                </h1>
                {notice.can_manage && (
                  <div className="flex shrink-0 gap-1">
                    {notice.my_grade <= 2 && (
                      <button type="button" onClick={togglePin} title={notice.is_pinned ? "고정 해제" : "상단 고정"} className="rounded-md p-2 text-ink-soft hover:bg-surface">
                        {notice.is_pinned ? <PinOff size={17} strokeWidth={1.8} /> : <Pin size={17} strokeWidth={1.8} />}
                      </button>
                    )}
                    <button type="button" onClick={removeNotice} title="삭제" className="rounded-md p-2 text-ink-soft hover:bg-surface">
                      <Trash2 size={17} strokeWidth={1.8} />
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ink-soft">
                <span className="tabular-nums text-ink-faint">#{notice.notice_no}</span>
                <span className="text-ink-mid">{notice.author.name || "작성자"}</span>
                {notice.author.sub_role && <span className="text-ink-faint">· {notice.author.sub_role}</span>}
                <span className="text-ink-faint">· {fmtDateTime(notice.created_at)}</span>
              </div>

              {notice.body && (
                <div className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{notice.body}</div>
              )}

              {notice.attachments.length > 0 && (
                <div className="mt-4 border-t border-hairline pt-4">
                  <AttachmentList atts={notice.attachments} signed={signed} />
                </div>
              )}
            </article>

            {/* 답글 */}
            <section className="mt-4">
              <div className="mb-2 px-1 text-[14px] font-bold text-ink-soft">답글 {notice.comments.length}</div>
              <div className="flex flex-col gap-2">
                {notice.comments.length === 0 ? (
                  <div className="rounded-lg border border-hairline bg-card px-4 py-6 text-center text-[14px] text-ink-faint">첫 답글을 남겨보세요.</div>
                ) : notice.comments.filter((comment) => !comment.parent_comment_id).map((c) => (
                  <div key={c.id}>
                  <div className="rounded-lg border border-hairline bg-card p-4">
                    <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ink-soft">
                      <span className="text-ink-mid">{c.author.name || "멤버"}</span>
                      {c.author.sub_role && <span className="text-ink-faint">· {c.author.sub_role}</span>}
                      <span className="text-ink-faint">· {fmtDateTime(c.created_at)}</span>
                      {c.is_mine && <span className="rounded px-1.5 py-0.5 text-[11px] font-bold text-accent" style={{ background: "var(--accent-soft)" }}>내 답글</span>}
                    </div>
                    <div className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-7 text-ink">{c.body}</div>
                    {c.attachments.length > 0 && (
                      <div className="mt-3"><AttachmentList atts={c.attachments} signed={signed} /></div>
                    )}
                    <div className="mt-2 flex justify-end gap-1.5">
                      {notice.can_reply && (
                        <button type="button" onClick={() => {
                          setReplyingToId(replyingToId === c.id ? null : c.id);
                          setNestedReply("");
                        }} className="rounded-md border border-hairline px-2.5 py-1.5 text-[12px] font-bold text-ink-soft hover:bg-surface">
                          ↳ 답글
                        </button>
                      )}
                      {c.can_delete && (
                        <button type="button" disabled={deletingCommentId === c.id} onClick={() => removeComment(c.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-hairline px-2.5 py-1.5 text-[12px] font-bold text-danger hover:bg-danger-soft">
                          <Trash2 size={13} strokeWidth={1.8} /> {deletingCommentId === c.id ? "삭제 중" : "삭제"}
                        </button>
                      )}
                    </div>
                    {replyingToId === c.id && (
                      <form onSubmit={(e) => submitNestedReply(e, c.id)} className="mt-3 border-t border-hairline pt-3">
                        <textarea value={nestedReply} onChange={(e) => setNestedReply(e.target.value)} rows={2}
                          placeholder={`${c.author.name || "작성자"}님에게 답글`} style={inputStyle} />
                        <div className="mt-2 flex justify-end gap-2">
                          <button type="button" onClick={() => { setReplyingToId(null); setNestedReply(""); }}
                            className="rounded-md border border-hairline px-3 py-2 text-[12px] font-bold text-ink-soft">취소</button>
                          <button type="submit" disabled={postingNestedReply}
                            className="rounded-md px-3 py-2 text-[12px] font-bold text-white" style={{ background: "var(--accent)", opacity: postingNestedReply ? 0.6 : 1 }}>
                            {postingNestedReply ? "등록 중" : "대댓글 등록"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                  {notice.comments.filter((child) => child.parent_comment_id === c.id).map((child) => (
                    <div key={child.id} className="ml-5 mt-2 rounded-lg border border-hairline border-l-[3px] border-l-accent-line bg-surface p-4">
                      <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-semibold text-ink-soft">
                        <span className="text-ink-faint">↳</span>
                        <span className="text-ink-mid">{child.author.name || "멤버"}</span>
                        {child.author.sub_role && <span className="text-ink-faint">· {child.author.sub_role}</span>}
                        <span className="text-ink-faint">· {fmtDateTime(child.created_at)}</span>
                        {child.is_mine && <span className="rounded px-1.5 py-0.5 text-[11px] font-bold text-accent" style={{ background: "var(--accent-soft)" }}>내 대댓글</span>}
                      </div>
                      <div className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-7 text-ink">{child.body}</div>
                      {child.can_delete && (
                        <div className="mt-2 flex justify-end">
                          <button type="button" disabled={deletingCommentId === child.id} onClick={() => removeComment(child.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-hairline px-2.5 py-1.5 text-[12px] font-bold text-danger hover:bg-danger-soft">
                            <Trash2 size={13} strokeWidth={1.8} /> {deletingCommentId === child.id ? "삭제 중" : "삭제"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  </div>
                ))}
              </div>
            </section>

            {/* 답글 작성 */}
            {notice.can_reply && (
              <form onSubmit={submitReply} className="mt-4 rounded-lg border border-hairline bg-card p-4">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="답글을 입력하세요 (실명으로 등록됩니다)"
                  rows={3}
                  style={inputStyle}
                />
                {uploads.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8, marginTop: 8 }}>
                    {uploads.map((att) => (
                      <div key={att.localId} style={thumbWrap}>
                        {att.isImage && att.previewUrl ? <img src={att.previewUrl} alt="" style={thumbImg} /> : (
                          <div style={fileThumb}><FileText size={20} strokeWidth={1.6} /><span style={fileName}>{att.file.name}</span></div>
                        )}
                        {att.uploading && <div style={thumbOverlay}>업로드중</div>}
                        {att.error && <div style={{ ...thumbOverlay, background: "rgba(168,68,60,0.8)" }}>오류</div>}
                        <button type="button" onClick={() => removeUpload(att)} style={thumbRemove}><X size={12} strokeWidth={2.5} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)", display: "inline-flex", alignItems: "center", gap: 6 }}><AlertTriangle size={13} /> {error}</div>}
                <div className="mt-2 flex items-center justify-between">
                  <button type="button" onClick={pickFiles} className="rounded-md px-3 py-2 text-[13px] font-semibold text-ink-soft hover:bg-surface">＋ 첨부</button>
                  <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.hwp,.txt" multiple onChange={handleFilesChange} style={{ display: "none" }} />
                  <button type="submit" disabled={posting} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[14px] font-bold text-white" style={{ background: "var(--accent)", opacity: posting ? 0.6 : 1 }}>
                    <Send size={15} strokeWidth={2} /> {posting ? "등록 중..." : "답글 등록"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function AttachmentList({ atts, signed }: { atts: Att[]; signed: Record<string, string> }) {
  const images = atts.filter((a) => (a.mime_type || "").startsWith("image/"));
  const files = atts.filter((a) => !(a.mime_type || "").startsWith("image/"));
  return (
    <div className="flex flex-col gap-3">
      {images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
          {images.map((a) => {
            const url = signed[a.file_path];
            return url ? (
              <a key={a.id} href={url} target="_blank" rel="noreferrer" style={imgWrap}>
                <img src={url} alt={a.file_name} style={thumbImg} />
              </a>
            ) : <div key={a.id} style={imgWrap} />;
          })}
        </div>
      )}
      {files.map((a) => {
        const url = signed[a.file_path];
        return (
          <a key={a.id} href={url || "#"} target="_blank" rel="noreferrer" download={a.file_name}
            className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-[14px] font-semibold text-ink hover:border-accent-line">
            <FileText size={16} strokeWidth={1.8} className="shrink-0 text-ink-soft" />
            <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
            <span className="shrink-0 text-[12px] text-ink-faint">{fmtSize(a.size_bytes)}</span>
            <Download size={15} strokeWidth={1.8} className="shrink-0 text-ink-soft" />
          </a>
        );
      })}
    </div>
  );
}

const pageStyle: React.CSSProperties = { minHeight: "100vh", background: "var(--bg-soft)", fontFamily: "'Noto Sans KR', sans-serif" };
const headerStyle: React.CSSProperties = { background: "var(--card)", borderBottom: "1px solid var(--hairline)", padding: "10px clamp(12px,4vw,20px)", display: "flex", alignItems: "center", justifyContent: "space-between" };
const titleStyle: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 };
const backBtnStyle: React.CSSProperties = { padding: "8px 14px", background: "var(--bg-soft)", border: "none", borderRadius: 8, fontSize: 14, color: "var(--ink-mid)", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 14px", fontSize: 14, background: "var(--card)", border: "1.5px solid var(--hairline)", borderRadius: 10, outline: "none", fontFamily: "inherit", boxSizing: "border-box", color: "var(--ink)", fontWeight: 500, resize: "vertical", lineHeight: 1.6 };
const thumbWrap: React.CSSProperties = { position: "relative", aspectRatio: "1", borderRadius: 10, overflow: "hidden", border: "1.5px solid var(--hairline)", background: "var(--surface)" };
const imgWrap: React.CSSProperties = { aspectRatio: "1", borderRadius: 10, overflow: "hidden", border: "1.5px solid var(--hairline)", background: "var(--surface)", display: "block" };
const thumbImg: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const fileThumb: React.CSSProperties = { width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: 6, color: "var(--ink-soft)", textAlign: "center" };
const fileName: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "var(--ink-mid)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" };
const thumbOverlay: React.CSSProperties = { position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" };
const thumbRemove: React.CSSProperties = { position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", border: "none", background: "rgba(43,39,34,0.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
