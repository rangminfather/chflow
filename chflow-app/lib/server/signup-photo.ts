export const SIGNUP_PHOTO_PREFIX = "/api/storage/member-photos/";

/**
 * Converts the same-origin member photo URL stored in the database into the
 * R2 object path used for signing. Cache-busting query/hash suffixes belong to
 * the browser URL and must never become part of the object key.
 */
export function getSignupPhotoStoragePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith(SIGNUP_PHOTO_PREFIX)) return null;

  const pathWithSuffix = raw.slice(SIGNUP_PHOTO_PREFIX.length);
  const suffixIndex = pathWithSuffix.search(/[?#]/);
  const storagePath = (suffixIndex >= 0 ? pathWithSuffix.slice(0, suffixIndex) : pathWithSuffix).trim();
  return storagePath || null;
}
