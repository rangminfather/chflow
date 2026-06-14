// Generates a proxy URL for a storage file.
// All storage reads should go through this proxy so auth is enforced.
export function storageProxyUrl(bucket: string, path: string): string {
  return `/api/storage/${bucket}/${path}`;
}
