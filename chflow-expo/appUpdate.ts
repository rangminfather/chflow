export type SupportedAppPlatform = 'android' | 'ios';

export type UpdateDecision = 'none' | 'recommended' | 'required';

export type AppUpdateConfig = {
  min_android_build?: unknown;
  latest_android_build?: unknown;
  play_store_url?: unknown;
  play_store_url_web?: unknown;
  min_ios_version?: unknown;
  latest_ios_version?: unknown;
  app_store_url?: unknown;
  app_store_url_web?: unknown;
};

export type UpdateCheckResult = {
  decision: UpdateDecision;
  storeUrl: string;
  storeUrlWeb: string;
  storeName: 'Play Store' | 'App Store';
};

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<FetchResponse>;

type CheckOptions = {
  platform: SupportedAppPlatform;
  configUrl: string;
  nativeBuildVersion: string | null;
  nativeApplicationVersion: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export const PLAY_STORE_URL = 'market://details?id=com.smartmyungsung.app';
export const PLAY_STORE_URL_WEB = 'https://play.google.com/store/apps/details?id=com.smartmyungsung.app';
export const APP_STORE_URL = 'itms-apps://apps.apple.com/app/id6795782758';
export const APP_STORE_URL_WEB = 'https://apps.apple.com/kr/app/id6795782758';

const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

export function parseDottedVersion(value: unknown): number[] | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!VERSION_PATTERN.test(trimmed)) return null;
  const parts = trimmed.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function compareDottedVersions(left: string, right: string): number | null {
  const a = parseDottedVersion(left);
  const b = parseDottedVersion(right);
  if (!a || !b) return null;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function evaluateUpdate(
  platform: SupportedAppPlatform,
  config: AppUpdateConfig,
  nativeBuildVersion: string | null,
  nativeApplicationVersion: string | null,
): UpdateCheckResult {
  if (platform === 'android') {
    const result: UpdateCheckResult = {
      decision: 'none',
      storeUrl: nonEmptyString(config.play_store_url, PLAY_STORE_URL),
      storeUrlWeb: nonEmptyString(config.play_store_url_web, PLAY_STORE_URL_WEB),
      storeName: 'Play Store',
    };
    const installed = Number(nativeBuildVersion);
    const minimum = positiveInteger(config.min_android_build);
    const latest = positiveInteger(config.latest_android_build);
    if (!Number.isSafeInteger(installed) || installed <= 0 || minimum === null) return result;
    if (installed < minimum) return { ...result, decision: 'required' };
    if (latest !== null && installed < latest) return { ...result, decision: 'recommended' };
    return result;
  }

  const result: UpdateCheckResult = {
    decision: 'none',
    storeUrl: nonEmptyString(config.app_store_url, APP_STORE_URL),
    storeUrlWeb: nonEmptyString(config.app_store_url_web, APP_STORE_URL_WEB),
    storeName: 'App Store',
  };
  if (!nativeApplicationVersion) return result;
  const minimumComparison =
    typeof config.min_ios_version === 'string'
      ? compareDottedVersions(nativeApplicationVersion, config.min_ios_version)
      : null;
  if (minimumComparison === null) return result;
  if (minimumComparison < 0) return { ...result, decision: 'required' };

  const latestComparison =
    typeof config.latest_ios_version === 'string'
      ? compareDottedVersions(nativeApplicationVersion, config.latest_ios_version)
      : null;
  if (latestComparison !== null && latestComparison < 0) {
    return { ...result, decision: 'recommended' };
  }
  return result;
}

export async function checkForAppUpdate(options: CheckOptions): Promise<UpdateCheckResult> {
  const fallback = evaluateUpdate(options.platform, {}, null, null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
    const separator = options.configUrl.includes('?') ? '&' : '?';
    const response = await fetchImpl(`${options.configUrl}${separator}t=${Date.now()}`, {
      signal: controller.signal,
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return fallback;
    const value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    return evaluateUpdate(
      options.platform,
      value as AppUpdateConfig,
      options.nativeBuildVersion,
      options.nativeApplicationVersion,
    );
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
