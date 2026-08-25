import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export const ATTENDANCE_TASK = 'chflow-attendance-geofence';
const TOKEN_KEY = 'chflow.attendance.access-token';
const GEOFENCE_KEY = 'chflow.attendance.geofence';
const EVENT_KEY = `${GEOFENCE_KEY}.event`;
const DIAGNOSTIC_KEY = 'chflow.attendance.diagnostic';
const API_ORIGIN = 'https://chflow-app.vercel.app';

// iOS는 지오펜스 이벤트 처리에 약 10초만 허용한다. 그 안에서 끝내기 위한 상한.
const SUBMIT_TIMEOUT_MS = 8_000;
// 저장 이벤트 스키마 버전. 구버전 값은 폐기하고 새 체류 세션으로 시작한다.
export const EVENT_VERSION = 2;
// Exit 이벤트를 놓친 채 열려 있는 세션의 최대 수명 하한·상한.
// 하한이 있어야 체류 기준이 짧아도 정상 체류가 끊기지 않고,
// 상한이 있어야 체류 기준이 길 때 조기 확정 창이 무한정 커지지 않는다.
const MIN_SESSION_MAX_SECONDS = 3_600;
const MAX_SESSION_MAX_SECONDS = 7_200;
// 서버 API가 허용하는 dwellSeconds 상한.
const MAX_DWELL_SECONDS = 86_400;

export type Geofence = {
  id: string;
  name?: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  dwell_seconds: number;
  window_start: string;
  window_end: string;
  timezone: string;
};

type SessionStatus = 'open' | 'closed';

/**
 * 기기에 저장하는 "현재 연속 체류 세션".
 * 체류시간 판정은 오직 이 값의 enteredAt만 사용한다.
 * 서버 candidate.entered_at / dwell_seconds 는 당일 최초 진입·최대 관측치라서
 * 현재 세션의 시작 시각이 아니므로 판정에 사용하지 않는다.
 */
export type StoredEvent = {
  version: number;
  enteredAt: string;
  geofenceId: string;
  localDate: string;
  configFingerprint: string;
  status: SessionStatus;
  lastEventAt: string;
  exitedAt?: string;
  pendingSubmit: boolean;
  submitAttempts: number;
  lastSubmitError?: string;
};

export type AttendanceDiagnosticCode =
  | 'no_geofence'
  | 'config_fetch_failed'
  | 'config_changed'
  | 'foreground_denied'
  | 'background_denied'
  | 'geofencing_start_failed'
  | 'geofencing_started'
  | 'geofencing_stopped'
  | 'outside_window'
  | 'enter_new'
  | 'enter_kept'
  | 'exit_closed'
  | 'submit_failed'
  | 'submit_retried'
  | 'no_local_session'
  | 'date_rolled'
  | 'session_expired'
  | 'dwell_short'
  | 'position_failed'
  | 'outside_radius'
  | 'confirm_failed'
  | 'confirmed'
  | 'already_attended'
  | 'candidate_closed'
  | 'task_error';

export type AttendanceDiagnostic = {
  code: AttendanceDiagnosticCode;
  message?: string;
  at: string;
  sessionStartedAt?: string;
  dwellSeconds?: number;
  requiredSeconds?: number;
  distanceM?: number;
  accuracyM?: number;
};

export type AttendanceSnapshot = {
  platform: string;
  foregroundPermission: string;
  backgroundPermission: string;
  geofencingStarted: boolean;
  geofence: {
    name: string;
    latitude: number;
    longitude: number;
    radiusM: number;
    dwellSeconds: number;
    windowStart: string;
    windowEnd: string;
    timezone: string;
  } | null;
  session: {
    enteredAt: string;
    status: SessionStatus;
    localDate: string;
    elapsedSeconds: number;
    pendingSubmit: boolean;
    lastSubmitError?: string;
  } | null;
  lastDiagnostic: AttendanceDiagnostic | null;
};

let diagnosticListener: ((diagnostic: AttendanceDiagnostic) => void) | null = null;

