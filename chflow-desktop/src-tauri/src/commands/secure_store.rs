// 보안 세션 저장 — Windows Credential Manager 기반(keyring v3).
//
// 설계 기준 Q-2: Supabase 세션 토큰을 localStorage 가 아닌 OS 자격증명 저장소에 보관.
// 프런트의 custom auth storage adapter(secureStorage.ts)가 이 커맨드를 호출한다.
//
// 보안: 프런트 입력을 신뢰하지 않고 key 형식을 검증한다(Codex 11.3).
//
// ⚠️ 미검증 위험: Windows Credential Manager blob 크기 한도(~2.5KB)보다 Supabase
//    세션 JSON 이 클 수 있음 → 초과 시 set 실패 가능. 검증 후 분할 저장 또는
//    Stronghold 폴백 검토.

use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "chflow-desktop";

/// 허용 key: 영숫자 + - _ . , 최대 128자. (supabase storageKey 형태)
fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

#[tauri::command]
pub fn secure_get(key: String) -> Result<Option<String>, String> {
    if !valid_key(&key) {
        return Err("invalid key".into());
    }
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secure_set(key: String, value: String) -> Result<(), String> {
    if !valid_key(&key) {
        return Err("invalid key".into());
    }
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_delete(key: String) -> Result<(), String> {
    if !valid_key(&key) {
        return Err("invalid key".into());
    }
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
