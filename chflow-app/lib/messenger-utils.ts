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

export function formatMessengerMessageTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function messengerRoleLabel(role: string | null): string {
  if (role === "admin") return "관리자";
  if (role === "office") return "사무";
  if (role === "pastor") return "교역자";
  if (role === "leader") return "리더";
  return "성도";
}

export function messengerErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message: unknown }).message);
  return "처리 중 오류가 발생했습니다.";
}

type ReadReceipt = { user_id: string; name: string | null; read_at: string | null };
type ReadParticipant = { user_id: string; name: string | null; avatar_url: string | null; sub_role: string | null };

export type MessengerReadStatus = {
  sender: ReadParticipant | undefined;
  readRows: Array<ReadParticipant & { read_at: string | null }>;
  unreadRows: ReadParticipant[];
};

export function getMessengerReadStatus(
  senderId: string,
  receipts: ReadReceipt[],
  participants: ReadParticipant[],
): MessengerReadStatus {
  const byUserId = new Map(participants.map((participant) => [participant.user_id, participant]));
  const readUserIds = new Set(receipts.map((receipt) => receipt.user_id));
  const readRows = receipts.map((receipt) => {
    const participant = byUserId.get(receipt.user_id);
    return {
      user_id: receipt.user_id,
      name: receipt.name || participant?.name || "이름 없음",
      avatar_url: participant?.avatar_url || null,
      sub_role: participant?.sub_role || null,
      read_at: receipt.read_at,
    };
  }).sort((a, b) => String(a.read_at || "").localeCompare(String(b.read_at || "")));

  return {
    sender: byUserId.get(senderId),
    readRows,
    unreadRows: participants.filter((participant) => participant.user_id !== senderId && !readUserIds.has(participant.user_id)),
  };
}

export function toggleMessengerUser<T extends { user_id: string }>(selected: T[], user: T, singleSelect = false): T[] {
  if (singleSelect) return [user];
  return selected.some((item) => item.user_id === user.user_id)
    ? selected.filter((item) => item.user_id !== user.user_id)
    : [...selected, user];
}

export function getMessengerGroupTitle(users: Array<{ name?: string | null }>, explicitTitle: string) {
  return explicitTitle.trim() || users.map((user) => user.name).filter(Boolean).join(", ");
}