/** 앱이 포그라운드일 때 진단 결과를 WebView로 흘려보내기 위한 후크. */
export function setAttendanceDiagnosticListener(
  listener: ((diagnostic: AttendanceDiagnostic) => void) | null,
) {
  diagnosticListener = listener;
}

async function report(diagnostic: Omit<AttendanceDiagnostic, 'at'>) {
  const payload: AttendanceDiagnostic = { ...diagnostic, at: new Date().toISOString() };
  // 백그라운드 전용 실행에서도 사유가 남도록 저장한다. 무음 실패를 만들지 않는다.
  try {
    await SecureStore.setItemAsync(DIAGNOSTIC_KEY, JSON.stringify(payload));
  } catch {
    // 저장 실패는 기능을 막지 않는다.
  }
  try {
    diagnosticListener?.(payload);
  } catch {
    // 리스너 오류가 태스크를 죽이지 않도록 한다.
  }
  return payload;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 세션을 리셋해야 하는 설정 변경을 감지하는 지문.
 * name은 표시용이라 제외한다.
 * timezone은 localDate 경계를, 운영시간은 "어떤 체류를 인정할지"를 바꾸므로 포함한다.
 * is_active는 모바일 응답 객체에 없어 포함할 수 없다.
 */
export function fingerprint(geofence: Geofence) {
  return [
    geofence.id,
    geofence.latitude,
    geofence.longitude,
    geofence.radius_m,
    geofence.dwell_seconds,
    geofence.timezone,
    geofence.window_start,
    geofence.window_end,
  ].join('|');
}

export function sessionMaxSeconds(geofence: Geofence) {
  return Math.min(
    Math.max(geofence.dwell_seconds * 2, MIN_SESSION_MAX_SECONDS),
    MAX_SESSION_MAX_SECONDS,
  );
}

export function elapsedSecondsSince(value: string, now = Date.now()) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((now - parsed) / 1000));
}

async function readGeofence(): Promise<Geofence | null> {
  return safeParse<Geofence>(await SecureStore.getItemAsync(GEOFENCE_KEY));
}

async function readEvent(): Promise<StoredEvent | null> {
  const stored = safeParse<StoredEvent>(await SecureStore.getItemAsync(EVENT_KEY));
  if (!stored || stored.version !== EVENT_VERSION) return null;
  return stored;
}

async function writeEvent(event: StoredEvent) {
  await SecureStore.setItemAsync(EVENT_KEY, JSON.stringify(event));
  return event;
}

async function clearEvent() {
  await SecureStore.deleteItemAsync(EVENT_KEY);
}

async function readDiagnostic(): Promise<AttendanceDiagnostic | null> {
  return safeParse<AttendanceDiagnostic>(await SecureStore.getItemAsync(DIAGNOSTIC_KEY));
}

function newSession(geofence: Geofence, enteredAt: string, localDate: string): StoredEvent {
  return {
    version: EVENT_VERSION,
    enteredAt,
    geofenceId: geofence.id,
    localDate,
    configFingerprint: fingerprint(geofence),
    status: 'open',
    lastEventAt: new Date().toISOString(),
    pendingSubmit: true,
    submitAttempts: 0,
  };
}

export function isOpenSessionFor(event: StoredEvent | null, geofence: Geofence, today: string) {
  return Boolean(
    event
      && event.status === 'open'
      && event.geofenceId === geofence.id
      && event.configFingerprint === fingerprint(geofence)
      && event.localDate === today,
  );
}

async function submitCandidate(token: string, geofence: Geofence, enteredAt: string, dwellSeconds: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ORIGIN}/api/mobile/attendance-candidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({
        geofenceId: geofence.id,
        localDate: localDateInTimeZone(new Date(), geofence.timezone),
        source: Platform.OS === 'ios' ? 'ios_region' : 'android_geofence',
        enteredAt,
        lastSeenAt: new Date().toISOString(),
        dwellSeconds: Math.min(dwellSeconds, MAX_DWELL_SECONDS),
        // 세션이 유지되는 동안 값이 고정되므로 재전송해도 서버가 같은 이벤트로 인식한다.
        deviceEventId: `${geofence.id}:${enteredAt}`,
      }),
    });
    if (!response.ok) throw new Error(`attendance candidate failed: ${response.status}`);
    return await response.json() as { candidate?: { id?: string } };
  } finally {
    clearTimeout(timer);
  }
}

