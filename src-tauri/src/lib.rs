mod commands;
mod scheme;

use commands::AppState;
use earlyweb_core::{FsError, Kv, Vfs};
use std::path::PathBuf;
use tauri::Manager;

/// Where files live: `~/EarlyWeb` and the app data dir, unless `EARLYWEB_HOME` /
/// `EARLYWEB_DATA` say otherwise (used by tests). Never panics: a failure becomes the
/// error every fs command reports.
fn locations(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), FsError> {
    let from_env = |key: &str| {
        std::env::var_os(key)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    let resolver = app.path();
    let home = match from_env("EARLYWEB_HOME") {
        Some(h) => h,
        None => resolver
            .home_dir()
            .map_err(|e| FsError::new("EINVAL", format!("cannot find your home folder: {e}")))?
            .join("EarlyWeb"),
    };
    let data = match from_env("EARLYWEB_DATA") {
        Some(d) => d,
        None => resolver
            .app_data_dir()
            .map_err(|e| FsError::new("EINVAL", format!("cannot find the app data folder: {e}")))?,
    };
    Ok((home, data))
}

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
        .register_asynchronous_uri_scheme_protocol(scheme::SCHEME, scheme::handle)
        .setup(|app| {
            let places = locations(app.handle());
            let vfs = places.clone().and_then(|(home, data)| Vfs::new(home, data));
            let kv = places.and_then(|(_, data)| Kv::new(data.join("state")));
            if let Err(e) = &vfs {
                eprintln!("EarlyWeb storage unavailable: {e}");
            }
            if let Err(e) = &kv {
                eprintln!("EarlyWeb saved state unavailable: {e}");
            }
            app.manage(AppState { vfs, kv });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs_stat,
            commands::fs_list,
            commands::fs_read,
            commands::fs_write,
            commands::fs_mkdir,
            commands::fs_remove,
            commands::fs_rename,
            commands::kv_get,
            commands::kv_set,
            commands::kv_delete,
        ])
        .run(tauri::generate_context!());
    if let Err(err) = result {
        eprintln!("EarlyWeb failed to start: {err}");
        std::process::exit(1);
    }
}
