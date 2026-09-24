// Supabase 마이그레이션 정적 검증.
//
// 배경: 2026-10-30 부터 Supabase 는 public 스키마 신규 테이블에 Data API 권한을
// 자동 부여하지 않는다. GRANT 를 빠뜨린 마이그레이션은 Production 에서는
// (기존 자동부여 덕에) 멀쩡해 보이고, db reset / preview branch / 신규 프로젝트
// 에서만 42501 로 터진다. 사람이 리뷰로 잡기 어려운 종류라 기계로 막는다.
//
// 기존 319개 마이그레이션에 소급 적용하면 전부 실패하므로, 규칙은 CLAUDE.md 에
// 규칙을 명문화한 시점(CUTOFF) 이후 마이그레이션에만 적용한다. 과거 파일은
// 중복 타임스탬프 검사만 받는다.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../MS_AX/chflow-project/supabase/migrations");

// 이 타임스탬프 이상인 마이그레이션에만 GRANT 규칙을 적용한다.
const CUTOFF = "20260924000000";

// 테이블 GRANT 없이 CREATE TABLE 하는 게 정당한 경우(RPC 전용 테이블 등)
// 마이그레이션 안에 아래 주석을 남기면 통과한다.
//   -- no-data-api: <테이블명> — <이유>
const OPT_OUT = /--\s*no-data-api:\s*([a-z0-9_]+)/gi;

const problems = [];
const fail = (file, rule, message) => problems.push({ file, rule, message });

