import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * attendanceGeofence 의 체류 세션 상태기계 단위 테스트.
 * SecureStore / Location / fetch 는 모두 모킹하며 DB·실제 위치 API는 호출하지 않는다.
 */

const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  const state = {
    geofencingStarted: false,
    foreground: 'granted',
    background: 'granted',
    coords: { latitude: 35.524065, longitude: 129.432155, accuracy: 5 },
    positionThrows: false,
    task: null as null | ((body: { data?: unknown; error?: { message: string } | null }) => Promise<void>),
  };
  return { store, state };
});

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => (h.store.has(key) ? h.store.get(key)! : null),
  setItemAsync: async (key: string, value: string) => { h.store.set(key, value); },
  deleteItemAsync: async (key: string) => { h.store.delete(key); },
}));

vi.mock('expo-location', () => ({
  GeofencingEventType: { Enter: 1, Exit: 2 },
  Accuracy: { Balanced: 3, High: 4 },
  getCurrentPositionAsync: async () => {
    if (h.state.positionThrows) throw new Error('location unavailable');
    return { coords: h.state.coords };
  },
  requestForegroundPermissionsAsync: async () => ({ status: h.state.foreground }),
  requestBackgroundPermissionsAsync: async () => ({ status: h.state.background }),
  getForegroundPermissionsAsync: async () => ({ status: h.state.foreground }),
  getBackgroundPermissionsAsync: async () => ({ status: h.state.background }),
  hasStartedGeofencingAsync: async () => h.state.geofencingStarted,
  startGeofencingAsync: async () => { h.state.geofencingStarted = true; },
  stopGeofencingAsync: async () => { h.state.geofencingStarted = false; },
}));

