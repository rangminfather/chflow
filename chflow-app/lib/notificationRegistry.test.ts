// 알림 타입 레지스트리가 실제 생성 지점과 DB 매핑에서 어긋나지 않는지 고정한다.
//
// 새 알림 타입을 추가하고 NOTIFICATION_TYPES 등록을 빼먹으면 이 테스트가 실패한다.
// (예전에는 조용히 'system' 카테고리로 흘러들어갔다)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEGACY_NOTIFICATION_TYPES,
  NOTIFICATION_TYPES,
  notificationAudience,
  notificationCategory,
  USER_NOTIFICATION_CATEGORIES,
  type NotificationTypeSpec,
} from "./notificationPreferences";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../MS_AX/chflow-project/supabase/migrations");
const AUDIENCE_MIGRATION = join(MIGRATIONS_DIR, "20260818093000_notification_user_ops_audience.sql");

const registry = NOTIFICATION_TYPES as Record<string, NotificationTypeSpec>;
const registeredTypes = new Set(Object.keys(registry));
const legacyTypes = new Set(Object.keys(LEGACY_NOTIFICATION_TYPES));

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name));
}

/**
 * `insert into public.notifications` 뒤 8줄에서 알림 타입 리터럴을 뽑는다.
 * 컬럼명/메타데이터 키 등은 타입이 아니므로 제외한다.
 */
// metadata 키·role 값 등은 타입이 아니다. `*_id` 는 알림 타입에 쓰지 않으므로 규칙으로 배제한다.
const NOT_A_TYPE = new Set([
  "dedup_key", "signup_name", "signup_username",
  "source", "detail", "approved", "session", "event",
  "admin", "office", "pastor", "active",
  // audience 값과 metadata 키. audience 는 기본값이 'user' 라 대개 생략되지만
  // 목장 알림 SQL 처럼 명시하면 8줄 창에 리터럴로 잡힌다. 'month' 는 metadata 키다.
  "user", "month",
]);

function looksLikeType(value: string): boolean {
  return !value.endsWith("_id") && !NOT_A_TYPE.has(value);
}

function typesFromSql(): Set<string> {
  const found = new Set<string>();
  for (const file of migrationFiles()) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/insert\s+into\s+public\.notifications/i.test(line)) return;
      const window = lines.slice(index, index + 8).join("\n");
      for (const match of window.matchAll(/'([a-z][a-z0-9_]{3,})'/g)) {
        if (looksLikeType(match[1])) found.add(match[1]);
      }
    });
  }
  return found;
}

/** notifications 에 insert 하는 앱 코드에서 type: "..." 를 뽑는다. */
function typesFromAppCode(): Set<string> {
  const roots = [resolve(here, "../app"), resolve(here, "../lib")];
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
      const source = readFileSync(full, "utf8");
      if (!source.includes(`from("notifications")`)) continue;
      for (const match of source.matchAll(/\btype:\s*"([a-z][a-z0-9_]{3,})"/g)) {
        found.add(match[1]);
      }
    }
  };
  roots.forEach(walk);
  return found;
}

/**
 * 같은 함수를 나중 마이그레이션이 다시 정의하면 그 최신 정의가 실제 DB 상태다.
 * (한 파일만 보면 카테고리를 옮긴 뒤 이 테스트가 옛 매핑을 검사해 잘못 실패한다)
 */
function latestFunctionBody(functionName: string): string {
  const marker = `create or replace function public.${functionName}(`;
  let body = "";
  for (const file of migrationFiles()) {
    const sql = readFileSync(file, "utf8");
    for (let at = sql.indexOf(marker); at > -1; at = sql.indexOf(marker, at + 1)) {
      body = sql.slice(at, sql.indexOf("$$;", at));
    }
  }
  return body;
}

function sqlCaseMapping(functionName: string): Map<string, string> {
  const body = latestFunctionBody(functionName);
  expect(body, `${functionName} 정의를 찾지 못했습니다`).not.toBe("");
  const mapping = new Map<string, string>();
  for (const match of body.matchAll(/when\s+'([a-z0-9_]+)'\s+then\s+'([a-z0-9_]+)'/g)) {
    mapping.set(match[1], match[2]);
  }
  return mapping;
}

