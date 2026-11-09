//! Thin `#[tauri::command]` wrappers over `earlyweb-core`. All the rules live in the core
//! crate; these only move bytes and errors across the IPC boundary. Only the shell's main
//! window may call them (see `capabilities/shell.json`).

use earlyweb_core::{FsError, FsStat, Vfs};
use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

/// Shared app state. `vfs` is an `Err` when the home folder could not be set up (for
/// example `~/EarlyWeb` exists as a plain file): every fs command then returns that error,
/// and the shell shows it as the boot error instead of the app crashing.
pub struct AppState {
    pub vfs: Result<Vfs, FsError>,
}

/// Runs blocking file work off the async runtime, so a big read or write never stalls IPC.
async fn blocking<T, F>(state: &AppState, f: F) -> Result<T, FsError>
where
    T: Send + 'static,
    F: FnOnce(Vfs) -> Result<T, FsError> + Send + 'static,
{
    let vfs = state.vfs.clone()?;
    tauri::async_runtime::spawn_blocking(move || f(vfs))
        .await
        .map_err(|e| FsError::new("EINVAL", format!("file task failed: {e}")))?
}

#[tauri::command]
pub async fn fs_stat(state: State<'_, AppState>, path: String) -> Result<Option<FsStat>, FsError> {
    blocking(&state, move |v| v.stat(&path)).await
}

#[tauri::command]
pub async fn fs_list(state: State<'_, AppState>, path: String) -> Result<Vec<FsStat>, FsError> {
    blocking(&state, move |v| v.list(&path)).await
}

#[tauri::command]
pub async fn fs_read(state: State<'_, AppState>, path: String) -> Result<Response, FsError> {
    blocking(&state, move |v| v.read(&path))
        .await
        .map(Response::new)
}

/// The body is the raw file bytes and the path travels in the `x-ew-path` header
/// (percent-encoded), so large files skip JSON entirely.
#[tauri::command]
pub async fn fs_write(request: Request<'_>, state: State<'_, AppState>) -> Result<(), FsError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(FsError::new("EINVAL", "fs_write needs a raw byte body"));
    };
    let path = request
        .headers()
        .get("x-ew-path")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| percent_decode_str(v).decode_utf8().ok())
        .map(|p| p.into_owned())
        .ok_or_else(|| FsError::new("EINVAL", "fs_write needs a valid x-ew-path header"))?;
    let bytes = bytes.clone();
    blocking(&state, move |v| v.write(&path, &bytes)).await
}

#[tauri::command]
pub async fn fs_mkdir(state: State<'_, AppState>, path: String) -> Result<(), FsError> {
    blocking(&state, move |v| v.mkdir(&path)).await
}

#[tauri::command]
pub async fn fs_remove(state: State<'_, AppState>, path: String) -> Result<(), FsError> {
    blocking(&state, move |v| v.remove(&path)).await
}

#[tauri::command]
pub async fn fs_rename(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<(), FsError> {
    blocking(&state, move |v| v.rename(&from, &to)).await
}
