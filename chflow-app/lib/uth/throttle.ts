// Interim in-memory throttle for the UTH control routes.
// NOTE: in-memory only survives within a single serverless instance — fine for
// home testing / low volume. Production/church step should move to a DB-backed
// counter (see lib/server/signup-security.ts pattern).

const hits = new Map<string, number[]>();

/** Returns true if allowed; records the hit. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}
