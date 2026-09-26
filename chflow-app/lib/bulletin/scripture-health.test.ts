import { describe, expect, it } from "vitest";
import { assessScriptureHealth, type ExtractionRun } from "./scripture-health";

const NOW = new Date("2026-10-03T12:00:00Z").getTime();
const run = (patch: Partial<ExtractionRun>): ExtractionRun => ({
  trigger: "cron", started_at: "2026-10-02T06:00:00Z", duration_ms: 12_000, budget_ms: 40_000,
  models: [{ model: "gemini-3.1-flash-lite", ok: true, ms: 3_000, status: 200 }, { model: "gemini-3.8-flash", ok: true, ms: 8_000, status: 200 }],
  result_status: "done", time_limited: false, ...patch,
});
const codes = (runs: ExtractionRun[], models?: string[]) => assessScriptureHealth(runs, models, NOW).map((item) => `${item.level}:${item.code}`);

describe("scripture auto extraction self-diagnosis", () => {
  it("reports nothing for healthy runs", () => {
    expect(codes([run({}), run({ trigger: "manual" })])).toEqual([]);
  });

  it("asks to raise maxDuration when cron could not finish in time", () => {
    expect(codes([run({ result_status: "deferred", models: [], time_limited: true })])).toEqual(["action:time_limit"]);
    expect(codes([run({ time_limited: true, result_status: "retry" })])).toEqual(["action:time_limit"]);
  });

  it("watches runs that used most of the time budget", () => {
    expect(codes([run({ duration_ms: 35_000, budget_ms: 40_000 })])).toEqual(["watch:near_limit"]);
    // 수동 재판독은 cron 과 시간 조건이 달라 판단에서 뺀다.
    expect(codes([run({ trigger: "manual", duration_ms: 50_000, budget_ms: 55_000 })])).toEqual([]);
  });

  it("flags a retired model only while it is still configured", () => {
    const retired = run({ models: [{ model: "gemini-3.1-flash-lite", ok: false, ms: 200, status: 404 }] });
    expect(codes([retired], ["gemini-3.1-flash-lite", "gemini-3.8-flash"])).toEqual(["action:model_retired"]);
    expect(codes([retired], ["gemini-3.8-flash"])).toEqual([]);
  });

  it("flags a missing or rejected API key", () => {
    expect(codes([run({ result_status: "failed", models: [{ model: "gemini-3.8-flash", ok: false, ms: 0, status: "no_key" }] })])).toContain("action:key_invalid");
    expect(codes([run({ result_status: "failed", models: [{ model: "gemini-3.8-flash", ok: false, ms: 90, status: 400, error: "400 API key not valid" }] })])).toContain("action:key_invalid");
  });

  it("only watches repeated quota and overload problems", () => {
    const busy = run({ result_status: "retry", models: [{ model: "a", ok: false, ms: 100, status: 429 }, { model: "b", ok: false, ms: 25_000, status: "timeout" }] });
    expect(codes([busy])).toEqual([]);
    expect(codes([busy, busy])).toEqual(["watch:quota", "watch:overload"]);
  });

  it("ignores runs older than the diagnosis window", () => {
    expect(codes([run({ started_at: "2026-09-01T00:00:00Z", result_status: "deferred", time_limited: true })])).toEqual([]);
  });
});
