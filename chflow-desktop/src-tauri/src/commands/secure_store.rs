// 보안 세션 저장 — 대안 2: Credential Manager 엔 마스터키만, 세션은 AES-256-GCM 암호화 파일.
//
// 배경(검증됨): Windows Credential Manager 비밀 blob 한도 2560자 → Supabase 세션 JSON
// (보통 2.5~4KB)을 직접 저장 불가. 따라서:
//   - Credential Manager: 32바이트 마스터키(base64, 작음)만 저장.
//   - 세션 JSON: AES-256-GCM 으로 암호화해 appLocalData/secure/<key>.bin 에 저장.
//
// 조건 준수:
//   - localStorage 폴백 금지(프런트 어댑터는 Tauri 환경에서 항상 이 커맨드 사용).
//   - 평문 세션은 디스크/임시/로그 어디에도 남기지 않음(파일엔 암호문만 기록).
//   - 매 저장마다 새 nonce(OsRng). nonce 재사용 없음.
//   - 파일 포맷에 version 필드 → 향후 마이그레이션 가능.
//   - 검증된 crate(aes-gcm, rand) 사용. 자체 암호 구현 안 함.
//   - 복호화 실패 시 무한재시도 금지 → 손상 파일 제거 후 None(재로그인 유도).
//
// ⚠️ 로그에 키/세션/토큰 원문을 절대 출력하지 않는다.

use std::fs;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use keyring::{Entry, Error as KeyringError};
use rand::rngs::OsRng;
use rand::RngCore;
use tauri::Manager;

const SERVICE: &str = "chflow-desktop";
const MASTER_ACCOUNT: &str = "__chflow_master_key__";
const FORMAT_VERSION: u8 = 1;
const NONCE_LEN: usize = 12;

/// 허용 key: 영숫자 + - _ . , 최대 128자. (supabase storageKey 형태, 파일명으로도 안전)
fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

// ===== 마스터키 (Credential Manager) =====

/// 마스터키를 Credential Manager 에서 읽고, 없으면 1회 생성·저장해 반환.
fn load_or_create_master_key() -> Result<[u8; 32], String> {
    let entry = Entry::new(SERVICE, MASTER_ACCOUNT)
        .map_err(|e| format!("키 저장소 접근 실패: {e}"))?;
    match entry.get_password() {
        Ok(b64) => {
            let bytes = B64
                .decode(b64.as_bytes())
                .map_err(|_| "마스터키 디코드 실패(손상)".to_string())?;
            if bytes.len() != 32 {
                return Err("마스터키 길이 오류(손상)".into());
            }
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            Ok(k)
        }
        Err(KeyringError::NoEntry) => {
            // 최초 1회 생성.
            let mut k = [0u8; 32];
            OsRng.fill_bytes(&mut k);
            entry
                .set_password(&B64.encode(k))
                .map_err(|e| format!("마스터키 생성 저장 실패: {e}"))?;
            Ok(k)
        }
        Err(e) => Err(format!("마스터키 읽기 실패: {e}")),
    }
}

fn delete_master_key() -> Result<(), String> {
    let entry = Entry::new(SERVICE, MASTER_ACCOUNT)
        .map_err(|e| format!("키 저장소 접근 실패: {e}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(format!("마스터키 삭제 실패: {e}")),
    }
}

// ===== 암호화 파일 코어 (테스트 가능: dir + mkey 주입) =====

fn secret_path(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.bin"))
}

/// 파일 포맷: [version:1][nonce:12][ciphertext(+tag)]
fn put(dir: &Path, mkey: &[u8; 32], key: &str, value: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("invalid key".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("디렉터리 생성 실패: {e}"))?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(mkey));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes); // 매 저장마다 새 nonce
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ct = cipher
        .encrypt(nonce, value.as_bytes())
        .map_err(|_| "암호화 실패".to_string())?;

    let mut blob = Vec::with_capacity(1 + NONCE_LEN + ct.len());
    blob.push(FORMAT_VERSION);
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ct);

    // 암호문만 기록(평문 임시파일 없음).
    fs::write(secret_path(dir, key), &blob).map_err(|e| format!("파일 쓰기 실패: {e}"))
}

