/* ============================================================
   출결 상태 — "미체크" 와 "결석" 은 다르다

   예전 담임 출석체크 화면은 기록이 없으면 "결석"으로 바꿔 보여줬다.
   그래서 두 가지가 화면에서 똑같아 보였다.
     · 선생님이 아직 손대지 않은 학생
     · 선생님이 결석으로 확인해 찍은 학생
   학생이 둘뿐인 반이 통째로 안 나온 주와, 선생님이 못 찍은 주를 구분할 수
   없었고 교육일지에는 "일부체크"로만 떴다.

   이제 기록이 없으면 "" (미체크)로 둔다. 안 찍은 것은 안 찍은 것으로 보여주고,
   결석은 선생님이 명시적으로 찍어야 결석이 된다.
   ============================================================ */

/** "" = 미체크 (기록 없음) */
export type AttendanceStatus = "" | "출" | "결" | "인";

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  "": "미체크",
  출: "출석",
  결: "결석",
  인: "출석인정",
};

/** 기록에 든 값을 화면용 상태로 정리한다. 모르는 값은 미체크로 본다. */
export function normalizeAttendanceStatus(status: string | null | undefined): AttendanceStatus {
  if (status === "출" || status === "결" || status === "인") return status;
  return "";
}

export function attendanceStatusLabel(status: string | null | undefined): string {
  return ATTENDANCE_STATUS_LABEL[normalizeAttendanceStatus(status)];
}

/** 한 반의 한 주를 요약한다 — 미체크를 따로 센다 */
export function summarizeAttendance(
  statuses: (string | null | undefined)[],
): { total: number; attend: number; absent: number; otherChurch: number; unchecked: number } {
  const normalized = statuses.map(normalizeAttendanceStatus);
  return {
    total: normalized.length,
    attend: normalized.filter((value) => value === "출").length,
    absent: normalized.filter((value) => value === "결").length,
    otherChurch: normalized.filter((value) => value === "인").length,
    unchecked: normalized.filter((value) => value === "").length,
  };
}
