export type ReadableMessengerMessage = {
  id: string;
  is_mine: boolean;
  deleted_at: string | null;
};

/**
 * Finds the oldest unread, visible message in a chronological message list.
 * The result is used as the target for the "first unread" jump control.
 */
export function findFirstUnreadMessageId(
  rows: ReadableMessengerMessage[],
  unreadCount: number,
): string | null {
  if (unreadCount <= 0) return null;

  let remaining = unreadCount;
  let fallback: string | null = null;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.is_mine || row.deleted_at) continue;
    fallback = row.id;
    remaining -= 1;
    if (remaining <= 0) return row.id;
  }

  return fallback;
}

export function sanitizeMessengerFileName(name: string): string {
  const clean = name.normalize("NFKC").replace(/[^\w.\-가-힣]/g, "_").slice(0, 90);
  return clean || "attachment";
}

export function formatFileBytes(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export type MessengerAttachmentMetadata = {
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  size_bytes?: number | null;
};

export function formatMessengerAttachmentMeta(attachment: MessengerAttachmentMetadata): string {
  return [
    attachment.mime_type?.split("/").pop()?.toUpperCase(),
    attachment.width && attachment.height ? `${attachment.width}x${attachment.height}` : "",
    formatFileBytes(attachment.size_bytes),
  ].filter(Boolean).join(" · ");
}