vi.mock('expo-task-manager', () => ({
  defineTask: (_name: string, fn: (body: { data?: unknown; error?: { message: string } | null }) => Promise<void>) => {
    h.state.task = fn;
  },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import {
  EVENT_VERSION,
  elapsedSecondsSince,
  fingerprint,
  getAttendanceSnapshot,
  isOpenSessionFor,
  isWithinOperatingWindow,
  localDateInTimeZone,
  maybeConfirmAttendance,
  sessionMaxSeconds,
  syncAttendanceGeofence,
  type Geofence,
  type StoredEvent,
} from './attendanceGeofence';

const TOKEN_KEY = 'chflow.attendance.access-token';
const GEOFENCE_KEY = 'chflow.attendance.geofence';
const EVENT_KEY = 'chflow.attendance.geofence.event';
const DIAGNOSTIC_KEY = 'chflow.attendance.diagnostic';

const GEOFENCE: Geofence = {
  id: 'gf-1',
  name: '본당',
  latitude: 35.524065,
  longitude: 129.432155,
  radius_m: 150,
  dwell_seconds: 300,
  window_start: '00:00:00',
  window_end: '00:00:00',
  timezone: 'Asia/Seoul',
};

// 2026-08-05 10:00 (Asia/Seoul)
const BASE = Date.parse('2026-08-05T01:00:00.000Z');

type ServerState = {
  candidate: { status: string; entered_at: string; dwell_seconds: number } | null;
  attendance: { source: string; recorded_at: string } | null;
  geofence: Geofence | null;
  failCandidatePost: boolean;
  failConfirm: boolean;
};

let server: ServerState;
let calls: string[];

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  h.store.clear();
  h.state.geofencingStarted = false;
  h.state.foreground = 'granted';
  h.state.background = 'granted';
  h.state.coords = { latitude: 35.524065, longitude: 129.432155, accuracy: 5 };
  h.state.positionThrows = false;

  server = {
    candidate: null,
    attendance: null,
    geofence: GEOFENCE,
    failCandidatePost: false,
    failConfirm: false,
  };
  calls = [];

  vi.useFakeTimers();
  vi.setSystemTime(BASE);

  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/api/mobile/attendance-geofence')) {
      return jsonResponse({ ok: true, geofence: server.geofence });
    }
    if (url.endsWith('/api/mobile/attendance-candidate')) {
      if (server.failCandidatePost) return jsonResponse({}, false, 503);
      return jsonResponse({ ok: true, candidate: { id: 'cand-1' } });
    }
    if (url.endsWith('/api/mobile/attendance-candidate/confirm')) {
      if (server.failConfirm) return jsonResponse({}, false, 409);
      return jsonResponse({ ok: true, attendance: { id: 'att-1' } });
    }
    if (url.endsWith('/api/mobile/attendance-status')) {
      return jsonResponse({ ok: true, candidate: server.candidate, attendance: server.attendance });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
});

function seedSession() {
  h.store.set(TOKEN_KEY, 'token-1');
  h.store.set(GEOFENCE_KEY, JSON.stringify(GEOFENCE));
}

function readEvent(): StoredEvent | null {
  const raw = h.store.get(EVENT_KEY);
  return raw ? JSON.parse(raw) as StoredEvent : null;
}

function lastCode(): string | null {
  const raw = h.store.get(DIAGNOSTIC_KEY);
  return raw ? JSON.parse(raw).code as string : null;
}

async function fireEnter() {
  await h.state.task!({ data: { eventType: 1 }, error: null });
}

async function fireExit() {
  await h.state.task!({ data: { eventType: 2 }, error: null });
}

function advance(seconds: number) {
  vi.setSystemTime(Date.now() + seconds * 1000);
}

describe('순수 함수', () => {
  it('fingerprint는 좌표·반경·체류·타임존·운영시간 변화를 감지하고 이름 변화는 무시한다', () => {
    expect(fingerprint(GEOFENCE)).toBe(fingerprint({ ...GEOFENCE, name: '다른 이름' }));
    expect(fingerprint(GEOFENCE)).not.toBe(fingerprint({ ...GEOFENCE, latitude: 35.6 }));
    expect(fingerprint(GEOFENCE)).not.toBe(fingerprint({ ...GEOFENCE, longitude: 129.5 }));
    expect(fingerprint(GEOFENCE)).not.toBe(fingerprint({ ...GEOFENCE, radius_m: 200 }));
    expect(fingerprint(GEOFENCE)).not.toBe(fingerprint({ ...GEOFENCE, dwell_seconds: 600 }));
    expect(fingerprint(GEOFENCE)).not.toBe(fingerprint({ ...GEOFENCE, timezone: 'UTC' }));
    expect(fingerprint(GEOFENCE)).not.toBe(fingerprint({ ...GEOFENCE, window_start: '07:00:00' }));
    expect(fingerprint(GEOFENCE)).not.toBe(fingerprint({ ...GEOFENCE, window_end: '15:00:00' }));
  });

  it('sessionMaxSeconds는 하한 1시간·상한 2시간 안에서 체류 기준의 2배가 된다', () => {
    // 체류 5분 → 1시간 (하한 적용)
    expect(sessionMaxSeconds({ ...GEOFENCE, dwell_seconds: 300 })).toBe(3600);
    // 체류 30분 → 1시간 (2배가 하한과 같음)
    expect(sessionMaxSeconds({ ...GEOFENCE, dwell_seconds: 1800 })).toBe(3600);
    // 체류 60분 → 2시간 (상한 적용)
    expect(sessionMaxSeconds({ ...GEOFENCE, dwell_seconds: 3600 })).toBe(7200);
  });

  it('sessionMaxSeconds는 어떤 설정에서도 체류 기준보다 크다 (확정 불가 상태가 없어야 한다)', () => {
    for (let dwell = 300; dwell <= 3600; dwell += 300) {
      expect(sessionMaxSeconds({ ...GEOFENCE, dwell_seconds: dwell })).toBeGreaterThan(dwell);
    }
  });

  it('isWithinOperatingWindow — 시작=종료는 상시, 일반 구간, 자정 넘김 구간', () => {
    const at = (iso: string) => new Date(Date.parse(iso));
    expect(isWithinOperatingWindow(at('2026-08-05T01:00:00Z'), GEOFENCE)).toBe(true);
    const day = { ...GEOFENCE, window_start: '07:00:00', window_end: '15:00:00' };
    expect(isWithinOperatingWindow(at('2026-08-05T01:00:00Z'), day)).toBe(true);   // KST 10:00
    expect(isWithinOperatingWindow(at('2026-08-05T09:00:00Z'), day)).toBe(false);  // KST 18:00
    const overnight = { ...GEOFENCE, window_start: '22:00:00', window_end: '02:00:00' };
    expect(isWithinOperatingWindow(at('2026-08-05T16:00:00Z'), overnight)).toBe(true); // KST 01:00
    expect(isWithinOperatingWindow(at('2026-08-05T01:00:00Z'), overnight)).toBe(false);
  });

  it('localDateInTimeZone은 타임존 기준 날짜를 만든다', () => {
    expect(localDateInTimeZone(new Date(Date.parse('2026-08-04T15:30:00Z')), 'Asia/Seoul')).toBe('2026-08-05');
    expect(localDateInTimeZone(new Date(Date.parse('2026-08-04T15:30:00Z')), 'UTC')).toBe('2026-08-04');
  });

  it('elapsedSecondsSince는 음수와 잘못된 값을 0으로 만든다', () => {
    expect(elapsedSecondsSince(new Date(BASE - 90_000).toISOString(), BASE)).toBe(90);
    expect(elapsedSecondsSince(new Date(BASE + 90_000).toISOString(), BASE)).toBe(0);
    expect(elapsedSecondsSince('not-a-date', BASE)).toBe(0);
  });

  it('isOpenSessionFor는 상태·지오펜스·지문·날짜를 모두 확인한다', () => {
    const base: StoredEvent = {
      version: EVENT_VERSION,
      enteredAt: new Date(BASE).toISOString(),
      geofenceId: GEOFENCE.id,
      localDate: '2026-08-05',
      configFingerprint: fingerprint(GEOFENCE),
      status: 'open',
      lastEventAt: new Date(BASE).toISOString(),
      pendingSubmit: false,
      submitAttempts: 1,
    };
    expect(isOpenSessionFor(base, GEOFENCE, '2026-08-05')).toBe(true);
    expect(isOpenSessionFor({ ...base, status: 'closed' }, GEOFENCE, '2026-08-05')).toBe(false);
    expect(isOpenSessionFor({ ...base, localDate: '2026-08-04' }, GEOFENCE, '2026-08-05')).toBe(false);
    expect(isOpenSessionFor({ ...base, geofenceId: 'other' }, GEOFENCE, '2026-08-05')).toBe(false);
    expect(isOpenSessionFor(base, { ...GEOFENCE, radius_m: 200 }, '2026-08-05')).toBe(false);
    expect(isOpenSessionFor(base, { ...GEOFENCE, window_start: '07:00:00' }, '2026-08-05')).toBe(false);
    expect(isOpenSessionFor(null, GEOFENCE, '2026-08-05')).toBe(false);
  });
});

describe('세션 상태 전이', () => {
  it('1. 최초 Enter → open 세션 생성', async () => {
    seedSession();
    await fireEnter();

    const event = readEvent()!;
    expect(event.version).toBe(EVENT_VERSION);
    expect(event.status).toBe('open');
    expect(event.enteredAt).toBe(new Date(BASE).toISOString());
    expect(event.localDate).toBe('2026-08-05');
    expect(event.pendingSubmit).toBe(false);
    expect(lastCode()).toBe('enter_new');
  });

  it('2. 앱 재실행 초기 Inside → enteredAt 유지', async () => {
    seedSession();
    await fireEnter();
    const first = readEvent()!.enteredAt;

    advance(120);
    await fireEnter();

    expect(readEvent()!.enteredAt).toBe(first);
    expect(lastCode()).toBe('enter_kept');
  });

  it('3. 동일 설정으로 재동기화 → enteredAt 유지', async () => {
    seedSession();
    await fireEnter();
    const first = readEvent()!.enteredAt;

    advance(60);
    await syncAttendanceGeofence('token-1');

    expect(readEvent()).not.toBeNull();
    expect(readEvent()!.enteredAt).toBe(first);
    expect(lastCode()).toBe('geofencing_started');

    advance(60);
    await fireEnter();
    expect(readEvent()!.enteredAt).toBe(first);
    expect(lastCode()).toBe('enter_kept');
  });

  it('4. Exit → closed', async () => {
    seedSession();
    await fireEnter();

    advance(60);
    await fireExit();

    const event = readEvent()!;
    expect(event.status).toBe('closed');
    expect(event.exitedAt).toBeTruthy();
    expect(lastCode()).toBe('exit_closed');
  });

  it('5. Exit 후 재진입 → 새 enteredAt', async () => {
    seedSession();
    await fireEnter();
    const first = readEvent()!.enteredAt;

    advance(60);
    await fireExit();

    advance(1800);
    await fireEnter();

    const event = readEvent()!;
    expect(event.status).toBe('open');
    expect(event.enteredAt).not.toBe(first);
    expect(event.enteredAt).toBe(new Date(BASE + 1860 * 1000).toISOString());
    expect(lastCode()).toBe('enter_new');
  });

  it('6. 설정 지문 변경 → 세션 폐기 후 새 세션', async () => {
    seedSession();
    await fireEnter();
    const first = readEvent()!.enteredAt;

    advance(60);
    server.geofence = { ...GEOFENCE, radius_m: 200 };
    await syncAttendanceGeofence('token-1');
    expect(readEvent()).toBeNull();

    await fireEnter();
    expect(readEvent()!.enteredAt).not.toBe(first);
    expect(lastCode()).toBe('enter_new');
  });

  it('6-b. 운영시간 변경 → 기존 open 세션을 재사용하지 않는다', async () => {
    seedSession();
    await fireEnter();
    const first = readEvent()!.enteredAt;

    advance(60);
    server.geofence = { ...GEOFENCE, window_start: '07:00:00', window_end: '15:00:00' };
    await syncAttendanceGeofence('token-1');

    expect(readEvent()).toBeNull();
    expect(lastCode()).toBe('geofencing_started');

    advance(60);
    await fireEnter();
    const event = readEvent()!;
    expect(event.enteredAt).not.toBe(first);
    expect(event.enteredAt).toBe(new Date(BASE + 120_000).toISOString());
    expect(lastCode()).toBe('enter_new');
  });

  it('6-c. 운영시간만 바뀌어도 이전 지문의 세션은 확정에 쓰이지 않는다', async () => {
    seedSession();
    await fireEnter();

    // 저장된 지오펜스만 운영시간을 바꿔 두면 (sync 없이) 기존 세션은 무효가 된다.
    h.store.set(GEOFENCE_KEY, JSON.stringify({ ...GEOFENCE, window_start: '07:00:00', window_end: '15:00:00' }));

    advance(600);
    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(false);
    expect(lastCode()).toBe('no_local_session');
    // 서버 과거 값을 복원하지 않고 현재 시각부터 새로 시작한다.
    expect(readEvent()!.enteredAt).toBe(new Date(BASE + 600_000).toISOString());
  });

  it('7. 날짜 변경 → 새 세션', async () => {
    seedSession();
    await fireEnter();
    const stale = readEvent()!;
    h.store.set(EVENT_KEY, JSON.stringify({ ...stale, localDate: '2026-08-04' }));

    advance(60);
    await fireEnter();

    expect(readEvent()!.localDate).toBe('2026-08-05');
    expect(readEvent()!.enteredAt).toBe(new Date(BASE + 60_000).toISOString());
    expect(lastCode()).toBe('enter_new');
  });

  it('8. 세션 수명 초과 → 새 enteredAt', async () => {
    seedSession();
    await fireEnter();
    const first = readEvent()!.enteredAt;

    // sessionMaxSeconds(300) = 3600초
    advance(3601);
    await fireEnter();

    expect(readEvent()!.enteredAt).not.toBe(first);
    expect(lastCode()).toBe('enter_new');
  });

  it('14. 구버전 StoredEvent는 안전하게 폐기된다', async () => {
    seedSession();
    // v1 스키마 (version 필드 없음)
    h.store.set(EVENT_KEY, JSON.stringify({
      enteredAt: new Date(BASE - 7200_000).toISOString(),
      geofenceId: GEOFENCE.id,
    }));

    const snapshot = await getAttendanceSnapshot();
    expect(snapshot.session).toBeNull();

    await fireEnter();
    const event = readEvent()!;
    expect(event.version).toBe(EVENT_VERSION);
    expect(event.enteredAt).toBe(new Date(BASE).toISOString());
    expect(lastCode()).toBe('enter_new');
  });
});

describe('전송 실패 복구', () => {
  it('9. pendingSubmit 재전송 성공', async () => {
    seedSession();
    server.failCandidatePost = true;
    await fireEnter();
    expect(readEvent()!.pendingSubmit).toBe(true);
    expect(lastCode()).toBe('submit_failed');

    server.failCandidatePost = false;
    advance(60);
    await maybeConfirmAttendance('token-1');

    expect(readEvent()!.pendingSubmit).toBe(false);
    expect(readEvent()!.lastSubmitError).toBeUndefined();
  });

  it('10. pendingSubmit 재전송 실패 → 이벤트 보존 + 사유 기록', async () => {
    seedSession();
    server.failCandidatePost = true;
    await fireEnter();

    advance(60);
    await maybeConfirmAttendance('token-1');

    const event = readEvent()!;
    expect(event.pendingSubmit).toBe(true);
    expect(event.status).toBe('open');
    expect(event.lastSubmitError).toContain('503');
    expect(event.submitAttempts).toBeGreaterThanOrEqual(2);
  });

  it('만료된 세션은 재전송하지 않는다', async () => {
    seedSession();
    server.failCandidatePost = true;
    await fireEnter();
    const attemptsAfterEnter = readEvent()!.submitAttempts;

    // 수명을 넘긴 뒤에도 반경 밖이면 세션을 버린다.
    advance(3601);
    h.state.coords = { latitude: 36.6, longitude: 127.5, accuracy: 5 };
    await maybeConfirmAttendance('token-1');

    expect(readEvent()).toBeNull();
    expect(attemptsAfterEnter).toBe(1);
    expect(lastCode()).toBe('session_expired');
  });
});

describe('출석 확정 판정', () => {
  it('11. 서버의 과거 entered_at·dwell_seconds는 체류시간 계산에 쓰이지 않는다', async () => {
    seedSession();
    // 서버에는 5시간 전 진입 + 18000초 누적 체류가 남아 있다 (Exit 후 재진입 상황)
    server.candidate = {
      status: 'candidate',
      entered_at: new Date(BASE - 5 * 3600 * 1000).toISOString(),
      dwell_seconds: 18_000,
    };

    await fireEnter();
    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(false);
    expect(lastCode()).toBe('dwell_short');
    expect(calls.some((url) => url.endsWith('/confirm'))).toBe(false);
  });

  it('로컬 세션이 최소 체류를 채우면 확정된다', async () => {
    seedSession();
    await fireEnter();

    advance(301);
    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(true);
    expect(readEvent()!.status).toBe('closed');
    expect(lastCode()).toBe('confirmed');
    expect(calls.some((url) => url.endsWith('/confirm'))).toBe(true);
  });

  it('12. 이미 출석한 경우 로컬 세션을 종료한다', async () => {
    seedSession();
    await fireEnter();
    server.attendance = { source: 'manual', recorded_at: new Date(BASE).toISOString() };

    advance(600);
    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(false);
    expect(readEvent()!.status).toBe('closed');
    expect(lastCode()).toBe('already_attended');
    expect(calls.some((url) => url.endsWith('/confirm'))).toBe(false);
  });

  it('13. 반경 밖이면 확정되지 않는다', async () => {
    seedSession();
    await fireEnter();

    advance(600);
    h.state.coords = { latitude: 35.6, longitude: 129.6, accuracy: 10 };
    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(false);
    expect(readEvent()!.status).toBe('open');
    expect(lastCode()).toBe('outside_radius');
    expect(calls.some((url) => url.endsWith('/confirm'))).toBe(false);
  });

  it('로컬 세션이 없으면 서버 값을 복원하지 않고 현재 시각부터 새로 시작한다', async () => {
    seedSession();
    server.candidate = {
      status: 'candidate',
      entered_at: new Date(BASE - 5 * 3600 * 1000).toISOString(),
      dwell_seconds: 18_000,
    };

    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(false);
    expect(lastCode()).toBe('no_local_session');
    const event = readEvent()!;
    expect(event.enteredAt).toBe(new Date(BASE).toISOString());
    expect(calls.some((url) => url.endsWith('/confirm'))).toBe(false);
  });
});

describe('권한·등록 실패 진단', () => {
  it("'항상 허용'이 없으면 지오펜스를 등록하지 않고 사유를 남긴다", async () => {
    seedSession();
    h.state.background = 'denied';

    const started = await syncAttendanceGeofence('token-1');

    expect(started).toBe(false);
    expect(h.state.geofencingStarted).toBe(false);
    expect(lastCode()).toBe('background_denied');
  });

  it('활성 지오펜스가 없으면 감지를 중지하고 세션을 지운다', async () => {
    seedSession();
    await fireEnter();
    expect(readEvent()).not.toBeNull();

    server.geofence = null;
    const started = await syncAttendanceGeofence('token-1');

    expect(started).toBe(false);
    expect(readEvent()).toBeNull();
    expect(h.store.get(GEOFENCE_KEY)).toBeUndefined();
    expect(lastCode()).toBe('no_geofence');
  });
});
