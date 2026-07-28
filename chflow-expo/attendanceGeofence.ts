import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export const ATTENDANCE_TASK = 'chflow-attendance-geofence';
const TOKEN_KEY = 'chflow.attendance.access-token';
const GEOFENCE_KEY = 'chflow.attendance.geofence';
const API_ORIGIN = 'https://chflow-app.vercel.app';

type Geofence = {
  id: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  dwell_seconds: number;
};

type StoredEvent = { enteredAt: string; geofenceId: string };

async function submitCandidate(token: string, geofence: Geofence, event: StoredEvent) {
  const now = new Date().toISOString();
  const response = await fetch(`${API_ORIGIN}/api/mobile/attendance-candidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      geofenceId: geofence.id,
      localDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
      source: Platform.OS === 'ios' ? 'ios_region' : 'android_geofence',
      enteredAt: event.enteredAt,
      lastSeenAt: now,
      dwellSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(event.enteredAt)) / 1000)),
      deviceEventId: `${geofence.id}:${event.enteredAt}`,
    }),
  });
  if (!response.ok) throw new Error(`attendance candidate failed: ${response.status}`);
  return await response.json() as { candidate?: { id?: string } };
}

TaskManager.defineTask(ATTENDANCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const rawGeofence = await SecureStore.getItemAsync(GEOFENCE_KEY);
  if (!token || !rawGeofence) return;

  const geofence = JSON.parse(rawGeofence) as Geofence;
  const event = data as { eventType?: number };
  // expo-location: 1 = enter, 2 = exit. Only enter creates/updates a candidate.
  if (event.eventType !== Location.GeofencingEventType.Enter) return;

  const enteredAt = new Date().toISOString();
  const storedEvent: StoredEvent = { enteredAt, geofenceId: geofence.id };
  await SecureStore.setItemAsync(`${GEOFENCE_KEY}.event`, JSON.stringify(storedEvent));
  await submitCandidate(token, geofence, storedEvent);
});

export async function maybeConfirmAttendance(accessToken: string) {
  const rawGeofence = await SecureStore.getItemAsync(GEOFENCE_KEY);
  const rawEvent = await SecureStore.getItemAsync(`${GEOFENCE_KEY}.event`);
  if (!rawGeofence || !rawEvent) return false;
  const geofence = JSON.parse(rawGeofence) as Geofence;
  const event = JSON.parse(rawEvent) as StoredEvent;
  const dwellSeconds = Math.floor((Date.now() - Date.parse(event.enteredAt)) / 1000);
  if (dwellSeconds < geofence.dwell_seconds) return false;

  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const distance = distanceInMeters(
    position.coords.latitude,
    position.coords.longitude,
    geofence.latitude,
    geofence.longitude,
  );
  if (distance > geofence.radius_m + Math.max(position.coords.accuracy ?? 0, 0)) return false;

  const result = await submitCandidate(accessToken, geofence, {
    enteredAt: event.enteredAt,
    geofenceId: geofence.id,
  });
  const candidateId = result.candidate?.id;
  if (!candidateId) return false;
  const response = await fetch(`${API_ORIGIN}/api/mobile/attendance-candidate/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ candidateId }),
  });
  if (!response.ok) return false;
  await SecureStore.deleteItemAsync(`${GEOFENCE_KEY}.event`);
  return true;
}

export async function syncAttendanceGeofence(accessToken: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
  const response = await fetch(`${API_ORIGIN}/api/mobile/attendance-geofence`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`attendance geofence config failed: ${response.status}`);
  const payload = await response.json() as { geofence: Geofence | null };
  if (!payload.geofence) return false;

  await SecureStore.setItemAsync(GEOFENCE_KEY, JSON.stringify(payload.geofence));
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') return false;

  const alreadyStarted = await Location.hasStartedGeofencingAsync(ATTENDANCE_TASK);
  if (alreadyStarted) await Location.stopGeofencingAsync(ATTENDANCE_TASK);
  await Location.startGeofencingAsync(ATTENDANCE_TASK, [{
      identifier: payload.geofence.id,
      latitude: payload.geofence.latitude,
      longitude: payload.geofence.longitude,
      radius: payload.geofence.radius_m,
      notifyOnEnter: true,
      notifyOnExit: true,
    }]);
  return true;
}

export async function stopAttendanceGeofence() {
  if (await Location.hasStartedGeofencingAsync(ATTENDANCE_TASK)) {
    await Location.stopGeofencingAsync(ATTENDANCE_TASK);
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(GEOFENCE_KEY);
  await SecureStore.deleteItemAsync(`${GEOFENCE_KEY}.event`);
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
