// R2 저장 임계값이 단일 출처(R2_STORAGE_QUOTA_BYTES)만 쓰는지 고정한다.
//
// 과거에는 관리자 화면(/api/admin/r2-usage)은 env 를 읽고 실제 경보
// (/api/cron/storage-cleanup)는 하드코딩 10 GiB 를 쓰는 이중 출처였다.
// 여기서 그 하드코딩이 다시 들어오는 것을 막는다.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DB_CAPACITY_THRESHOLDS,
  R2_CAPACITY_THRESHOLDS,
  dbQuotaBytes,
  evaluateR2Usage,
  evaluateUsageDiagnostics,
  parseQuotaBytes,
  r2QuotaBytes,
  type UsageDiagnosticsPayload,
} from "./usageDiagnostics";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOTS = [resolve(here, "../app"), resolve(here, "../lib")];

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) found.push(full);
    }
  };
  APP_ROOTS.forEach(walk);
  return found;
}

describe("quota 파싱 (단일 구현)", () => {
  it("정상 값만 통과시킨다", () => {
    expect(parseQuotaBytes("10737418240")).toBe(10737418240);
    expect(parseQuotaBytes(" 524288000 ")).toBe(524288000);
  });

  it("미설정·빈 문자열·비숫자·0 이하·비정수는 판정 불가(null)", () => {
    expect(parseQuotaBytes(undefined)).toBeNull();
    expect(parseQuotaBytes(null)).toBeNull();
    expect(parseQuotaBytes("")).toBeNull();
    expect(parseQuotaBytes("   ")).toBeNull();
    expect(parseQuotaBytes("abc")).toBeNull();
    expect(parseQuotaBytes("10GB")).toBeNull();
    expect(parseQuotaBytes("0")).toBeNull();
    expect(parseQuotaBytes("-1")).toBeNull();
    expect(parseQuotaBytes("1.5")).toBeNull();
    expect(parseQuotaBytes("NaN")).toBeNull();
    expect(parseQuotaBytes("Infinity")).toBeNull();
    expect(parseQuotaBytes("1e400")).toBeNull();
  });

  it("r2QuotaBytes 는 R2_STORAGE_QUOTA_BYTES 만 읽는다", () => {
    expect(r2QuotaBytes({ R2_STORAGE_QUOTA_BYTES: "10737418240" })).toBe(10737418240);
    expect(r2QuotaBytes({})).toBeNull();
    expect(r2QuotaBytes({ R2_STORAGE_QUOTA_BYTES: "" })).toBeNull();
    // DB quota 를 대신 읽어서는 안 된다
    expect(r2QuotaBytes({ SUPABASE_DB_QUOTA_BYTES: "524288000" })).toBeNull();
  });
});

