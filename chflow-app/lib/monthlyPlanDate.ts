const DAY_MS = 86_400_000;

function utcDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * 월간계획 행 날짜를 찾는다.
 * 정확한 날짜가 없을 때만, 실제 주일에서 하루 밀린 유일한 행을 같은 주 계획으로 인정한다.
 */
export function resolveMonthlyPlanDate(targetDate: string, availableDates: string[]) {
  const uniqueDates = Array.from(new Set(availableDates));
  if (uniqueDates.includes(targetDate)) return targetDate;

  const targetDay = utcDay(targetDate);
  const adjacentDates = uniqueDates.filter((candidate) => (
    Math.abs(utcDay(candidate) - targetDay) === DAY_MS
  ));

  return adjacentDates.length === 1 ? adjacentDates[0] : null;
}
