"use client";

import { useEffect, type CSSProperties } from "react";
import Image from "next/image";
import { Download, X } from "lucide-react";
import { formatMessengerAttachmentMeta, type MessengerAttachmentMetadata } from "@/lib/messenger-utils";

type Props = {
  preview: { attachment: MessengerAttachmentMetadata & { file_name: string }; url: string };
  onClose: () => void;
};

export default function ImagePreviewModal({ preview, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const meta = formatMessengerAttachmentMeta(preview.attachment);

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(event) => event.stopPropagation()} style={shellStyle}>
        <div style={headerStyle}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={fileNameStyle}>{preview.attachment.file_name}</div>
            {meta && <div style={metaStyle}>{meta}</div>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href={preview.url} download={preview.attachment.file_name} target="_blank" rel="noreferrer" style={actionStyle} title="다운로드">
              <Download size={17} strokeWidth={2} />
            </a>
            <button type="button" onClick={onClose} style={actionStyle} title="닫기">
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div style={imageFrameStyle}>
          <Image src={preview.url} alt={preview.attachment.file_name} fill sizes="100vw" unoptimized style={imageStyle} />
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = { position: "fixed", inset: 0, zIndex: 260, background: "rgba(20,18,15,0.78)", padding: 16, display: "grid", placeItems: "center" };
const shellStyle: CSSProperties = { width: "min(1040px, 100%)", maxHeight: "calc(100dvh - 32px)", background: "var(--card)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 80px rgba(0,0,0,0.4)" };
const headerStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--hairline)" };
const fileNameStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)", fontSize: 14, fontWeight: 800 };
const metaStyle: CSSProperties = { marginTop: 3, color: "var(--ink-faint)", fontSize: 12, fontWeight: 600 };
const actionStyle: CSSProperties = { width: 36, height: 36, border: "1px solid var(--hairline)", borderRadius: 8, background: "var(--surface)", color: "var(--ink-mid)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const imageFrameStyle: CSSProperties = { position: "relative", minHeight: 240, flex: 1, background: "var(--bg-soft)" };
const imageStyle: CSSProperties = { objectFit: "contain" };