describe("R2 사용량 판정", () => {
  const QUOTA = 10_000_000_000;

  it("env 정상: 표시와 경보가 같은 quota·사용률을 본다", () => {
    const result = evaluateR2Usage({ totalBytes: 5_000_000_000, quotaBytes: QUOTA });
    expect(result.quotaBytes).toBe(QUOTA);
    expect(result.usagePct).toBeCloseTo(50, 5);
    expect(result.overThreshold).toBe(false);
    expect(result.finding).toBeNull();
  });

  it("env 미설정: R2_QUOTA_UNSET, 사용률 계산·초과 판정 없음", () => {
    const result = evaluateR2Usage({ totalBytes: 9_999_999_999, quotaBytes: null });
    expect(result.quotaBytes).toBeNull();
    expect(result.usagePct).toBeNull();
    expect(result.overThreshold).toBe(false);
    expect(result.finding?.code).toBe("R2_QUOTA_UNSET");
    expect(result.finding?.severity).toBe("INFO");
  });

  it("빈 문자열 / invalid / 0 이하도 모두 판정 불가로 이어진다", () => {
    for (const raw of ["", "   ", "abc", "0", "-5", "1.5"]) {
      const quota = r2QuotaBytes({ R2_STORAGE_QUOTA_BYTES: raw });
      const result = evaluateR2Usage({ totalBytes: 20_000_000_000, quotaBytes: quota });
      expect(result.overThreshold, `raw=${JSON.stringify(raw)}`).toBe(false);
      expect(result.usagePct).toBeNull();
      expect(result.finding?.code).toBe("R2_QUOTA_UNSET");
    }
  });

  it("79.9% 는 경보 없음, 80% 는 경보 발생", () => {
    const under = evaluateR2Usage({ totalBytes: QUOTA * 0.799, quotaBytes: QUOTA });
    expect(under.overThreshold).toBe(false);
    expect(under.finding).toBeNull();

    const at = evaluateR2Usage({ totalBytes: QUOTA * 0.8, quotaBytes: QUOTA });
    expect(at.overThreshold).toBe(true);
    expect(at.finding?.code).toBe("R2_CAPACITY");
    expect(at.finding?.severity).toBe("WARN");

    const over = evaluateR2Usage({ totalBytes: QUOTA * 0.95, quotaBytes: QUOTA });
    expect(over.overThreshold).toBe(true);
  });

  it("80% 기준값이 유지된다", () => {
    expect(R2_CAPACITY_THRESHOLDS.warn).toBe(80);
  });

  it("경보 문구가 운영 임계값을 말하고 무료 allowance 를 가정하지 않는다", () => {
    const at = evaluateR2Usage({ totalBytes: QUOTA, quotaBytes: QUOTA });
    expect(at.finding?.title).toContain("임계값 접근");
    expect(at.finding?.detail).toContain("운영 임계값");
    expect(at.finding?.detail).toContain("비용");
    // 설정값이 곧 Cloudflare 무료 allowance 라고 단정하지 않는다
    expect(at.finding?.detail).not.toContain("무료");
    expect(at.finding?.detail).not.toContain("무료플랜");
  });

  it("미설정 안내는 hard capacity 가 아님을 설명한다", () => {
    const unset = evaluateR2Usage({ totalBytes: 1, quotaBytes: null });
    expect(unset.finding?.detail).toContain("운영자가 정하는 감시 기준");
    expect(unset.finding?.detail).toContain("저장이 중단되지 않고");
  });
});

