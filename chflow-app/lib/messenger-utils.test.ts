import { describe, expect, it } from "vitest";
import {
  findFirstUnreadMessageId,
  formatFileBytes,
  formatMessengerAttachmentMeta,
  sanitizeMessengerFileName,
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
  });
});
