import { describe, expect, it } from "vitest";
import {
  findFirstUnreadMessageId,
  formatFileBytes,
  formatMessengerAttachmentMeta,
  formatMessengerMessageTime,
  messengerErrorMessage,
  getMessengerReadStatus,
  messengerRoleLabel,
  sanitizeMessengerFileName,
  toggleMessengerUser,
} from "./messenger-utils";

describe("findFirstUnreadMessageId", () => {
  it("targets the oldest unread message while skipping own and deleted messages", () => {
    const rows = [
      { id: "oldest-unread", is_mine: false, deleted_at: null },
      { id: "mine", is_mine: true, deleted_at: null },
      { id: "deleted", is_mine: false, deleted_at: "2026-07-27T00:00:00Z" },
      { id: "newest", is_mine: false, deleted_at: null },
    ];

    expect(findFirstUnreadMessageId(rows, 2)).toBe("oldest-unread");
  });

  it("returns null when there are no unread messages", () => {
    expect(findFirstUnreadMessageId([], 0)).toBeNull();
  });
});

describe("messenger file helpers", () => {
  it("normalizes unsafe file names and formats file sizes", () => {
    expect(sanitizeMessengerFileName("report / 7?.pdf")).toBe("report___7_.pdf");
    expect(formatFileBytes(1024)).toBe("1KB");
    expect(formatFileBytes(1_572_864)).toBe("1.5MB");
    expect(formatMessengerAttachmentMeta({ mime_type: "image/png", width: 120, height: 80, size_bytes: 1024 })).toBe("PNG · 120x80 · 1KB");
    expect(formatMessengerMessageTime("2026-07-27T14:05:00+09:00")).toBe("14:05");
  });

  it("maps roles and unknown errors to safe display strings", () => {
    expect(messengerRoleLabel("pastor")).toBe("교역자");
    expect(messengerRoleLabel(null)).toBe("성도");
    expect(messengerErrorMessage({ message: "실패" })).toBe("실패");
  });

  it("splits read and unread participants without including the sender", () => {
    const participants = [
      { user_id: "sender", name: "보낸 사람", avatar_url: null, sub_role: null },
      { user_id: "read", name: "읽음", avatar_url: null, sub_role: "교사" },
      { user_id: "unread", name: "미읽음", avatar_url: null, sub_role: null },
    ];
    const result = getMessengerReadStatus("sender", [{ user_id: "read", name: null, read_at: "2026-07-27T10:00:00Z" }], participants);
    expect(result.readRows.map((row) => row.user_id)).toEqual(["read"]);
    expect(result.unreadRows.map((row) => row.user_id)).toEqual(["unread"]);
  });

  it("keeps one direct-message target and toggles group targets", () => {
    const first = { user_id: "first" };
    const second = { user_id: "second" };
    expect(toggleMessengerUser([first], second, true)).toEqual([second]);
    expect(toggleMessengerUser([first], second)).toEqual([first, second]);
    expect(toggleMessengerUser([first, second], first)).toEqual([second]);
  });
});
