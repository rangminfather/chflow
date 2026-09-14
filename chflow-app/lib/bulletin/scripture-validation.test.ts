import { describe, expect, it, vi } from "vitest";

const getObject = vi.fn();
vi.mock("../r2", () => ({ r2: { from: () => ({ getObject }) } }));
import { validateNkrvReference } from "./scripture-validation";

const parsed = (reference: string) => {
  if (reference.includes("알수없는")) return { data: null, error: { message: "book not found" } };
  const match = reference.match(/(\d+):(\d+)-(\d+)/);
  return { data: [{ book_id: 1, chapter_start: Number(match?.[1] || 99), verse_start: Number(match?.[2] || 1), chapter_end: Number(match?.[1] || 99), verse_end: Number(match?.[3] || 1), normalized_label: reference }], error: null };
};
const client = { rpc: vi.fn((_name: string, args: { p_ref: string }) => parsed(args.p_ref)) };
function book(chapter = 23, maxVerse = 15) { return { version: "NKRV", bookId: 1, verses: Array.from({ length: maxVerse }, (_, i) => ({ chapter, verse: i + 1, text: "x" })) }; }

describe("NKRV bulletin reference validation", () => {
  it.each(["출애굽기 23:10-13", "창세기 39:1-6", "사도행전 1:9-11", "여호수아 7:1-15", "출 23:10-13", "창 39:1-6", "행 1:9-11", "수 7:1-15"])("accepts validated single range %s", async (reference) => {
    const chapter = Number(reference.match(/(\d+):/)?.[1]); getObject.mockResolvedValue({ data: { body: Buffer.from(JSON.stringify(book(chapter, 20))) }, error: null });
    await expect(validateNkrvReference(client, reference)).resolves.toMatchObject({ chapterStart: chapter });
  });
  it("rejects conservative OCR and invalid ranges", async () => {
    await expect(validateNkrvReference(client, "출애굽기 23:10-I3")).rejects.toThrow("OCR");
    await expect(validateNkrvReference(client, "창세기 39:6-1")).rejects.toThrow("시작");
  });
  it("rejects non-existent chapter, verse, and book", async () => {
    getObject.mockResolvedValue({ data: { body: Buffer.from(JSON.stringify(book(23, 6))) }, error: null });
    await expect(validateNkrvReference(client, "출애굽기 99:1-2")).rejects.toThrow("존재하지");
    await expect(validateNkrvReference(client, "출애굽기 23:1-7")).rejects.toThrow("존재하지");
    await expect(validateNkrvReference(client, "알수없는책 1:1-2")).rejects.toThrow("해석");
  });
});