describe("알림 타입 생성 지점이 모두 레지스트리에 등록되어 있다", () => {
  it("SQL 마이그레이션이 만드는 타입", () => {
    const produced = typesFromSql();
    // 추출이 망가지면 통과해버리므로 최소 개수를 함께 고정한다.
    expect(produced.size).toBeGreaterThan(15);
    const missing = [...produced].filter((type) => !registeredTypes.has(type) && !legacyTypes.has(type));
    expect(missing, `미등록 알림 타입(SQL): ${missing.join(", ")}`).toEqual([]);
  });

  it("앱 코드(route/cron)가 만드는 타입", () => {
    const produced = typesFromAppCode();
    expect(produced.size).toBeGreaterThan(3);
    const missing = [...produced].filter((type) => !registeredTypes.has(type) && !legacyTypes.has(type));
    expect(missing, `미등록 알림 타입(앱 코드): ${missing.join(", ")}`).toEqual([]);
  });

  it("앱 코드는 rename 이전 이름을 더 이상 만들지 않는다", () => {
    const produced = typesFromAppCode();
    const stale = [...produced].filter((type) => legacyTypes.has(type));
    expect(stale, `ops_* 로 바꿔야 하는 타입: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("DB 매핑과 TS 레지스트리가 일치한다", () => {
  it("notification_audience_of 가 레지스트리와 같은 audience 를 준다", () => {
    const mapping = sqlCaseMapping("notification_audience_of");
    for (const [type, audience] of mapping) {
      expect(audience, `${type} audience`).toBe(notificationAudience(type));
    }
    // 레지스트리의 ops 타입은 전부 SQL 에도 있어야 한다 (RLS/트리거가 이 함수를 쓴다)
    for (const [type, spec] of Object.entries(registry)) {
      if (spec.audience !== "ops") continue;
      expect(mapping.get(type), `${type} 가 notification_audience_of 에 없습니다`).toBe("ops");
    }
  });

  it("notification_category 가 레지스트리와 같은 category 를 준다", () => {
    const mapping = sqlCaseMapping("notification_category");
    for (const [type, category] of mapping) {
      expect(category, `${type} category`).toBe(notificationCategory(type));
    }
    for (const type of registeredTypes) {
      expect(mapping.get(type), `${type} 가 notification_category 에 없습니다`).toBe(registry[type].category);
    }
  });

  // 새 카테고리를 만들고 컬럼 분기를 빼먹으면 그 알림이 조용히 system_enabled 스위치에
  // 빨려 들어간다. 사용자 스위치가 있는 카테고리는 전용 컬럼을 봐야 한다.
  it("사용자 스위치가 있는 카테고리는 notification_channel_allowed 에 전용 분기가 있다", () => {
    const body = latestFunctionBody("notification_channel_allowed");
    for (const category of USER_NOTIFICATION_CATEGORIES) {
      expect(body, `${category.key} 분기 누락`)
        .toContain(`when '${category.key}' then np.${category.key}_enabled`);
    }
  });

  it("mark_all_notifications_read 가 audience 범위를 받고 ops 권한을 다시 확인한다", () => {
    const sql = readFileSync(AUDIENCE_MIGRATION, "utf8");
    // 인자 없는 구버전(전체 처리)은 제거해야 한다
    expect(sql).toContain("drop function if exists public.mark_all_notifications_read();");
    expect(sql).toContain("mark_all_notifications_read(p_audience text default 'user')");

    const start = sql.indexOf("function public.mark_all_notifications_read(p_audience");
    expect(start).toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    // 잘못된 범위 거부
    expect(body).toContain("not in ('user', 'ops')");
    // ops 범위는 UI 를 믿지 않고 DB 에서 권한 확인
    expect(body).toMatch(/v_audience = 'ops' and not public\.can_view_ops_notifications\(\)/);
    expect(body).toContain("'42501'");
    // 한 번의 호출이 한 audience 만 건드린다
    expect(body).toContain("n.audience = v_audience");
    expect(body).not.toMatch(/audience = 'user' or public\.can_view_ops_notifications\(\)/);
  });

  it("SQL 이 미분류를 system 으로 흘려보내지 않는다", () => {
    const body = latestFunctionBody("notification_category");
    expect(body).toContain("else 'unclassified'");
    expect(body).not.toMatch(/else\s+'system'/);
  });
});

describe("audience 판정 원칙", () => {
  it("전역 운영 권한으로 받는 알림만 ops 다", () => {
    const ops = Object.entries(registry).filter(([, spec]) => spec.audience === "ops").map(([type]) => type).sort();
    expect(ops).toEqual([
      "ops_bulletin_sync_error",
      "ops_feedback_new",
      "ops_message_report",
      "ops_signup_pending",
      "ops_usage_anomaly",
      "ops_usage_db_capacity",
      "ops_usage_r2_capacity",
    ]);
  });

  it("모든 ops 타입은 ops_ 접두사를 쓴다", () => {
    for (const [type, spec] of Object.entries(registry)) {
      if (spec.audience === "ops") expect(type.startsWith("ops_")).toBe(true);
      else expect(type.startsWith("ops_")).toBe(false);
    }
  });

  it("부서·교육 담당자 자격으로 받는 알림은 user 로 남긴다", () => {
    for (const type of [
      "dept_join_request", "dept_promotion_in",
      "edu_promotion_done", "edu_promotion_upcoming", "edu_absence",
    ]) {
      expect(notificationAudience(type)).toBe("user");
    }
  });

  // 회귀 방지: dept_join_request 를 무심코 ops 로 옮기지 않기 위한 근거를 코드에 남긴다.
  //
  // 이 알림의 본질은 전역 시스템 운영이 아니라 department-scoped workflow 다.
  // 주 수신자는 해당 부서의 department_members(grade <= 2) 실무자이고,
  // 일부 admin/office/pastor 가 추가 수신하는 것은 부수적이다.
  // ops 로 옮기면 전역 role 이 없는 부서 실무자가 운영 탭을 못 열어 알림을 놓친다.
  // 별도 ops_dept_join_request 를 만들지 않는다는 것도 함께 고정한다.
  it("dept_join_request 는 department workflow 이므로 ops 로 옮기지 않는다", () => {
    expect(notificationAudience("dept_join_request")).toBe("user");
    expect(notificationCategory("dept_join_request")).toBe("department");
    expect(registeredTypes.has("ops_dept_join_request")).toBe(false);
    expect(legacyTypes.has("dept_join_request")).toBe(false);
  });

  it("필수/선택 운영 알림 구분이 고정되어 있다", () => {
    const required = Object.entries(registry)
      .filter(([, spec]) => spec.required)
      .map(([type]) => type).sort();
    expect(required).toEqual([
      "ops_bulletin_sync_error",
      "ops_message_report",
      "ops_usage_anomaly",
      "ops_usage_db_capacity",
      "ops_usage_r2_capacity",
    ]);
    // 필수는 반드시 ops 여야 한다
    for (const type of required) expect(notificationAudience(type)).toBe("ops");
  });
});