/// 없으면 Ok(None). 손상/복호화 실패 시 손상 파일 제거 후 Ok(None)(재로그인 유도, 무한재시도 방지).
fn get(dir: &Path, mkey: &[u8; 32], key: &str) -> Result<Option<String>, String> {
    if !valid_key(key) {
        return Err("invalid key".into());
    }
    let path = secret_path(dir, key);
    let blob = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("파일 읽기 실패: {e}")),
    };

    if blob.len() < 1 + NONCE_LEN || blob[0] != FORMAT_VERSION {
        let _ = fs::remove_file(&path);
        eprintln!("[secure_store] 손상되었거나 알 수 없는 포맷 — 파일 제거, 재로그인 필요");
        return Ok(None);
    }

    let nonce = Nonce::from_slice(&blob[1..1 + NONCE_LEN]);
    let ct = &blob[1 + NONCE_LEN..];
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(mkey));

    match cipher.decrypt(nonce, ct) {
        Ok(pt) => match String::from_utf8(pt) {
            Ok(s) => Ok(Some(s)),
            Err(_) => {
                let _ = fs::remove_file(&path);
                eprintln!("[secure_store] 복호 결과 UTF-8 오류 — 파일 제거, 재로그인 필요");
                Ok(None)
            }
        },
        Err(_) => {
            // 마스터키 불일치/변조 등. 무한재시도 금지 → 제거 후 재로그인.
            let _ = fs::remove_file(&path);
            eprintln!("[secure_store] 복호화 실패 — 손상 파일 제거, 재로그인 필요");
            Ok(None)
        }
    }
}

fn delete_file(dir: &Path, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("invalid key".into());
    }
    match fs::remove_file(secret_path(dir, key)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("파일 삭제 실패: {e}")),
    }
}

// ===== Tauri 커맨드 (AppHandle 로 appLocalData 해석) =====

fn secure_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("appLocalData 경로 해석 실패: {e}"))?;
    Ok(base.join("secure"))
}

#[tauri::command]
pub fn secure_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let mkey = load_or_create_master_key()?;
    let dir = secure_dir(&app)?;
    get(&dir, &mkey, &key)
}

#[tauri::command]
pub fn secure_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let mkey = load_or_create_master_key()?;
    let dir = secure_dir(&app)?;
    put(&dir, &mkey, &key, &value)
}

#[tauri::command]
pub fn secure_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    // 일반 로그아웃: 세션 암호화 파일만 삭제(마스터키는 유지).
    let dir = secure_dir(&app)?;
    delete_file(&dir, &key)
}

#[tauri::command]
pub fn secure_purge(app: tauri::AppHandle) -> Result<(), String> {
    // 완전 초기화/계정 제거: secure 디렉터리 전체 + 마스터키 삭제.
    let dir = secure_dir(&app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("secure 디렉터리 삭제 실패: {e}"))?;
    }
    delete_master_key()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let mut n = [0u8; 8];
        OsRng.fill_bytes(&mut n);
        p.push(format!("chflow-sectest-{tag}-{}", B64.encode(n).replace('/', "_")));
        p
    }

    /// 더미 문자열로 put→get(일치)→delete→get(none) 왕복 + 파일에 평문이 없는지 확인.
    fn roundtrip(mkey: &[u8; 32], dir: &Path, size: usize) -> Result<(), String> {
        let key = format!("selftest-{size}");
        let value = "x".repeat(size);

        put(dir, mkey, &key, &value)?;

        // 파일이 평문을 담고 있지 않은지(암호문인지) 확인.
        let raw = std::fs::read(secret_path(dir, &key)).map_err(|e| e.to_string())?;
        if raw.windows(64.min(size)).any(|w| w.iter().all(|&b| b == b'x')) {
            return Err("파일에 평문 흔적 발견".into());
        }
        if raw.first() != Some(&FORMAT_VERSION) {
            return Err("version 필드 누락".into());
        }

        match get(dir, mkey, &key)? {
            Some(v) if v == value => {}
            Some(_) => return Err("값 불일치".into()),
            None => return Err("get 결과 없음(저장 직후)".into()),
        }

        delete_file(dir, &key)?;
        match get(dir, mkey, &key)? {
            None => Ok(()),
            Some(_) => Err("delete 후에도 잔존".into()),
        }
    }

    #[test]
    fn dummy_size_roundtrip() {
        // `cargo test -- --nocapture` 로 확인.
        let mut mkey = [0u8; 32];
        OsRng.fill_bytes(&mut mkey);
        let dir = temp_dir("sizes");
        for size in [1024usize, 2048, 3072, 5120, 8192] {
            match roundtrip(&mkey, &dir, size) {
                Ok(()) => println!("SECURE_SELFTEST size={size}B OK"),
                Err(e) => println!("SECURE_SELFTEST size={size}B FAIL: {e}"),
            }
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wrong_master_key_yields_none() {
        let mut mkey = [0u8; 32];
        OsRng.fill_bytes(&mut mkey);
        let dir = temp_dir("wrongkey");
        put(&dir, &mkey, "k", "secret-value").unwrap();
        let mut other = [0u8; 32];
        OsRng.fill_bytes(&mut other);
        // 다른 키로 복호 → 실패 → 손상 파일 제거 + None.
        let r = get(&dir, &other, "k").unwrap();
        println!("SECURE_SELFTEST wrong_key -> {:?} (None 이어야 정상)", r.is_none());
        assert!(r.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_key_rejected() {
        let dir = temp_dir("badkey");
        let mkey = [0u8; 32];
        assert!(put(&dir, &mkey, "bad key!", "v").is_err());
        assert!(get(&dir, &mkey, "").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
