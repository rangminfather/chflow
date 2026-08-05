mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Q-6: Single Instance 플러그인은 등록 순서상 "가장 먼저".
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 두 번째 실행 시: 기존 메인 창 복원 + 포커스.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // 자체 호스팅 API(CORS 비적용 네이티브 요청)용.
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            commands::secure_store::secure_get,
            commands::secure_store::secure_set,
            commands::secure_store::secure_delete,
            commands::secure_store::secure_purge,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
