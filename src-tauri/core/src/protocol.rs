//! The `ewapp://` request handler: a port of `tools/app-server/src/server.ts`, the M1
//! app server. Serves `<root>/<appId>/<version>/<file>` with the app's CSP, plus
//! `/index.json` listing the installed apps. Everything outside the jail is a 404.

use crate::csp::app_csp;
use crate::manifest::AppInfo;
use http::header::{HeaderName, HeaderValue};
use http::{Response, StatusCode};
use percent_encoding::percent_decode_str;
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const JSON: &str = "application/json; charset=utf-8";
const TEXT: &str = "text/plain; charset=utf-8";

/// The id and version folder names (same pattern as the M1 app server).
const SEGMENT: &str = r"^[A-Za-z0-9][A-Za-z0-9._-]*$";

fn is_segment(s: &str) -> bool {
    static RE: OnceLock<Option<Regex>> = OnceLock::new();
    RE.get_or_init(|| Regex::new(SEGMENT).ok())
        .as_ref()
        .is_some_and(|re| re.is_match(s))
}

fn content_type(file: &Path) -> &'static str {
    let ext = file
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => JSON,
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("wasm") => "application/wasm",
        Some("mp3") => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

/// A response with the headers every reply carries. A header value that can't be
/// encoded turns the whole reply into a bare 500, so a CSP is never silently dropped.
fn reply(
    status: StatusCode,
    body: Vec<u8>,
    head: bool,
    headers: &[(&'static str, &str)],
) -> Response<Vec<u8>> {
    let len = body.len().to_string();
    let mut res = Response::new(if head { Vec::new() } else { body });
    *res.status_mut() = status;
    let h = res.headers_mut();
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("content-length", HeaderValue::from_static("0"));
    for (name, value) in headers
        .iter()
        .copied()
        .chain([("content-length", len.as_str())])
    {
        match HeaderValue::from_str(value) {
            Ok(v) => {
                h.insert(HeaderName::from_static(name), v);
            }
            Err(_) => {
                let mut err = Response::new(Vec::new());
                *err.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
                return err;
            }
        }
    }
    res
}

fn text(status: StatusCode, msg: &str, head: bool) -> Response<Vec<u8>> {
    reply(
        status,
        msg.as_bytes().to_vec(),
        head,
        &[("content-type", TEXT)],
    )
}

fn not_found(head: bool) -> Response<Vec<u8>> {
    text(StatusCode::NOT_FOUND, "not found", head)
}

/// `target` resolved through symlinks, only if it is strictly inside `real_root`.
fn real_inside(real_root: &Path, target: &Path) -> Option<PathBuf> {
    let real = target.canonicalize().ok()?;
    (real != real_root && real.starts_with(real_root)).then_some(real)
}

/// The manifest of `<root>/<id>/<version>/`, only if it is valid and its id and version
/// match the folder it sits in. Returns the raw JSON too, for `/index.json`.
fn app_manifest(real_root: &Path, id: &str, version: &str) -> Option<(AppInfo, serde_json::Value)> {
    let file = real_inside(
        real_root,
        &real_root.join(id).join(version).join("earlyweb.json"),
    )?;
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    let info = AppInfo::parse(&json)?;
    (info.id == id && info.version == version).then_some((info, json))
}

/// Sorted names of the sub-folders of `dir` (not following symlinks) that pass `SEGMENT`.
fn folders(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| is_segment(n))
        .collect();
    names.sort();
    names
}

fn index(apps_root: &Path) -> serde_json::Value {
    let mut apps = Vec::new();
    if let Ok(real_root) = apps_root.canonicalize() {
        for id in folders(&real_root) {
            for version in folders(&real_root.join(&id)) {
                if let Some((_, manifest)) = app_manifest(&real_root, &id, &version) {
                    apps.push(serde_json::json!({
                        "manifest": manifest,
                        "baseUrl": format!("/{id}/{version}/"),
                    }));
                }
            }
        }
    }
    serde_json::json!({ "apps": apps })
}

/// Percent-decodes like JS `decodeURIComponent`: `None` (a 400) for a `%` not followed
/// by two hex digits, or for bytes that aren't UTF-8.
fn decode(path: &str) -> Option<String> {
    let b = path.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let ok = b.get(i + 1).is_some_and(u8::is_ascii_hexdigit)
                && b.get(i + 2).is_some_and(u8::is_ascii_hexdigit);
            if !ok {
                return None;
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    percent_decode_str(path)
        .decode_utf8()
        .ok()
        .map(|s| s.into_owned())
}

/// Serves one `ewapp://` request. `app_origin` is the origin apps are served at
/// (`ewapp://localhost`, or `http://ewapp.localhost` on Windows): each app's CSP names
/// its folder under it. `raw_path` is the URL path as sent (still percent-encoded); a
/// query or fragment is ignored.
pub fn handle(
    apps_root: &Path,
    shell_origin: &str,
    app_origin: &str,
    method: &str,
    raw_path: &str,
) -> Response<Vec<u8>> {
    let head = match method {
        "GET" => false,
        "HEAD" => true,
        _ => {
            return reply(
                StatusCode::METHOD_NOT_ALLOWED,
                b"method not allowed".to_vec(),
                false,
                &[("content-type", TEXT), ("allow", "GET, HEAD")],
            )
        }
    };

    let path = raw_path.split(['?', '#']).next().unwrap_or_default();
    if path == "/index.json" {
        let body = index(apps_root).to_string().into_bytes();
        return reply(StatusCode::OK, body, head, &[("content-type", JSON)]);
    }

    let Some(decoded) = decode(path) else {
        return text(StatusCode::BAD_REQUEST, "bad request", head);
    };
    if decoded.contains('\0') || decoded.contains('\\') || !decoded.starts_with('/') {
        return not_found(head);
    }
    let segments: Vec<&str> = decoded[1..].split('/').collect();
    // `:` is never needed in an app file name, and on Windows it means a drive (`C:`) or
    // an alternate data stream (`file:stream`).
    if segments.len() < 3
        || segments
            .iter()
            .any(|s| s.is_empty() || *s == "." || *s == ".." || s.contains(':'))
    {
        return not_found(head);
    }
    let (id, version) = (segments[0], segments[1]);
    if !is_segment(id) || !is_segment(version) {
        return not_found(head);
    }

    let Ok(real_root) = apps_root.canonicalize() else {
        return not_found(head);
    };
    let target: PathBuf = segments.iter().fold(real_root.clone(), |p, s| p.join(s));
    let Some(real) = real_inside(&real_root, &target) else {
        return not_found(head);
    };
    if !real.is_file() {
        return not_found(head);
    }
    let Some((info, _)) = app_manifest(&real_root, id, version) else {
        return not_found(head);
    };
    let Ok(data) = std::fs::read(&real) else {
        return not_found(head);
    };
    let base = format!("{}/{id}/{version}/", app_origin.trim_end_matches('/'));
    let csp = app_csp(&info.network, shell_origin, &base);
    reply(
        StatusCode::OK,
        data,
        head,
        &[
            ("content-type", content_type(&target)),
            ("content-security-policy", &csp),
        ],
    )
}
