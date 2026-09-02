const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getBulletinSundayTargets(now = new Date()) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const todayUtc = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  const dayOfWeek = new Date(todayUtc).getUTCDay();
  const currentSunday = new Date(todayUtc - dayOfWeek * DAY_MS);
  const nextSunday = new Date(currentSunday.getTime() + 7 * DAY_MS);

  return {
    nextSunday: isoDate(nextSunday),
    currentSunday: isoDate(currentSunday),
  };
}

// Friday and Saturday prepare the upcoming Sunday bulletin. From Sunday onward,
// the expected issue is the current Sunday.
export function getExpectedBulletinIssueDate(now = new Date()) {
  const targets = getBulletinSundayTargets(now);
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dayOfWeek = kst.getUTCDay();
  return dayOfWeek === 5 || dayOfWeek === 6 ? targets.nextSunday : targets.currentSunday;
}

export function isBulletinDemandRetryWindow(now = new Date()) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const dayOfWeek = kst.getUTCDay();
  return dayOfWeek === 6 || dayOfWeek === 0;
}
