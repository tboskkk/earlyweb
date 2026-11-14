//! Background update check against GitHub Releases (`plugins.updater` in tauri.conf.json).
//! A found update is kept here and announced to the shell as `ew://update-available`; the
//! shell asks the user, and only their "Restart Now" calls `update_install`. A failed or
//! empty check only logs: no network must never mean an error box.

use earlyweb_core::FsError;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const EVENT: &str = "ew://update-available";

/// The update found by the last check, waiting for the user.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

/// Starts the check, except in debug and self-test builds (no dev build ever updates
/// itself into a release).
pub fn spawn_check<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(debug_assertions) || cfg!(feature = "e2e") {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let found = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(e) => Err(e),
        };
        match found {
            Ok(Some(update)) => {
                let version = update.version.clone();
                if let Ok(mut slot) = app.state::<PendingUpdate>().0.lock() {
                    *slot = Some(update);
                }
                let payload = serde_json::json!({ "version": version });
                if let Err(e) = app.emit_to("main", EVENT, payload) {
                    eprintln!("EarlyWeb update {version} found but not announced: {e}");
                }
            }
            Ok(None) => eprintln!("EarlyWeb is up to date"),
            Err(e) => eprintln!("EarlyWeb update check failed: {e}"),
        }
    });
}

/// Downloads, verifies (the plugin checks the signature) and installs the pending update,
/// then restarts. On Windows the installer exits the app itself.
#[tauri::command]
pub async fn update_install<R: Runtime>(
    app: AppHandle<R>,
    pending: State<'_, PendingUpdate>,
) -> Result<(), FsError> {
    let update = pending
        .0
        .lock()
        .map_err(|_| FsError::new("EINVAL", "update state is unavailable"))?
        .clone()
        .ok_or_else(|| FsError::new("EINVAL", "no update is ready to install"))?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| FsError::new("EINVAL", format!("update failed: {e}")))?;
    app.restart()
}
