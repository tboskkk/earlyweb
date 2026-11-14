//! The IPC self-test (`--features e2e` only; never in a release build). The shell writes
//! a canary file, launches a hostile app that tries every way to reach Tauri IPC, and
//! reports the app's verdict through `e2e_report`. Rust is the judge: the run passes only
//! if the app says `blocked`, the shell received an event from Rust (`e2e_ping`), the
//! canary on disk still holds the token, and nothing ever read or stat-ed it. The process exit code is the result (0 pass, 1 fail, 3 watchdog).

use crate::commands::AppState;
use earlyweb_core::{FsError, Node};
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Runtime, State};

pub const CANARY: &str = "/home/user/Documents/canary.txt";
const WATCHDOG: Duration = Duration::from_secs(90);

/// Tells the shell (main frame only) to run the self-test after boot.
pub const INIT_SCRIPT: &str = "window.__EW_SELFTEST__ = true;";

pub struct E2e {
    pub token: String,
    pub canary_reads: AtomicUsize,
}

fn state() -> &'static E2e {
    static STATE: OnceLock<E2e> = OnceLock::new();
    STATE.get_or_init(|| {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(nanos);
        E2e {
            token: format!("ew-canary-{:016x}", h.finish()),
            canary_reads: AtomicUsize::new(0),
        }
    })
}

/// Called by `fs_read` and `fs_stat`. Deliberately broad: any path naming the canary in
/// any spelling or case counts, so a trick path can only fail the run, never pass it.
pub fn note_access(path: &str) {
    if path.to_lowercase().contains("canary") {
        state().canary_reads.fetch_add(1, Ordering::SeqCst);
    }
}

/// The plugin that injects [`INIT_SCRIPT`] into the shell's main frame.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("ew-e2e")
        .js_init_script(INIT_SCRIPT.to_string())
        .build()
}

/// Exits with 3 if no report arrives in time (the app or shell hung).
pub fn start_watchdog() {
    std::thread::spawn(|| {
        std::thread::sleep(WATCHDOG);
        println!("EW-SELFTEST {{\"app\":\"watchdog\"}}");
        let _ = std::io::stdout().flush();
        std::process::exit(3);
    });
}

/// Emits [`PING_EVENT`] to the shell, which must receive it through `listen` (the same
/// path the update prompt uses), proving the capability allows Rust -> shell events.
const PING_EVENT: &str = "ew://selftest-ping";

#[tauri::command]
pub fn e2e_ping<R: Runtime>(app: AppHandle<R>) -> Result<(), FsError> {
    app.emit_to("main", PING_EVENT, "pong")
        .map_err(|e| FsError::new("EINVAL", format!("emit failed: {e}")))
}

#[tauri::command]
pub fn e2e_canary() -> String {
    state().token.clone()
}

fn canary_on_disk(app_state: &AppState) -> Result<bool, FsError> {
    let vfs = app_state.vfs.clone()?;
    match vfs.resolve(CANARY)? {
        Node::Real { path, .. } => Ok(std::fs::read_to_string(path)? == state().token),
        _ => Ok(false),
    }
}

#[tauri::command]
pub fn e2e_report(app_state: State<'_, AppState>, app: String, events: bool) {
    let file_on_disk = canary_on_disk(&app_state).unwrap_or(false);
    let reads = state().canary_reads.load(Ordering::SeqCst);
    let line = serde_json::json!({
        "app": app,
        "events": events,
        "fileOnDisk": file_on_disk,
        "canaryReads": reads,
    });
    println!("EW-SELFTEST {line}");
    let _ = std::io::stdout().flush();
    let pass = app == "blocked" && events && file_on_disk && reads == 0;
    std::process::exit(if pass { 0 } else { 1 });
}
