import { describe, expect, it, vi } from "vitest";

vi.mock("../r2", () => ({ r2: { from: () => ({}) } }));
import { decideSlots } from "./scripture-auto";
import { parseModelSlots } from "./scripture-ai";
import type { ValidatedReference } from "./scripture-validation";

const NOT_IN_BIBLE = new Set(["고린도후서 99:1"]);
const validate = async (reference: string): Promise<ValidatedReference | null> =>
  NOT_IN_BIBLE.has(reference) ? null : { bookId: 1, chapterStart: 1, verseStart: 1, chapterEnd: 1, verseEnd: 1, normalizedLabel: reference };

// 2026-09-20 주보: 1부 출애굽기 / 2·3부 요한복음 / 오후 디모데후서.
// flash-lite 는 3부를 디모데후서로 읽었다(실측) — 그 칸만 검토로 빠져야 한다.
const flash = parseModelSlots({
  sunday_1: "출애굽기 23:14-19", sunday_2: "요한복음 1:1-14", sunday_3: "요한복음 1:1-14",
  sunday_afternoon: "디모데후서 4:7-8", wednesday_morning: "요한계시록 3:1-6", wednesday_evening: "마태복음 5:9",
});
const lite = parseModelSlots({
  sunday_1: "출애굽기 23:14-19", sunday_2: "요한복음 1:1-14", sunday_3: "디모데후서 4:7-8",
  sunday_afternoon: "디모데후서 4:7-8", wednesday_morning: "요한계시록 3: 1-6", wednesday_evening: "마태복음 5:9",
});

describe("scripture auto extraction decisions", () => {
  it("publishes slots where both models agree and sends disagreements to review", async () => {
    const outcomes = Object.fromEntries((await decideSlots([flash, lite], validate)).map((item) => [item.slot, item]));
    expect(outcomes.sunday_1).toMatchObject({ kind: "verified", confirmed: true });
    expect(outcomes.wednesday_morning).toMatchObject({ kind: "verified", refs: [{ raw: "요한계시록 3:1-6" }] });
    expect(outcomes.sunday_3).toMatchObject({ kind: "pending", confirmed: false, refs: [{ raw: "요한복음 1:1-14" }] });
    expect(outcomes.sunday_3.note).toContain("디모데후서 4:7-8");
  });

  it("treats a service both models left empty as confirmed empty", async () => {
    const noWednesday = parseModelSlots({ ...flash, wednesday_morning: null });
    const outcomes = await decideSlots([noWednesday, parseModelSlots({ ...lite, wednesday_morning: null })], validate);
    expect(outcomes.find((item) => item.slot === "wednesday_morning")).toMatchObject({ kind: "empty", confirmed: true });
  });

  it("never auto-publishes with a single model response", async () => {
    const outcomes = await decideSlots([flash], validate);
    expect(outcomes.every((item) => item.kind !== "verified" && !item.confirmed)).toBe(true);
  });

  it("does not publish agreed readings that are not in the Bible", async () => {
    const wrong = parseModelSlots({ sunday_afternoon: "고린도후서 99:1" });
    const outcome = (await decideSlots([wrong, wrong], validate)).find((item) => item.slot === "sunday_afternoon");
    expect(outcome).toMatchObject({ kind: "pending", confirmed: false });
  });

  it("keeps multiple readings in one cell in order", async () => {
    const both = parseModelSlots({ sunday_1: "출애굽기 22:1-9, 시편 24:1" });
    const outcome = (await decideSlots([both, both], validate)).find((item) => item.slot === "sunday_1");
    expect(outcome?.refs.map((ref) => ref.raw)).toEqual(["출애굽기 22:1-9", "시편 24:1"]);
    expect(outcome?.kind).toBe("verified");
  });
});