async function confirmCandidate(token: string, candidateId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ORIGIN}/api/mobile/attendance-candidate/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
      body: JSON.stringify({ candidateId }),
    });
    if (!response.ok) throw new Error(`attendance confirm failed: ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

type ServerStatus = {
  candidate: { status: string; entered_at: string; dwell_seconds: number } | null;
  attendance: { source: string; recorded_at: string } | null;
};

/** 서버 상태는 세션 종료 판단과 화면 표시에만 사용한다. 체류시간 판정에는 쓰지 않는다. */
async function fetchAttendanceStatus(token: string): Promise<ServerStatus | null> {
  try {
    const response = await fetch(`${API_ORIGIN}/api/mobile/attendance-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const payload = await response.json() as ServerStatus & { ok?: boolean };
    if (!payload?.ok) return null;
    return { candidate: payload.candidate ?? null, attendance: payload.attendance ?? null };
  } catch {
    return null;
  }
}

/** 전송 실패 시 이벤트를 버리지 않고 pendingSubmit으로 보존한다. */
async function trySubmit(token: string, geofence: Geofence, event: StoredEvent): Promise<StoredEvent> {
  const dwellSeconds = elapsedSecondsSince(event.enteredAt);
  try {
    await submitCandidate(token, geofence, event.enteredAt, dwellSeconds);
    return await writeEvent({
      ...event,
      pendingSubmit: false,
      submitAttempts: event.submitAttempts + 1,
      lastSubmitError: undefined,
    });
  } catch (error) {
    const message = errorMessage(error);
    const failed = await writeEvent({
      ...event,
      pendingSubmit: true,
      submitAttempts: event.submitAttempts + 1,
      lastSubmitError: message,
    });
    await report({ code: 'submit_failed', message, sessionStartedAt: event.enteredAt });
    return failed;
  }
}

async function closeSession(geofence: Geofence | null, code: AttendanceDiagnosticCode) {
  const event = await readEvent();
  if (!event) return;
  if (geofence && event.geofenceId !== geofence.id) return;
  const now = new Date().toISOString();
  await writeEvent({ ...event, status: 'closed', exitedAt: now, lastEventAt: now });
  await report({ code, sessionStartedAt: event.enteredAt });
}

/**
 * 로컬 세션이 없거나 무효할 때 서버의 과거 진입 시각을 복원하지 않는다.
 * 연속 체류를 증명할 수 없으므로, 지금 반경 안에 있을 때만 현재 시각부터 새 체류를 시작한다.
 */
