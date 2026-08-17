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
    // startGeofencingAsync 에 실제로 넘어간 region 목록을 기록해 재등록 좌표를 검증한다.
    registeredRegions: [] as Array<{ identifier: string; latitude: number; longitude: number; radius: number }>,
    stopCalls: 0,
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
  startGeofencingAsync: async (_task: string, regions: Array<{ identifier: string; latitude: number; longitude: number; radius: number }>) => {
    h.state.geofencingStarted = true;
    h.state.registeredRegions = regions;
  },
  stopGeofencingAsync: async () => { h.state.geofencingStarted = false; h.state.stopCalls += 1; },
  getLastKnownPositionAsync: async () => null,
}));

vi.mock('expo-task-manager', () => ({
  defineTask: (_name: string, fn: (body: { data?: unknown; error?: { message: string } | null }) => Promise<void>) => {
    h.state.task = fn;
  },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import {
  EVENT_VERSION,
  applyGeofenceAndDetectPresence,
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
  h.state.registeredRegions = [];
  h.state.stopCalls = 0;

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

describe('출석 확인 중복 실행 방지', () => {
  it('진행 중인 maybeConfirmAttendance 호출은 같은 Promise를 재사용한다', async () => {
    seedSession();

    const first = maybeConfirmAttendance('token-1');
    const second = maybeConfirmAttendance('token-1');

    expect(second).toBe(first);
    await first;
    expect(calls.filter((url) => url.endsWith('/api/mobile/attendance-status'))).toHaveLength(1);
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

describe('교회 위치 저장 직후 재등록 + 즉시 진입 판정', () => {
  // 새 교회 좌표 = 사용자가 서 있는 자리 (대전). 기존 저장값은 울산.
  const MOVED: Geofence = { ...GEOFENCE, latitude: 36.331919, longitude: 127.436083 };

  it('좌표가 바뀌면 기존 지오펜스를 해제하고 새 좌표로 다시 등록한다', async () => {
    seedSession();
    await syncAttendanceGeofence('token-1');
    expect(h.state.registeredRegions[0]).toMatchObject({
      identifier: GEOFENCE.id, latitude: GEOFENCE.latitude, longitude: GEOFENCE.longitude, radius: 150,
    });

    server.geofence = MOVED;
    const stopsBefore = h.state.stopCalls;
    await applyGeofenceAndDetectPresence('token-1');

    expect(h.state.stopCalls).toBeGreaterThan(stopsBefore);   // 기존 지오펜스 해제
    expect(h.state.registeredRegions[0]).toMatchObject({      // 새 좌표·반경으로 재등록
      identifier: MOVED.id, latitude: 36.331919, longitude: 127.436083, radius: 150,
    });
  });

  it('이미 반경 안에서 교회 위치를 현재 위치로 바꾸면 즉시 진입으로 기록한다', async () => {
    seedSession();
    server.geofence = MOVED;
    h.state.coords = { latitude: 36.331919, longitude: 127.436083, accuracy: 5 };

    const result = await applyGeofenceAndDetectPresence('token-1');

    expect(result.registered).toBe(true);
    expect(result.inside).toBe(true);
    expect(result.enteredAt).toBe(new Date(BASE).toISOString());
    expect(result.message).toContain('현재 교회 반경 안에 있습니다');
    // 진입 기록이 실제로 서버로 전송됐는지
    expect(calls.some((url) => url.endsWith('/api/mobile/attendance-candidate'))).toBe(true);
    const event = readEvent()!;
    expect(event.status).toBe('open');
    expect(event.enteredAt).toBe(new Date(BASE).toISOString());
  });

  it('반경 밖이면 등록만 하고 진입 기록을 남기지 않으며 거리를 알려준다', async () => {
    seedSession();
    server.geofence = MOVED;
    h.state.coords = { latitude: 36.5, longitude: 127.9, accuracy: 5 };

    const result = await applyGeofenceAndDetectPresence('token-1');

    expect(result.registered).toBe(true);
    expect(result.inside).toBe(false);
    expect(result.enteredAt).toBeNull();
    expect(result.message).toContain('교회 반경 밖');
    expect(readEvent()).toBeNull();
    expect(calls.some((url) => url.endsWith('/api/mobile/attendance-candidate'))).toBe(false);
  });

  it('오늘 진입 기록이 이미 있으면 진입 시각을 덮어쓰지 않는다', async () => {
    seedSession();
    h.state.coords = { latitude: 35.524065, longitude: 129.432155, accuracy: 5 };
    await fireEnter();
    const first = readEvent()!.enteredAt;

    advance(600);
    const result = await applyGeofenceAndDetectPresence('token-1');

    expect(result.inside).toBe(true);
    expect(readEvent()!.enteredAt).toBe(first);     // 유지
    expect(result.enteredAt).toBe(first);
    expect(result.alreadyRecorded).toBe(true);
  });

  it('이미 출석이 확정돼 있으면 중복 기록하지 않는다', async () => {
    seedSession();
    server.attendance = { source: 'auto_geofence', recorded_at: new Date(BASE).toISOString() };

    const result = await applyGeofenceAndDetectPresence('token-1');

    expect(result.inside).toBe(true);
    expect(result.alreadyRecorded).toBe(true);
    expect(result.enteredAt).toBeNull();
    expect(result.message).toContain('이미 기록');
  });

  it('반경 밖으로 나갔다가 다시 들어오면 새 진입 시각으로 시작한다', async () => {
    seedSession();
    await fireEnter();
    const first = readEvent()!.enteredAt;

    advance(60);
    await fireExit();
    expect(readEvent()!.status).toBe('closed');

    advance(600);
    const result = await applyGeofenceAndDetectPresence('token-1');

    expect(result.inside).toBe(true);
    expect(result.enteredAt).not.toBe(first);
    expect(result.enteredAt).toBe(new Date(BASE + 660_000).toISOString());
    expect(readEvent()!.status).toBe('open');
  });

  it('운영시간 밖이면 등록만 하고 진입 기록은 남기지 않는다', async () => {
    seedSession();
    server.geofence = { ...GEOFENCE, window_start: '01:00:00', window_end: '02:00:00' };

    const result = await applyGeofenceAndDetectPresence('token-1');

    expect(result.registered).toBe(true);
    expect(result.message).toContain('운영시간');
    expect(readEvent()).toBeNull();
  });

  it("'항상 허용' 권한이 없으면 등록 실패를 그대로 알린다", async () => {
    seedSession();
    h.state.background = 'denied';

    const result = await applyGeofenceAndDetectPresence('token-1');

    expect(result.registered).toBe(false);
    expect(result.message).toContain('항상 허용');
  });

  it('기기 스냅샷이 실제 등록된 좌표를 노출한다 (DB 값과 대조 가능)', async () => {
    seedSession();
    server.geofence = MOVED;
    await applyGeofenceAndDetectPresence('token-1');

    const snapshot = await getAttendanceSnapshot();
    expect(snapshot.geofence).toMatchObject({ latitude: 36.331919, longitude: 127.436083, radiusM: 150 });
    expect(snapshot.geofencingStarted).toBe(true);
  });
});

describe('이탈·재진입·날짜 변경', () => {
  it('진입 후 3분 만에 이탈하면 자동출석이 되지 않고 세션이 종료된다', async () => {
    seedSession();
    await fireEnter();
    advance(180);
    await fireExit();

    const event = readEvent()!;
    expect(event.status).toBe('closed');
    expect(event.exitedAt).toBeTruthy();

    // 이탈 후 앱을 열어도 확정되지 않는다.
    const confirmed = await maybeConfirmAttendance('token-1');
    expect(confirmed).toBe(false);
    expect(calls.some((url) => url.endsWith('/confirm'))).toBe(false);
  });

  it('미완료 3분은 다음 진입에 이어지지 않고 0부터 다시 센다', async () => {
    seedSession();
    await fireEnter();
    advance(180);
    await fireExit();

    advance(1200);
    await fireEnter();
    const session = readEvent()!;
    // 새 진입 시각 = 지금. 이전 3분과 합산하지 않는다.
    expect(session.enteredAt).toBe(new Date(BASE + 1380 * 1000).toISOString());
    expect(elapsedSecondsSince(session.enteredAt, Date.now())).toBe(0);

    // 재진입 직후에는 체류 미달로 확정되지 않는다.
    expect(await maybeConfirmAttendance('token-1')).toBe(false);
    expect(lastCode()).toBe('dwell_short');
  });

  it('재진입 후 5분을 채우면 자동출석이 확정된다', async () => {
    seedSession();
    await fireEnter();
    advance(180);
    await fireExit();

    advance(60);
    await fireEnter();
    advance(301);
    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(true);
    expect(lastCode()).toBe('confirmed');
    expect(readEvent()!.status).toBe('closed');
  });

  it('출석 완료 후 이탈·재진입해도 중복 출석을 만들지 않고 완료를 취소하지 않는다', async () => {
    seedSession();
    await fireEnter();
    advance(301);
    expect(await maybeConfirmAttendance('token-1')).toBe(true);

    // 서버 상태를 확정 이후로 맞춘다.
    server.attendance = { source: 'auto_geofence', recorded_at: new Date(Date.now()).toISOString() };
    server.candidate = { status: 'confirmed', entered_at: new Date(BASE).toISOString(), dwell_seconds: 301 };
    const confirmCallsBefore = calls.filter((url) => url.endsWith('/confirm')).length;

    advance(60);
    await fireExit();
    advance(600);
    await fireEnter();
    const confirmedAgain = await maybeConfirmAttendance('token-1');

    expect(confirmedAgain).toBe(false);
    expect(calls.filter((url) => url.endsWith('/confirm')).length).toBe(confirmCallsBefore);
    expect(server.attendance).not.toBeNull();   // 완료 기록 보존
  });

  it('반경 밖에서 자정이 지난 뒤 진입하면 새 날짜로 기록한다', async () => {
    seedSession();
    // 2026-08-05 23:50 KST
    vi.setSystemTime(Date.parse('2026-08-05T14:50:00.000Z'));
    await fireEnter();
    expect(readEvent()!.localDate).toBe('2026-08-05');
    await fireExit();

    // 2026-08-06 00:10 KST — 날짜 변경 후 재진입
    vi.setSystemTime(Date.parse('2026-08-05T15:10:00.000Z'));
    await fireEnter();

    const session = readEvent()!;
    expect(session.localDate).toBe('2026-08-06');
    expect(session.enteredAt).toBe(new Date(Date.parse('2026-08-05T15:10:00.000Z')).toISOString());
  });

  it('반경 안에서 자정을 넘기면 전날 체류를 이월하지 않고 새 날짜 세션으로 재판정한다', async () => {
    seedSession();
    // 2026-08-05 23:50 KST 진입 (이탈 없음 → ENTER 이벤트도 더 오지 않음)
    vi.setSystemTime(Date.parse('2026-08-05T14:50:00.000Z'));
    await fireEnter();
    const yesterday = readEvent()!;
    expect(yesterday.localDate).toBe('2026-08-05');

    // 2026-08-06 00:20 KST 앱 복귀 → 날짜 재판정 경로
    vi.setSystemTime(Date.parse('2026-08-05T15:20:00.000Z'));
    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(false);
    expect(lastCode()).toBe('date_rolled');
    const session = readEvent()!;
    expect(session.localDate).toBe('2026-08-06');
    // 전날 23:50 이 아니라 지금(00:20)부터 다시 센다.
    expect(session.enteredAt).toBe(new Date(Date.parse('2026-08-05T15:20:00.000Z')).toISOString());
    expect(elapsedSecondsSince(session.enteredAt, Date.now())).toBe(0);
  });

  it('Asia/Seoul 자정과 UTC 날짜가 다른 시각에도 local_date 는 서울 기준이다', async () => {
    seedSession();
    // 2026-08-05 15:30 UTC = 2026-08-06 00:30 KST
    vi.setSystemTime(Date.parse('2026-08-05T15:30:00.000Z'));
    await fireEnter();

    expect(readEvent()!.localDate).toBe('2026-08-06');
    expect(localDateInTimeZone(new Date(), 'UTC')).toBe('2026-08-05');
    expect(localDateInTimeZone(new Date(), 'Asia/Seoul')).toBe('2026-08-06');
  });

  it('EXIT 이벤트가 늦게 또는 중복으로 도착해도 확정된 출석과 새 세션을 훼손하지 않는다', async () => {
    seedSession();
    await fireEnter();
    advance(301);
    expect(await maybeConfirmAttendance('token-1')).toBe(true);
    const afterConfirm = readEvent()!;

    // 지연 EXIT 2회
    advance(30);
    await fireExit();
    await fireExit();
    const afterExits = readEvent()!;
    expect(afterExits.status).toBe('closed');
    expect(afterExits.enteredAt).toBe(afterConfirm.enteredAt);

    // 이후 새 진입은 정상적으로 새 세션을 만든다.
    advance(600);
    await fireEnter();
    const fresh = readEvent()!;
    expect(fresh.status).toBe('open');
    expect(fresh.enteredAt).not.toBe(afterConfirm.enteredAt);
  });

  it('앱이 종료된 동안 이탈했다가 재실행하면 반경 밖으로 판정하고 확정하지 않는다', async () => {
    seedSession();
    await fireEnter();               // 반경 안에서 진입
    advance(1800);                   // 앱 종료 상태로 30분 경과 (EXIT 이벤트 못 받음)
    h.state.coords = { latitude: 36.6, longitude: 127.5, accuracy: 10 };  // 실제로는 밖

    const confirmed = await maybeConfirmAttendance('token-1');

    expect(confirmed).toBe(false);
    expect(lastCode()).toBe('outside_radius');
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
