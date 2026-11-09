use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        // Must be the first plugin: a second launch focuses the running EarlyWeb instead
        // of starting another one that would race it on the same files and state.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .run(tauri::generate_context!());
    if let Err(err) = result {
        eprintln!("EarlyWeb failed to start: {err}");
        std::process::exit(1);
    }
}