async function restartSessionIfInside(
  token: string,
  geofence: Geofence,
  code: AttendanceDiagnosticCode,
) {
  const now = new Date();
  if (!isWithinOperatingWindow(now, geofence)) {
    await clearEvent();
    await report({ code: 'outside_window' });
    return false;
  }

  let position: Location.LocationObject;
  try {
    position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch (error) {
    await report({ code, message: `현재 위치를 확인하지 못해 새 체류를 시작하지 못했습니다: ${errorMessage(error)}` });
    return false;
  }

  const accuracyM = Math.max(position.coords.accuracy ?? 0, 0);
  const distanceM = distanceInMeters(
    position.coords.latitude,
    position.coords.longitude,
    geofence.latitude,
    geofence.longitude,
  );
  if (distanceM > geofence.radius_m + accuracyM) {
    await clearEvent();
    await report({ code, message: '교회 반경 밖이라 새 체류를 시작하지 않았습니다.', distanceM, accuracyM });
    return false;
  }

  const fresh = newSession(geofence, now.toISOString(), localDateInTimeZone(now, geofence.timezone));
  await writeEvent(fresh);
  await report({
    code,
    message: '현재 시각부터 새 체류를 시작합니다.',
    sessionStartedAt: fresh.enteredAt,
    dwellSeconds: 0,
    requiredSeconds: geofence.dwell_seconds,
    distanceM,
    accuracyM,
  });
  await trySubmit(token, geofence, fresh);
  return true;
}

async function handleEnter(token: string, geofence: Geofence) {
  const now = new Date();
  const today = localDateInTimeZone(now, geofence.timezone);
  const previous = await readEvent();

  // 앱 재실행·재등록으로 초기 Inside 이벤트가 다시 와도 진행 중 세션이면 진입 시각을 유지한다.
  const reusable = isOpenSessionFor(previous, geofence, today)
    && elapsedSecondsSince(previous!.enteredAt, now.getTime()) <= sessionMaxSeconds(geofence);

  const session = reusable
    ? { ...previous!, lastEventAt: now.toISOString(), pendingSubmit: true }
    : newSession(geofence, now.toISOString(), today);

  await writeEvent(session);
  await report({
    code: reusable ? 'enter_kept' : 'enter_new',
    sessionStartedAt: session.enteredAt,
    dwellSeconds: elapsedSecondsSince(session.enteredAt, now.getTime()),
    requiredSeconds: geofence.dwell_seconds,
  });
  await trySubmit(token, geofence, session);
}

TaskManager.defineTask(ATTENDANCE_TASK, async ({ data, error }) => {
  if (error) {
    await report({ code: 'task_error', message: error.message });
    return;
  }
  if (!data) return;

  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const geofence = await readGeofence();
  if (!token || !geofence) {
    await report({ code: 'no_geofence' });
    return;
  }

  const event = data as { eventType?: number };

  // Exit은 로컬 세션만 닫는다. 서버 후보는 하루 1건 제약이 있어 건드리지 않는다.
  if (event.eventType === Location.GeofencingEventType.Exit) {
    await closeSession(geofence, 'exit_closed');
    return;
  }
  if (event.eventType !== Location.GeofencingEventType.Enter) return;
  if (!isWithinOperatingWindow(new Date(), geofence)) {
    await report({ code: 'outside_window' });
    return;
  }

  try {
    await handleEnter(token, geofence);
  } catch (taskError) {
    await report({ code: 'task_error', message: errorMessage(taskError) });
  }
});

let attendanceConfirmationInFlight: Promise<boolean> | null = null;

export function maybeConfirmAttendance(accessToken: string): Promise<boolean> {
  if (attendanceConfirmationInFlight) return attendanceConfirmationInFlight;
  const request = confirmAttendance(accessToken);
  attendanceConfirmationInFlight = request;
  const clear = () => {
    if (attendanceConfirmationInFlight === request) attendanceConfirmationInFlight = null;
  };
  request.then(clear, clear);
  return request;
}

async function confirmAttendance(accessToken: string): Promise<boolean> {
  const geofence = await readGeofence();
  if (!geofence) {
    await report({ code: 'no_geofence' });
    return false;
  }

  const now = new Date();
  const today = localDateInTimeZone(now, geofence.timezone);

  // 0) 백그라운드에서 전송하지 못한 후보를 같은 deviceEventId로 재전송한다.
  //    날짜·설정이 어긋났거나 만료된 세션은 재전송하지 않는다. 과거 진입 시각이 되살아나면 안 된다.
  const pending = await readEvent();
  if (
    pending?.pendingSubmit
    && isOpenSessionFor(pending, geofence, today)
    && elapsedSecondsSince(pending.enteredAt, now.getTime()) <= sessionMaxSeconds(geofence)
  ) {
    const retried = await trySubmit(accessToken, geofence, pending);
    if (!retried.pendingSubmit) {
      await report({ code: 'submit_retried', sessionStartedAt: retried.enteredAt });
    }
  }

  // 1) 서버 상태는 세션 종료 판단·표시 용도로만 읽는다.
  const status = await fetchAttendanceStatus(accessToken);
  if (status?.attendance) {
    await closeSession(geofence, 'already_attended');
    return false;
  }
  if (status?.candidate && status.candidate.status !== 'candidate') {
    await closeSession(geofence, 'candidate_closed');
    return false;
  }

  const event = await readEvent();

  if (!isOpenSessionFor(event, geofence, today)) {
    const rolled = Boolean(event && event.status === 'open' && event.localDate !== today);
    await restartSessionIfInside(accessToken, geofence, rolled ? 'date_rolled' : 'no_local_session');
    return false;
  }

  const session = event!;
  const dwellSeconds = elapsedSecondsSince(session.enteredAt, now.getTime());

  // Exit을 놓친 채 오래 열려 있던 세션은 만료시키고 현재 시각부터 다시 센다.
  if (dwellSeconds > sessionMaxSeconds(geofence)) {
    await restartSessionIfInside(accessToken, geofence, 'session_expired');
    return false;
  }

  if (dwellSeconds < geofence.dwell_seconds) {
    await report({
      code: 'dwell_short',
      sessionStartedAt: session.enteredAt,
      dwellSeconds,
      requiredSeconds: geofence.dwell_seconds,
    });
    return false;
  }

  // 2) 확정 직전에 현재 위치와 정확도를 다시 확인한다.
  let position: Location.LocationObject;
  try {
    position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch (error) {
    await report({ code: 'position_failed', message: errorMessage(error), sessionStartedAt: session.enteredAt });
    return false;
  }

  const accuracyM = Math.max(position.coords.accuracy ?? 0, 0);
  const distanceM = distanceInMeters(
    position.coords.latitude,
    position.coords.longitude,
    geofence.latitude,
    geofence.longitude,
  );
  if (distanceM > geofence.radius_m + accuracyM) {
    await report({
      code: 'outside_radius',
      sessionStartedAt: session.enteredAt,
      dwellSeconds,
      distanceM,
      accuracyM,
    });
    return false;
  }

  try {
    const result = await submitCandidate(accessToken, geofence, session.enteredAt, dwellSeconds);
    const candidateId = result.candidate?.id;
    if (!candidateId) throw new Error('서버가 출석 후보 ID를 반환하지 않았습니다.');
    await confirmCandidate(accessToken, candidateId);
  } catch (error) {
    const message = errorMessage(error);
    await writeEvent({ ...session, pendingSubmit: true, lastSubmitError: message });
    await report({ code: 'confirm_failed', message, sessionStartedAt: session.enteredAt, dwellSeconds });
    return false;
  }

  await writeEvent({ ...session, status: 'closed', pendingSubmit: false, lastSubmitError: undefined });
  await report({
    code: 'confirmed',
    sessionStartedAt: session.enteredAt,
    dwellSeconds,
    requiredSeconds: geofence.dwell_seconds,
    distanceM,
    accuracyM,
  });
  return true;
}

export async function fetchAttendanceGeofence(accessToken: string): Promise<Geofence | null> {
  const response = await fetch(`${API_ORIGIN}/api/mobile/attendance-geofence`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`attendance geofence config failed: ${response.status}`);
  const payload = await response.json() as { geofence: Geofence | null };
  return payload.geofence;
}

export async function attendancePermissionsGranted() {
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  return foreground.status === 'granted' && background.status === 'granted';
}

export async function syncAttendanceGeofence(accessToken: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken);

  let geofence: Geofence | null;
  try {
    geofence = await fetchAttendanceGeofence(accessToken);
  } catch (error) {
    await report({ code: 'config_fetch_failed', message: errorMessage(error) });
    return false;
  }

  if (!geofence) {
    if (await Location.hasStartedGeofencingAsync(ATTENDANCE_TASK)) {
      await Location.stopGeofencingAsync(ATTENDANCE_TASK);
    }
    await SecureStore.deleteItemAsync(GEOFENCE_KEY);
    await clearEvent();
    await report({ code: 'no_geofence' });
    return false;
  }

  // 설정이 바뀌면 진행 중이던 체류 세션은 무효로 본다.
  const previous = await readGeofence();
  if (previous && fingerprint(previous) !== fingerprint(geofence)) {
    await clearEvent();
    await report({ code: 'config_changed' });
  }
  await SecureStore.setItemAsync(GEOFENCE_KEY, JSON.stringify(geofence));

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    await report({ code: 'foreground_denied', message: '위치 권한(앱 사용 중)이 허용되지 않았습니다.' });
    return false;
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    await report({ code: 'background_denied', message: "자동출석에는 위치 권한 '항상 허용'이 필요합니다." });
    return false;
  }

  try {
    if (await Location.hasStartedGeofencingAsync(ATTENDANCE_TASK)) {
      await Location.stopGeofencingAsync(ATTENDANCE_TASK);
    }
    await Location.startGeofencingAsync(ATTENDANCE_TASK, [{
      identifier: geofence.id,
      latitude: geofence.latitude,
      longitude: geofence.longitude,
      radius: geofence.radius_m,
      notifyOnEnter: true,
      notifyOnExit: true,
    }]);
  } catch (error) {
    await report({ code: 'geofencing_start_failed', message: errorMessage(error) });
    return false;
  }

  await report({ code: 'geofencing_started', requiredSeconds: geofence.dwell_seconds });
  return true;
}

