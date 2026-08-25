export const NOTIFICATION_SAFETY_SYNC_MS = 5 * 60_000;
export const NOTIFICATION_FALLBACK_INITIAL_MS = 10_000;
export const NOTIFICATION_FALLBACK_MAX_MS = 60_000;

export function nextNotificationFallbackDelay(
  currentDelay: number,
  succeeded: boolean,
): number {
  if (succeeded) return NOTIFICATION_FALLBACK_INITIAL_MS;
  return Math.min(currentDelay * 2, NOTIFICATION_FALLBACK_MAX_MS);
}

export type AttendancePollingState = {
  candidate: { status: string } | null;
  attendance: unknown | null;
};

export function attendancePollingDelay(
  status: AttendancePollingState | null,
): number | null {
  if (status?.attendance) return null;
  if (status?.candidate?.status === "candidate") return 10_000;
  return 60_000;
}