describe("하드코딩 quota 재유입 방지", () => {
  const files = sourceFiles();

  it("app/ lib/ 어디에도 10GB 하드코딩이 없다", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/10\s*\*\s*1024\s*\*\s*1024\s*\*\s*1024/.test(source)) offenders.push(`${file} (10*1024^3)`);
      if (/\b10737418240\b/.test(source)) offenders.push(`${file} (10737418240)`);
      if (/\bR2_LIMIT\b/.test(source)) offenders.push(`${file} (R2_LIMIT)`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("R2 quota 를 읽는 곳은 r2QuotaBytes 하나뿐이다", () => {
    const readers: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("R2_STORAGE_QUOTA_BYTES")) continue;
      readers.push(file);
      // 정의 파일(usageDiagnostics.ts)만 env 를 직접 읽는다
      if (!file.endsWith("usageDiagnostics.ts")) {
        expect(source, `${file} 은 env 를 직접 파싱하지 말고 r2QuotaBytes() 를 써야 한다`)
          .not.toMatch(/process\.env\.R2_STORAGE_QUOTA_BYTES/);
      }
    }
    expect(readers.length).toBeGreaterThan(0);
  });

  it("storage-cleanup 과 r2-usage 가 같은 helper 를 쓴다", () => {
    const cron = readFileSync(resolve(here, "../app/api/cron/storage-cleanup/route.ts"), "utf8");
    const api = readFileSync(resolve(here, "../app/api/admin/r2-usage/route.ts"), "utf8");
    for (const [label, source] of [["storage-cleanup", cron], ["r2-usage", api]] as const) {
      expect(source, label).toContain("r2QuotaBytes");
      expect(source, label).toMatch(/from "@\/lib\/usageDiagnostics"/);
    }
    // 경보 판정도 공통 evaluator 를 쓴다
    expect(cron).toContain("evaluateR2Usage");
    expect(cron).toContain("R2_CAPACITY_THRESHOLDS.warn");
  });

  it("quota 미설정이 cron 전체를 실패시키지 않는다", () => {
    const cron = readFileSync(resolve(here, "../app/api/cron/storage-cleanup/route.ts"), "utf8");
    // 판정 불가는 results 에 기록만 하고 throw / 조기 return 하지 않는다
    expect(cron).toContain("판정 불가 (R2_STORAGE_QUOTA_BYTES)");
    const block = cron.slice(cron.indexOf("const quotaBytes = r2QuotaBytes()"), cron.indexOf("results.r2_watch_error"));
    expect(block).not.toMatch(/\bthrow\b/);
    expect(block).not.toMatch(/return NextResponse/);
  });

  it("dedupe 3일 정책과 알림 타입이 유지된다", () => {
    const cron = readFileSync(resolve(here, "../app/api/cron/storage-cleanup/route.ts"), "utf8");
    expect(cron).toContain('.eq("type", "ops_usage_r2_capacity")');
    expect(cron).toContain('type: "ops_usage_r2_capacity"');
    expect((cron.match(/3 \* 24 \* 60 \* 60 \* 1000/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("알림 본문이 무료 allowance 를 가정하지 않는다", () => {
    const cron = readFileSync(resolve(here, "../app/api/cron/storage-cleanup/route.ts"), "utf8");
    const block = cron.slice(cron.indexOf('type: "ops_usage_r2_capacity"'), cron.indexOf("results.r2_watch = `알림 발송"));
    expect(block).toContain("운영 임계값");
    expect(block).not.toContain("무료");
    expect(block).not.toContain("10GB");
  });

  it("DB quota 경로도 같은 공통 파싱을 쓴다", () => {
    const diag = readFileSync(resolve(here, "../app/api/admin/usage-diagnostics/route.ts"), "utf8");
    const cron = readFileSync(resolve(here, "../app/api/cron/storage-cleanup/route.ts"), "utf8");
    for (const [label, source] of [["usage-diagnostics", diag], ["storage-cleanup", cron]] as const) {
      expect(source, label).toContain("dbQuotaBytes");
      // 각자 env 를 다시 파싱하지 않는다
      expect(source, label).not.toMatch(/process\.env\.SUPABASE_DB_QUOTA_BYTES/);
      expect(source, label).not.toContain("positiveInteger");
      expect(source, label).toMatch(/usageDiagnostics"/);
    }
    // DB 경보 정책·타입은 그대로
    expect(cron).toContain("DB_CAPACITY_THRESHOLDS.warn");
    expect(cron).toContain('type: "ops_usage_db_capacity"');
    expect(cron).toContain('.eq("type", "ops_usage_db_capacity")');
  });

  it("SUPABASE_DB_QUOTA_BYTES 를 읽는 곳은 dbQuotaBytes 하나뿐이다", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("SUPABASE_DB_QUOTA_BYTES")) continue;
      if (file.endsWith("usageDiagnostics.ts")) continue;
      expect(source, `${file} 은 dbQuotaBytes() 를 써야 한다`)
        .not.toMatch(/process\.env\.SUPABASE_DB_QUOTA_BYTES/);
    }
  });
});

describe("DB quota 판정 (parser 공통화 후 회귀 확인)", () => {
  const QUOTA = 524288000;
  const payload = (dbBytes: number, quota: number | null): UsageDiagnosticsPayload => ({
    latest_collection: null,
    latest_complete: {
      usage_date: "2026-08-18", interval_started_at: null, interval_ended_at: "2026-08-18T15:10:00Z",
      data_quality: "complete", visitors: 5, statement_calls: 100, statement_rows: 100,
      exec_time_ms: 10, statements_per_visitor: 20, db_size_bytes: dbBytes,
      db_growth_bytes: 0, candidate: null, confidence: null, candidate_share_pct: null,
      primary_identifier: null, primary_display_name: null, primary_share_pct: null,
    },
    comparison: null, top_queries: [], trend: [], collection: null, db_quota_bytes: quota,
  });
  const findings = (dbBytes: number, quota: number | null) =>
    evaluateUsageDiagnostics(payload(dbBytes, quota)).findings;

  it("dbQuotaBytes 는 SUPABASE_DB_QUOTA_BYTES 만 읽고 invalid 는 null", () => {
    expect(dbQuotaBytes({ SUPABASE_DB_QUOTA_BYTES: "524288000" })).toBe(524288000);
    expect(dbQuotaBytes({ SUPABASE_DB_QUOTA_BYTES: "8589934592" })).toBe(8589934592);
    expect(dbQuotaBytes({ R2_STORAGE_QUOTA_BYTES: "10737418240" })).toBeNull();
    for (const raw of [undefined, "", "   ", "abc", "0", "-1", "1.5", "NaN", "Infinity"]) {
      expect(dbQuotaBytes({ SUPABASE_DB_QUOTA_BYTES: raw }), `raw=${JSON.stringify(raw)}`).toBeNull();
    }
  });

  it("정상 quota 면 사용률을 계산한다", () => {
    const at50 = findings(QUOTA * 0.5, QUOTA);
    expect(at50.some((f) => f.code === "DB_QUOTA_UNSET")).toBe(false);
    expect(at50.some((f) => f.code === "DB_CAPACITY")).toBe(false);
  });

  // DB 는 R2 와 달리 60/80/95 3단 구간이다. 알림(ops_usage_db_capacity)은 warn(80%)부터다.
  it("59.9% 무표시, 60% INFO, 79.9% 는 아직 INFO, 80% WARN, 95% CRITICAL", () => {
    expect(findings(Math.floor(QUOTA * 0.599), QUOTA).find((f) => f.code === "DB_CAPACITY")).toBeUndefined();
    expect(findings(QUOTA * 0.6, QUOTA).find((f) => f.code === "DB_CAPACITY")?.severity).toBe("INFO");
    // 79.9% 는 경보(WARN) 기준 미만 — 알림은 발생하지 않는다
    expect(findings(Math.floor(QUOTA * 0.799), QUOTA).find((f) => f.code === "DB_CAPACITY")?.severity).toBe("INFO");
    expect(findings(QUOTA * 0.8, QUOTA).find((f) => f.code === "DB_CAPACITY")?.severity).toBe("WARN");
    expect(findings(QUOTA * 0.95, QUOTA).find((f) => f.code === "DB_CAPACITY")?.severity).toBe("CRITICAL");
  });

  it("알림 발송은 warn(80%) 기준이며 그 미만에서는 만들지 않는다", () => {
    const cron = readFileSync(resolve(here, "../app/api/cron/storage-cleanup/route.ts"), "utf8");
    const block = cron.slice(cron.indexOf("const quota = dbQuotaBytes()"), cron.indexOf("results.db_watch_error"));
    expect(block).toContain("pct < DB_CAPACITY_THRESHOLDS.warn");
    expect(block).toContain('results.db_watch = `정상');
    expect(block).toContain('type: "ops_usage_db_capacity"');
  });

  it("invalid quota 는 DB_QUOTA_UNSET 이고 용량 판정을 하지 않는다", () => {
    for (const raw of [undefined, "", "abc", "0", "-1"]) {
      const quota = dbQuotaBytes({ SUPABASE_DB_QUOTA_BYTES: raw });
      const result = findings(QUOTA * 2, quota);
      expect(result.some((f) => f.code === "DB_QUOTA_UNSET"), `raw=${JSON.stringify(raw)}`).toBe(true);
      expect(result.some((f) => f.code === "DB_CAPACITY")).toBe(false);
    }
  });

  it("80% 기준값이 유지된다", () => {
    expect(DB_CAPACITY_THRESHOLDS.warn).toBe(80);
    expect(DB_CAPACITY_THRESHOLDS.critical).toBe(95);
  });
});