/** 주석·문자열·달러인용 본문을 공백으로 치운다. 함수 본문 안의 DDL 오탐을 막는다. */
function stripSql(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (rest[0] === "'") {
      const end = sql.indexOf("'", i + 1);
      i = end < 0 ? sql.length : end + 1;
      out += " ";
      continue;
    }
    const dollar = /^\$([a-z_]*)\$/i.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      i = end < 0 ? sql.length : end + tag.length;
      out += " ";
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/** GRANT/REVOKE 문에서 대상 테이블명과 역할을 뽑는다. 함수 대상은 건너뛴다. */
function privilegeStatements(stripped, keyword) {
  const pattern = new RegExp(`\\b${keyword}\\s+([\\s\\S]*?)\\s+ON\\s+([\\s\\S]*?)\\s+(?:TO|FROM)\\s+([^;]+);`, "gi");
  const found = [];
  for (const match of stripped.matchAll(pattern)) {
    const [, privileges, target, roles] = match;
    if (/\bfunction\b|\bexecute\b|\bprocedure\b|\broutine\b/i.test(`${privileges} ${target}`)) continue;
    const tables = [...target.matchAll(/public\.\"?([a-z0-9_]+)\"?/gi)].map((m) => m[1].toLowerCase());
    const grantees = roles.split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase()).filter(Boolean);
    found.push({ privileges: privileges.trim().toLowerCase(), tables, grantees });
  }
  return found;
}

const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

// ── 규칙 1: 타임스탬프 중복 ──────────────────────────────────────────
const byTimestamp = new Map();
for (const file of files) {
  const stamp = file.slice(0, 14);
  if (!/^\d{14}$/.test(stamp)) {
    fail(file, "filename", "파일명이 <14자리 timestamp>_name.sql 형식이 아니다 — CLI 가 건너뛴다.");
    continue;
  }
  if (byTimestamp.has(stamp)) {
    fail(file, "duplicate-timestamp", `타임스탬프가 ${byTimestamp.get(stamp)} 와 중복된다 — 적용 순서가 불안정해진다.`);
  } else {
    byTimestamp.set(stamp, file);
  }
}

// ── 이력 누적: 과거에 회수된 (테이블, 역할) 짝 ────────────────────────
const revoked = new Map(); // "table:role" -> 회수한 마이그레이션 파일명

for (const file of files) {
  const raw = readFileSync(resolve(migrationsDir, file), "utf8");
  const sql = stripSql(raw);
  const stamp = file.slice(0, 14);
  const enforced = /^\d{14}$/.test(stamp) && stamp >= CUTOFF;

  const grants = privilegeStatements(sql, "GRANT");
  const revokes = privilegeStatements(sql, "REVOKE");

  if (enforced) {
    // ── 규칙 2: CREATE TABLE 했으면 같은 마이그레이션에 GRANT 가 있어야 한다 ──
    const optedOut = new Set([...raw.matchAll(OPT_OUT)].map((m) => m[1].toLowerCase()));
    const granted = new Set(grants.flatMap((g) => g.tables));
    const created = [...sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)]
      .map((m) => m[1].toLowerCase());
    for (const table of new Set(created)) {
      if (granted.has(table) || optedOut.has(table)) continue;
      fail(file, "missing-grant",
        `public.${table} 를 만들면서 Data API GRANT 가 없다. `
        + `2026-10-30 이후 신규 환경에서 PostgREST 42501 로 막힌다. `
        + `RPC 전용이라 의도한 것이면 "-- no-data-api: ${table} — 이유" 주석을 남겨라.`);
    }

    // ── 규칙 3: 광범위 GRANT 금지 ──────────────────────────────────
    for (const grant of grants) {
      for (const role of grant.grantees) {
        if (role === "public") {
          fail(file, "broad-grant", `PUBLIC 에 테이블 권한을 부여했다 (${grant.tables.join(", ") || "대상 불명"}) — 역할을 명시해라.`);
        }
        if (role === "anon" && /\ball\b/.test(grant.privileges)) {
          fail(file, "broad-grant", `anon 에 GRANT ALL 을 했다 (${grant.tables.join(", ") || "대상 불명"}) — 비로그인에 필요한 동작만 부여해라.`);
        }
      }
    }

    // ── 규칙 4: 과거에 회수한 권한을 되살리지 마라 ──────────────────
    for (const grant of grants) {
      for (const table of grant.tables) {
        for (const role of grant.grantees) {
          const key = `${table}:${role}`;
          if (revoked.has(key)) {
            fail(file, "regrant-revoked",
              `public.${table} 의 ${role} 권한은 ${revoked.get(key)} 에서 의도적으로 회수됐는데 다시 부여한다. `
              + `되살릴 의도라면 그 이유를 커밋 메시지에 남기고 이 규칙을 예외 처리해라.`);
          }
        }
      }
    }

    // ── 규칙 5: 형태 검사 (로컬 Postgres 가 없어 문법 검증은 여기까지) ──
    const opens = (sql.match(/\(/g) || []).length;
    const closes = (sql.match(/\)/g) || []).length;
    if (opens !== closes) {
      fail(file, "syntax", `괄호 짝이 맞지 않는다 (여는 괄호 ${opens}개 / 닫는 괄호 ${closes}개).`);
    }
    const dollars = (raw.match(/\$[a-z_]*\$/gi) || []).length;
    if (dollars % 2 !== 0) {
      fail(file, "syntax", `달러 인용($$)이 닫히지 않았다 (${dollars}개).`);
    }
    if (sql.trim() && !sql.trim().endsWith(";")) {
      fail(file, "syntax", "마지막 구문이 세미콜론으로 끝나지 않는다.");
    }
  }

  // 회수 이력은 CUTOFF 이전 파일에서도 누적해야 한다.
  for (const revoke of revokes) {
    for (const table of revoke.tables) {
      for (const role of revoke.grantees) {
        revoked.set(`${table}:${role}`, file);
      }
    }
  }
  // 같은 마이그레이션에서 회수 후 재부여하는 건 정상 패턴이므로 되돌린다.
  for (const grant of grants) {
    for (const table of grant.tables) {
      for (const role of grant.grantees) {
        if (revoked.get(`${table}:${role}`) === file) revoked.delete(`${table}:${role}`);
      }
    }
  }
}

const enforcedCount = files.filter((f) => f.slice(0, 14) >= CUTOFF).length;
console.log(`migration lint — 전체 ${files.length}개, 규칙 적용 대상 ${enforcedCount}개 (CUTOFF ${CUTOFF} 이상)`);

if (problems.length === 0) {
  console.log("통과: 문제 없음");
  process.exit(0);
}

for (const { file, rule, message } of problems) {
  console.error(`  [${rule}] ${file}\n    ${message}`);
}
console.error(`\n실패: ${problems.length}건`);
process.exit(1);
