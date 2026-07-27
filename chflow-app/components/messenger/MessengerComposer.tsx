"use client";

import Image from "next/image";
import { FileText, Paperclip, Send, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { MessengerAttachment, MessengerMessage } from "@/lib/messenger";

type PendingAttachment = MessengerAttachment & { local_url?: string };

type MessengerComposerProps = {
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  uploading: boolean;
  attachments: PendingAttachment[];
  setAttachments: Dispatch<SetStateAction<PendingAttachment[]>>;
  replyTarget: MessengerMessage | null;
  editing: MessengerMessage | null;
  onCancelContext: () => void;
  onSend: () => void;
  onTyping: () => void;
  onPickFiles: () => void;
  onPasteFiles: (files: File[]) => void;
  maxAttachments: number;
};

export default function MessengerComposer({
  draft, setDraft, sending, uploading, attachments, setAttachments, replyTarget, editing,
  onCancelContext, onSend, onTyping, onPickFiles, onPasteFiles, maxAttachments,
}: MessengerComposerProps) {
  const cannotSend = sending || uploading || (!draft.trim() && attachments.length === 0);

  return (
    <form className="messenger-composer" onSubmit={(event) => { event.preventDefault(); onSend(); }} style={composerStyle}>
      {(replyTarget || editing) && (
        <div style={composerContextStyle}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: "var(--accent)" }}>
              {editing ? "메시지 수정" : `${replyTarget?.sender_name || "메시지"}에게 답장`}
            </div>
            <div style={{ ...oneLineStyle, fontSize: 12, color: "var(--ink-soft)", marginTop: 2 }}>
              {editing?.body || replyTarget?.body || "첨부 메시지"}
            </div>
          </div>
          <button type="button" onClick={onCancelContext} style={contextCloseButtonStyle}><X size={14} /></button>
        </div>
      )}

      {attachments.length > 0 && !editing && (
        <div style={pendingAttachmentWrapStyle}>
          {attachments.map((attachment) => (
            <div key={attachment.file_path} style={pendingAttachmentStyle}>
              {attachment.local_url ? <Image src={attachment.local_url} alt="" width={24} height={24} unoptimized style={pendingThumbStyle} /> : <FileText size={17} />}
              <span style={oneLineStyle}>{attachment.file_name}</span>
              <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.file_path !== attachment.file_path))} style={chipRemoveStyle}>
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, minWidth: 0 }}>
        <button type="button" onClick={onPickFiles} disabled={uploading || sending || !!editing || attachments.length >= maxAttachments} title="첨부" style={composerIconButtonStyle}>
          {uploading ? "..." : <Paperclip size={18} strokeWidth={2} />}
        </button>
        <textarea
          value={draft}
          onChange={(event) => { setDraft(event.target.value); onTyping(); }}
          onPaste={(event) => { const files = Array.from(event.clipboardData.files || []); if (files.length > 0) onPasteFiles(files); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }}
          maxLength={4000}
          placeholder={editing ? "수정할 내용을 입력하세요" : "메시지를 입력하세요"}
          style={textareaStyle}
        />
        <button type="submit" disabled={cannotSend} style={{ ...sendButtonStyle, opacity: cannotSend ? 0.45 : 1 }}><Send size={18} strokeWidth={2} /></button>
      </div>
    </form>
  );
}

const oneLineStyle = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const composerStyle = { padding: "12px 12px calc(12px + env(safe-area-inset-bottom, 0px))", borderTop: "1px solid var(--hairline)", background: "color-mix(in srgb, var(--card) 92%, transparent)", backdropFilter: "blur(10px)", display: "grid", gap: 8, flexShrink: 0 } as const;
const composerContextStyle = { display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--hairline)", background: "var(--accent-soft)", borderRadius: 8, padding: "7px 8px" } as const;
const contextCloseButtonStyle = { width: 34, height: 34, borderRadius: 8, border: "1px solid var(--hairline)", background: "var(--card)", color: "var(--ink-mid)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 } as const;
const pendingAttachmentWrapStyle = { display: "flex", flexWrap: "wrap", gap: 6 } as const;
const pendingAttachmentStyle = { minWidth: 0, maxWidth: "min(220px, 100%)", height: 34, borderRadius: 8, background: "var(--bg-soft)", border: "1px solid var(--hairline)", display: "inline-flex", alignItems: "center", gap: 6, padding: "0 7px", fontSize: 12, fontWeight: 800, color: "var(--ink-mid)" } as const;
const pendingThumbStyle = { width: 24, height: 24, borderRadius: 5, objectFit: "cover" } as const;
const composerIconButtonStyle = { width: 44, height: 42, border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--surface)", color: "var(--ink-mid)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } as const;
const textareaStyle = { flex: 1, minWidth: 0, minHeight: 42, maxHeight: 130, resize: "none", border: "1px solid var(--hairline)", borderRadius: 10, padding: "10px 12px", fontSize: 14, lineHeight: 1.45, color: "var(--ink)", outline: "none", fontFamily: "inherit", background: "var(--surface)" } as const;
const sendButtonStyle = { width: 44, height: 42, border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 } as const;
const chipRemoveStyle = { width: 18, height: 18, border: "none", background: "transparent", color: "inherit", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 } as const;
