// Supabase 세션을 위한 custom async storage adapter.
//
// 설계 기준(Q-2): localStorage 사용 금지. Supabase 클라이언트 "생성 시점부터"
// 이 어댑터를 주입한다. 우선안 = Windows Credential Manager 기반 Rust keyring
// (Tauri 커맨드 secure_get/secure_set/secure_delete).
//
// ⚠️ 미검증 위험: Windows Credential Manager blob 한도(~2.5KB)보다 Supabase
//    세션 JSON이 클 수 있음 → 초과 시 분할 저장 또는 Stronghold 폴백(검증 대상).
//
// Tauri 밖(브라우저 vite dev/preview)에서는 keyring 호출이 불가하므로
// "메모리 폴백"을 쓴다(새로고침 시 세션 소실). localStorage로는 절대 폴백하지 않는다.

import { invoke } from "@tauri-apps/api/core";

// @tauri-apps/api 는 Tauri 런타임 주입 전역(__TAURI_INTERNALS__)으로 환경을 판별.
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const memoryFallback = new Map<string, string>();
let warnedFallback = false;

function warnOnce() {
  if (!warnedFallback) {
    warnedFallback = true;
    // 보안 경고: 비-Tauri 환경에서는 세션이 메모리에만 유지됨(영속 안 됨).
    console.warn(
      "[secureStorage] Tauri 런타임이 아니어서 메모리 폴백 사용 — 세션이 영속되지 않습니다(UI 개발용)."
    );
  }
}

export interface AsyncStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const secureStorage: AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isTauri()) {
      warnOnce();
      return memoryFallback.get(key) ?? null;
    }
    try {
      const v = await invoke<string | null>("secure_get", { key });
      return v ?? null;
    } catch (e) {
      console.error("[secureStorage] secure_get 실패:", e);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!isTauri()) {
      warnOnce();
      memoryFallback.set(key, value);
      return;
    }
    try {
      await invoke("secure_set", { key, value });
    } catch (e) {
      console.error("[secureStorage] secure_set 실패:", e);
      throw e;
    }
  },

  async removeItem(key: string): Promise<void> {
    if (!isTauri()) {
      warnOnce();
      memoryFallback.delete(key);
      return;
    }
    try {
      await invoke("secure_delete", { key });
    } catch (e) {
      console.error("[secureStorage] secure_delete 실패:", e);
    }
  },
};