export type GeofenceApplyResult = {
  registered: boolean;
  inside: boolean | null;
  distanceM: number | null;
  accuracyM: number | null;
  radiusM: number | null;
  enteredAt: string | null;
  alreadyRecorded: boolean;
  reason: AttendanceDiagnosticCode;
  message: string;
};

/**
 * 관리자가 교회 위치를 저장한 직후 호출한다.
 * 1) 기존 지오펜스를 해제하고 새 좌표로 다시 등록
 * 2) 지금 새 반경 안에 있으면 즉시 진입으로 판정 (iOS 초기 Inside 이벤트에만 의존하지 않는다)
 * 3) 오늘 진입 기록이 이미 있으면 중복 저장하지 않는다
 */
export async function applyGeofenceAndDetectPresence(accessToken: string): Promise<GeofenceApplyResult> {
  const base: GeofenceApplyResult = {
    registered: false,
    inside: null,
    distanceM: null,
    accuracyM: null,
    radiusM: null,
    enteredAt: null,
    alreadyRecorded: false,
    reason: 'no_geofence',
    message: '',
  };

  const registered = await syncAttendanceGeofence(accessToken);
  const geofence = await readGeofence();
  if (!registered || !geofence) {
    const last = await readDiagnostic();
    return {
      ...base,
      reason: last?.code ?? 'no_geofence',
      message: last?.message || '자동출석 위치 감지를 등록하지 못했습니다. 내 자동출석 화면에서 위치 안내·권한 설정을 확인해 주세요.',
    };
  }

  const result: GeofenceApplyResult = { ...base, registered: true, radiusM: geofence.radius_m };
  const now = new Date();

  if (!isWithinOperatingWindow(now, geofence)) {
    await report({ code: 'outside_window' });
    return { ...result, reason: 'outside_window', message: '자동출석 위치를 등록했습니다. 지금은 운영시간이 아니라 진입 기록은 남기지 않았습니다.' };
  }

  let position: Location.LocationObject;
  try {
    position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch (error) {
    await report({ code: 'position_failed', message: errorMessage(error) });
    return { ...result, reason: 'position_failed', message: '자동출석 위치를 등록했지만 현재 위치를 확인하지 못해 반경 안인지 판정하지 못했습니다.' };
  }

  const accuracyM = Math.max(position.coords.accuracy ?? 0, 0);
  const distanceM = distanceInMeters(
    position.coords.latitude,
    position.coords.longitude,
    geofence.latitude,
    geofence.longitude,
  );
  const inside = distanceM <= geofence.radius_m + accuracyM;
  const measured = { ...result, inside, distanceM, accuracyM };

  if (!inside) {
    await report({ code: 'outside_radius', distanceM, accuracyM });
    return {
      ...measured,
      reason: 'outside_radius',
      message: `자동출석 위치를 등록했습니다. 지금은 교회 반경 밖입니다. (약 ${Math.round(distanceM)}m 떨어짐)`,
    };
  }

  // 서버에 오늘 기록이 이미 있으면 그 시각을 그대로 유지한다.
  const status = await fetchAttendanceStatus(accessToken);
  if (status?.attendance) {
    return { ...measured, alreadyRecorded: true, reason: 'already_attended', message: '현재 교회 반경 안에 있습니다. 오늘 출석은 이미 기록되어 있습니다.' };
  }

  const today = localDateInTimeZone(now, geofence.timezone);
  const existing = await readEvent();
  const reusable = isOpenSessionFor(existing, geofence, today)
    && elapsedSecondsSince(existing!.enteredAt, now.getTime()) <= sessionMaxSeconds(geofence);

  const session = reusable
    ? { ...existing!, lastEventAt: now.toISOString(), pendingSubmit: true }
    : newSession(geofence, now.toISOString(), today);
  await writeEvent(session);
  await report({
    code: reusable ? 'enter_kept' : 'enter_new',
    sessionStartedAt: session.enteredAt,
    dwellSeconds: elapsedSecondsSince(session.enteredAt, now.getTime()),
    requiredSeconds: geofence.dwell_seconds,
    distanceM,
    accuracyM,
  });
  const submitted = await trySubmit(accessToken, geofence, session);

  const serverEnteredAt = status?.candidate?.entered_at ?? null;
  const minutes = Math.max(1, Math.round(geofence.dwell_seconds / 60));
  return {
    ...measured,
    enteredAt: session.enteredAt,
    alreadyRecorded: Boolean(serverEnteredAt) || reusable,
    reason: reusable ? 'enter_kept' : 'enter_new',
    message: submitted.pendingSubmit
      ? '현재 교회 반경 안에 있습니다. 진입 기록을 서버로 보내지 못해 앱을 다시 열 때 재전송합니다.'
      : reusable || serverEnteredAt
        ? `현재 교회 반경 안에 있습니다. 오늘 진입 기록이 이미 있어 그대로 유지했습니다. ${minutes}분 이상 머무르면 자동출석으로 기록됩니다.`
        : `현재 교회 반경 안에 있습니다. 진입 시각을 기록했습니다. ${minutes}분 이상 머무르면 자동출석으로 기록됩니다.`,
  };
}

export async function stopAttendanceGeofence() {
  if (await Location.hasStartedGeofencingAsync(ATTENDANCE_TASK)) {
    await Location.stopGeofencingAsync(ATTENDANCE_TASK);
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(GEOFENCE_KEY);
  await SecureStore.deleteItemAsync(EVENT_KEY);
  await SecureStore.deleteItemAsync(DIAGNOSTIC_KEY);
}

export async function getAttendanceSnapshot(): Promise<AttendanceSnapshot> {
  const [foreground, background] = await Promise.all([
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
  ]);

  let geofencingStarted = false;
  try {
    geofencingStarted = await Location.hasStartedGeofencingAsync(ATTENDANCE_TASK);
  } catch {
    geofencingStarted = false;
  }

  const geofence = await readGeofence();
  const session = await readEvent();

  return {
    platform: Platform.OS,
    foregroundPermission: foreground?.status ?? 'unknown',
    backgroundPermission: background?.status ?? 'unknown',
    geofencingStarted,
    geofence: geofence
      ? {
        name: geofence.name || '등록된 위치',
        // 기기에 실제 등록된 좌표를 그대로 노출한다. DB 저장값과 다르면 재등록이 안 된 것이다.
        latitude: geofence.latitude,
        longitude: geofence.longitude,
        radiusM: geofence.radius_m,
        dwellSeconds: geofence.dwell_seconds,
        windowStart: String(geofence.window_start).slice(0, 5),
        windowEnd: String(geofence.window_end).slice(0, 5),
        timezone: geofence.timezone,
      }
      : null,
    session: session
      ? {
        enteredAt: session.enteredAt,
        status: session.status,
        localDate: session.localDate,
        elapsedSeconds: elapsedSecondsSince(session.enteredAt),
        pendingSubmit: session.pendingSubmit,
        lastSubmitError: session.lastSubmitError,
      }
      : null,
    lastDiagnostic: await readDiagnostic(),
  };
}

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isWithinOperatingWindow(value: Date, geofence: Geofence) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: geofence.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const current = read('hour') * 3600 + read('minute') * 60 + read('second');
  const parse = (time: string) => {
    const [hour = '0', minute = '0', second = '0'] = time.split(':');
    return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
  };
  const start = parse(geofence.window_start);
  const end = parse(geofence.window_end);
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

export function localDateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '00';
  return `${read('year')}-${read('month')}-${read('day')}`;
}
