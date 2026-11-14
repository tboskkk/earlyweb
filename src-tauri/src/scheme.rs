//! `ewapp://`: serves the bundled apps through `earlyweb_core::protocol::handle`.
//! The origin is `ewapp://localhost` on Linux/macOS and `http://ewapp.localhost` on
//! Windows (Tauri maps custom schemes to that fixed host there).

use earlyweb_core::protocol;
use std::path::PathBuf;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub const SCHEME: &str = "ewapp";

/// The origin apps are served at (Tauri's fixed mapping for custom schemes).
pub fn app_origin() -> &'static str {
    if cfg!(windows) {
        "http://ewapp.localhost"
    } else {
        "ewapp://localhost"
    }
}

/// The origin the shell runs at, which apps' CSP allows as `frame-ancestors`.
pub fn shell_origin<R: Runtime>(app: &AppHandle<R>) -> String {
    if tauri::is_dev() {
        if let Some(url) = &app.config().build.dev_url {
            return url.origin().ascii_serialization();
        }
    }
    if cfg!(windows) {
        "http://tauri.localhost".to_string()
    } else {
        "tauri://localhost".to_string()
    }
}

/// Where the app bundles are. In `tauri dev`, straight from the build output, so the
/// `--watch` rebuilds show up without restarting; otherwise the bundled resources.
fn apps_root<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if tauri::is_dev() {
        return Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/bundle-apps"));
    }
    app.path().resource_dir().ok().map(|d| d.join("apps"))
}

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle();
    let origin = shell_origin(app);
    let root = apps_root(app);
    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();
    // File reads stay off the webview's thread.
    tauri::async_runtime::spawn_blocking(move || {
        let response = match root {
            Some(root) => protocol::handle(&root, &origin, app_origin(), &method, &path),
            None => {
                let mut r = Response::new(b"not found".to_vec());
                *r.status_mut() = StatusCode::NOT_FOUND;
                r
            }
        };
        responder.respond(response);
    });
}
