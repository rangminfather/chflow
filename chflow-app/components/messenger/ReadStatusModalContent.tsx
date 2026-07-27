import type { CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { EmptyState } from "@/components/StatusViews";
import Avatar from "@/components/messenger/MessengerAvatar";
import { formatMessengerMessageTime, type MessengerReadStatus } from "@/lib/messenger-utils";
import type { MessengerMessage } from "@/lib/messenger";

type Styles = Record<"modalOverlay" | "modal" | "modalHeader" | "sectionTitle" | "smallIconButton" | "replyPreview" | "oneLine" | "sidebarLabel" | "userList" | "userRow" | "userName" | "userMeta", CSSProperties>;

export default function ReadStatusModalContent({ message, status, onClose, styles }: { message: MessengerMessage; status: MessengerReadStatus; onClose: () => void; styles: Styles }) {
  const { sender, readRows, unreadRows } = status;
  return <div onClick={onClose} style={styles.modalOverlay}>
    <div onClick={(event) => event.stopPropagation()} style={styles.modal}>
      <div style={styles.modalHeader}>
        <div style={styles.sectionTitle}><Check size={18} strokeWidth={2} /> 읽음 현황</div>
        <button type="button" onClick={onClose} style={styles.smallIconButton}><X size={17} /></button>
      </div>
      <div style={{ ...styles.replyPreview, maxWidth: "none", background: "var(--bg-soft)", color: "var(--ink-soft)", marginBottom: 14 }}>
        <div style={{ fontWeight: 900 }}>{sender?.name || message.sender_name || "보낸 사람"}</div>
        <div style={styles.oneLine}>{message.body || "첨부 메시지"}</div>
      </div>
      <Rows label={`읽은 사람 ${readRows.length}명`} rows={readRows} empty="아직 읽은 사람이 없습니다." styles={styles} readTime />
      <Rows label={`안 읽은 사람 ${unreadRows.length}명`} rows={unreadRows} empty="모두 읽었습니다." styles={styles} />
    </div>
  </div>;
}

function Rows({ label, rows, empty, styles, readTime = false }: { label: string; rows: Array<{ user_id: string; name: string | null; avatar_url: string | null; sub_role: string | null; read_at?: string | null }>; empty: string; styles: Styles; readTime?: boolean }) {
  return <><div style={styles.sidebarLabel}>{label}</div><div style={{ ...styles.userList, maxHeight: 220, marginBottom: 14 }}>
    {rows.length === 0 ? <EmptyState message={empty} padding={24} /> : rows.map((row) => <div key={row.user_id} style={{ ...styles.userRow, cursor: "default" }}>
      <Avatar title={row.name || "U"} src={row.avatar_url} /><div style={{ flex: 1, minWidth: 0 }}><div style={styles.userName}>{row.name || "이름 없음"}</div><div style={styles.userMeta}>{readTime && row.read_at ? formatMessengerMessageTime(row.read_at) : row.sub_role || "미읽음"}</div></div>
    </div>)}
  </div></>;
}
