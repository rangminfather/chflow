// 운영 알림 탭을 추가하면서 폴링 비용이 늘지 않았는지 소스 수준에서 고정한다.
//
// 직전 작업에서 알림벨 폴링을 10초 고정 → Realtime + 5분 안전동기화 / 실패 시 backoff 로
// 줄였다. 탭별 조회나 탭 전용 timer 가 생기면 그 최적화가 무효가 되므로 여기서 막는다.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../components/NotificationBell.tsx"), "utf8");

const count = (pattern: RegExp) => (source.match(pattern) || []).length;

describe("알림벨 폴링 비용", () => {
  it("한 번의 동기화가 목록 1 + 카운트 1 만 호출한다", () => {
    const syncStart = source.indexOf("const syncNotifications");
    const syncEnd = source.indexOf("// 표시 이력 복원");
    expect(syncStart).toBeGreaterThan(-1);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncBody = source.slice(syncStart, syncEnd);

    expect((syncBody.match(/fetchNotifications\(/g) || []).length).toBe(1);
    expect((syncBody.match(/fetchNotificationCounts\(/g) || []).length).toBe(1);
    // 알림 설정은 최초 1회만 (includePreferences 로 분기)
    expect((syncBody.match(/fetchNotificationPreferences\(/g) || []).length).toBe(1);
    expect(syncBody).toContain("includePreferences");
  });

  it("목록 조회는 컴포넌트 전체에서 한 곳뿐이다 (탭별 조회 금지)", () => {
    expect(count(/fetchNotifications\(/g)).toBe(1);
  });

  it("audience 를 인자로 넘겨 탭별로 나눠 조회하지 않는다", () => {
    expect(source).not.toMatch(/fetchNotifications\([^)]*audience/);
    expect(source).not.toMatch(/fetchNotifications\([^)]*"ops"/);
  });

  it("탭 전환은 상태만 바꾼다 (조회·타이머 생성 없음)", () => {
    for (const tab of ["all", "message", "notice", "ops", "settings"]) {
      expect(source).toContain(`handleTabChange("${tab}")`);
    }
    // 탭 상태를 의존성으로 하는 폴링 effect 가 없어야 한다
    expect(source).not.toMatch(/\[[^\]]*activeTab[^\]]*\]\s*\)\s*;?\s*\n\s*\/\/\s*폴링/);
    expect(source).not.toMatch(/activeTab[\s\S]{0,120}setTimeout\(/);
  });

  it("주기 실행 타이머는 하나뿐이고 setInterval 은 쓰지 않는다", () => {
    expect(count(/setInterval\(/g)).toBe(0);
    // 폴링 스케줄러는 schedule() 안의 timer = setTimeout(...) 한 곳뿐이다.
    // (나머지 setTimeout 은 토스트 표시·해제 애니메이션용이라 서버 호출과 무관하다)
    expect(count(/timer = setTimeout\(/g)).toBe(1);
    expect(count(/clearTimeout\(/g)).toBeGreaterThanOrEqual(1);
  });

  it("in-flight 중복 차단과 backoff 를 유지한다", () => {
    expect(source).toContain("syncInFlightRef");
    expect(source).toContain("nextNotificationFallbackDelay");
    expect(source).toContain("NOTIFICATION_SAFETY_SYNC_MS");
    expect(source).toContain("document.visibilityState");
  });

  it("모두 읽음은 audience 범위를 명시하고 재조회를 유발하지 않는다", () => {
    // 범위 없는 markAllRead() 호출이 남아 있으면 user+ops 가 함께 읽음 처리된다.
    expect(source).not.toMatch(/markAllRead\(\s*\)/);
    expect(source).toContain('markAllRead(audience)');
    expect(source).toContain('markScopeRead("user")');
    expect(source).toContain('markScopeRead("ops")');
    // 모두 읽음 후 카운트를 다시 조회하지 않는다 (이미 가진 counts 로 갱신)
    const scopeStart = source.indexOf("const markScopeRead");
    const scopeEnd = source.indexOf("const handleTabChange");
    expect(scopeStart).toBeGreaterThan(-1);
    expect(scopeEnd).toBeGreaterThan(scopeStart);
    const scopeBody = source.slice(scopeStart, scopeEnd);
    expect(scopeBody).not.toContain("fetchNotificationCounts");
    expect(scopeBody).not.toContain("fetchNotifications");
  });

  it("운영 탭을 실제로 열 때만 운영 알림을 읽음 처리한다", () => {
    const tabStart = source.indexOf("const handleTabChange");
    const tabEnd = source.indexOf("const handleBellClick");
    const tabBody = source.slice(tabStart, tabEnd);
    expect(tabBody).toMatch(/tab === "ops"[\s\S]{0,60}markScopeRead\("ops"\)/);
    // 종을 열 때는 내 알림만 읽음 처리한다
    const bellBody = source.slice(tabEnd, source.indexOf("// === 패널 드래그 핸들러"));
    expect(bellBody).toContain('markScopeRead("user")');
    expect(bellBody).not.toContain('markScopeRead("ops")');
  });

  it("탭별 미읽음 숫자는 이미 받은 카운트 응답에서 계산한다", () => {
    expect(source).toContain("counts.opsViewer");
    expect(source).toContain("tabCounts");
    // 카운트 RPC 는 동기화 + 개별 삭제 후 재조회 두 곳까지만 허용한다
    expect(count(/fetchNotificationCounts\(/g)).toBeLessThanOrEqual(2);
  });
});
