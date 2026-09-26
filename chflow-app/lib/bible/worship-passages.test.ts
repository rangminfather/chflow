import { describe, it, expect, vi } from "vitest";
import { expandWorshipReferences, loadWorshipPassages } from "./worship-passages";
import { buildWorshipLeaderSections } from "../worshipLeaderScript";
import { extractOcrBulletinText } from "../bulletin/content-extraction";

describe("multiple worship passages", () => {
  it("recovers both passages from the September 27 elementary joint-service OCR", () => {
    const fields = extractOcrBulletinText("성경봉독 로마서 8장 18~22절 , 시편 139편 7~12절 인도자              는              —\\;             |\n강론").fields;
    expect(fields.scripture).toBe("로마서 8장 18~22절 , 시편 139편 7~12절");
    expect(expandWorshipReferences(fields.scripture!)).toEqual(["로마서 8:18-22", "시편 139:7-12"]);
  });
  it.each([
    ["창세기 1장 1절, 요한복음 3장 16~17절", ["창세기 1:1", "요한복음 3:16-17"]],
    ["요 3:16,18-20,4:1-3", ["요 3:16", "요 3:18-20", "요 4:1-3"]],
    ["시편 23편 1절，시편 100편 1∼3절", ["시편 23:1", "시편 100:1-3"]],
    ["창 1:31-2:3,5", ["창 1:31-2:3", "창 2:5"]],
    ["고린도전서13:1-3;요한일서4:7-8", ["고린도전서 13:1-3", "요한일서 4:7-8"]],
    ["시 23,24", ["시 23", "시 24"]],
  ])("expands %s", (raw, expected) => {
    expect(expandWorshipReferences(raw)).toEqual(expected);
  });

  it.each(["요 3:16,", "요 3:16,???", "16,18", ""])("rejects malformed input %s", (raw) => {
    expect(() => expandWorshipReferences(raw)).toThrow();
  });

  it("preserves both OCR passages through lookup and the copied script", async () => {
    const fields = extractOcrBulletinText("성경봉독 ─ 창세기 1장 1절,\n요한복음 3장 16절 ─ 인도자\n강론 사랑 김희숙전도사님").fields;
    expect(fields.scripture).toContain("요한복음");
    const lookup = vi.fn(async (ref: string) => ({
      ok: true, normalizedLabel: ref, bookId: ref.startsWith("창") ? 1 : 43,
      rows: [{ chapter: ref.startsWith("창") ? 1 : 3, verse: ref.startsWith("창") ? 1 : 16, text: ref.startsWith("창") ? "첫 본문" : "두 번째 본문" }],
    }));
    const result = await loadWorshipPassages(fields.scripture!, lookup);
    expect(lookup.mock.calls.map(([ref]) => ref)).toEqual(["창세기 1:1", "요한복음 3:16"]);
    expect(result.testament).toBe("구약/신약");
    const section = buildWorshipLeaderSections({ sunday: "2026-09-27", prayerClass: "1-1", scripture: fields.scripture!, normalizedScripture: result.normalizedLabel, testament: result.testament, verses: result.rows, sermonTitle: "사랑", preacher: "담당 교역자" }).find((s) => s.number === 7)!;
    expect(section.content).toContain("창세기 1:1\n1   첫 본문");
    expect(section.content).toContain("요한복음 3:16\n16   두 번째 본문");
  });

  it("does not report success when only the first passage exists", async () => {
    await expect(loadWorshipPassages("창 1:1,요 3:16", async (ref) => ref.startsWith("창") ? {
      ok: true, bookId: 1, rows: [{ chapter: 1, verse: 1, text: "첫 본문" }],
    } : { ok: false, error: "조회 실패" })).rejects.toThrow("요 3:16");
  });

  it("keeps single-passage rendering unchanged", async () => {
    const result = await loadWorshipPassages("창 1:1", async () => ({ ok: true, bookId: 1, rows: [{ chapter: 1, verse: 1, text: "본문" }] }));
    expect(result.rows[0].passageLabel).toBeUndefined();
    expect(result.testament).toBe("구약");
  });
});
