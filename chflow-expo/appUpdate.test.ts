import { describe, expect, it, vi } from 'vitest';
import {
  APP_STORE_URL,
  APP_STORE_URL_WEB,
  PLAY_STORE_URL,
  checkForAppUpdate,
  compareDottedVersions,
  evaluateUpdate,
  parseDottedVersion,
} from './appUpdate';

describe('dotted app versions', () => {
  it('compares numeric version components', () => {
    expect(compareDottedVersions('1.1.9', '1.1.10')).toBe(-1);
    expect(compareDottedVersions('1.1.10', '1.1.10')).toBe(0);
    expect(compareDottedVersions('1.2', '1.2.0')).toBe(0);
  });

  it('rejects malformed versions', () => {
    expect(parseDottedVersion('')).toBeNull();
    expect(parseDottedVersion('1.2-beta')).toBeNull();
    expect(parseDottedVersion('1..2')).toBeNull();
    expect(compareDottedVersions('not-a-version', '1.2.0')).toBeNull();
  });
});

describe('platform update policy', () => {
  const iosConfig = {
    min_ios_version: '1.1.10',
    latest_ios_version: '1.1.12',
    app_store_url: APP_STORE_URL,
    app_store_url_web: APP_STORE_URL_WEB,
  };

  it('does not prompt for the current iOS version', () => {
    expect(evaluateUpdate('ios', iosConfig, null, '1.1.12').decision).toBe('none');
  });

  it('recommends an update below latest but at minimum', () => {
    expect(evaluateUpdate('ios', iosConfig, null, '1.1.11').decision).toBe('recommended');
  });

  it('requires an update below minimum', () => {
    expect(evaluateUpdate('ios', iosConfig, null, '1.1.9').decision).toBe('required');
  });

  it('fails open for an invalid iOS minimum', () => {
    expect(
      evaluateUpdate('ios', { ...iosConfig, min_ios_version: 'invalid' }, null, '1.0.0').decision,
    ).toBe('none');
  });

  it('preserves Android build-code behavior and Play Store routing', () => {
    const config = {
      min_android_build: 40,
      latest_android_build: 44,
      play_store_url: PLAY_STORE_URL,
    };
    expect(evaluateUpdate('android', config, '39', null).decision).toBe('required');
    expect(evaluateUpdate('android', config, '42', null).decision).toBe('recommended');
    const current = evaluateUpdate('android', config, '44', null);
    expect(current.decision).toBe('none');
    expect(current.storeUrl).toBe(PLAY_STORE_URL);
    expect(current.storeName).toBe('Play Store');
  });

  it('uses App Store routing on iOS', () => {
    const result = evaluateUpdate('ios', iosConfig, null, '1.1.11');
    expect(result.storeUrl).toBe(APP_STORE_URL);
    expect(result.storeUrlWeb).toBe(APP_STORE_URL_WEB);
    expect(result.storeName).toBe('App Store');
  });
});

describe('update config fetch', () => {
  it('fails open on a server error', async () => {
    const result = await checkForAppUpdate({
      platform: 'ios',
      configUrl: 'https://example.test/config',
      nativeBuildVersion: null,
      nativeApplicationVersion: '1.0.0',
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
    });
    expect(result.decision).toBe('none');
  });

  it('fails open and aborts a timed-out request', async () => {
    let aborted = false;
    const fetchImpl = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      }),
    );
    const result = await checkForAppUpdate({
      platform: 'ios',
      configUrl: 'https://example.test/config',
      nativeBuildVersion: null,
      nativeApplicationVersion: '1.0.0',
      fetchImpl,
      timeoutMs: 5,
    });
    expect(result.decision).toBe('none');
    expect(aborted).toBe(true);
  });
});
