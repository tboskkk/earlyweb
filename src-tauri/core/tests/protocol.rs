//! Port of tools/app-server/test/server.test.ts against `protocol::handle`, plus the
//! shared golden CSP cases and the Rust-only cases (bad-host manifests, Windows paths).

use earlyweb_core::csp::app_csp;
use earlyweb_core::manifest::AppInfo;
use earlyweb_core::protocol::handle;
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

const SHELL: &str = "http://localhost:5173";
const APP: &str = "ewapp://localhost";
const BASE: &str = "ewapp://localhost/org.test.app/1.0.0/";

fn manifest_json() -> serde_json::Value {
    serde_json::json!({
        "manifestVersion": 1,
        "id": "org.test.app",
        "name": "Test",
        "version": "1.0.0",
        "description": "d",
        "author": { "name": "a" },
        "license": "MIT",
        "sdk": "^1.0.0",
        "entry": "index.html",
        "icons": { "16": "icons/16.png" },
        "permissions": [],
        "network": ["api.example.com"]
    })
}

fn expected_csp() -> String {
    app_csp(&["api.example.com".to_string()], SHELL, BASE)
}

struct Fixture {
    _tmp: TempDir,
    root: PathBuf,
}

fn write(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(path, body).expect("write");
}

fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().expect("tempdir");
    let root = tmp.path().join("apps");
    let dir = root.join("org.test.app").join("1.0.0");
    write(&dir.join("earlyweb.json"), &manifest_json().to_string());
    write(&dir.join("index.html"), "<!doctype html><title>x</title>");
    write(&dir.join("main.js"), "export {}");
    write(&dir.join("data.bin"), "zz");
    write(
        &dir.join("pic.svg"),
        r#"<svg xmlns="http://www.w3.org/2000/svg"/>"#,
    );
    write(&tmp.path().join("apps-evil").join("x.txt"), "evil sibling");
    write(
        &root.join("org.bad.app").join("1.0.0").join("earlyweb.json"),
        r#"{"id": "nope"}"#,
    );
    write(
        &root
            .join("org.broken.app")
            .join("1.0.0")
            .join("earlyweb.json"),
        "{not json",
    );
    write(&tmp.path().join("secret"), "top secret");
    #[cfg(unix)]
    std::os::unix::fs::symlink(tmp.path().join("secret"), dir.join("link-out")).expect("symlink");
    Fixture { _tmp: tmp, root }
}

fn get(f: &Fixture, path: &str) -> http::Response<Vec<u8>> {
    handle(&f.root, SHELL, APP, "GET", path)
}

fn header<'a>(r: &'a http::Response<Vec<u8>>, name: &str) -> Option<&'a str> {
    r.headers().get(name).and_then(|v| v.to_str().ok())
}

fn body(r: &http::Response<Vec<u8>>) -> String {
    String::from_utf8_lossy(r.body()).into_owned()
}

#[test]
fn csp_matches_golden() {
    let cases: Vec<serde_json::Value> = serde_json::from_str(include_str!(
        "../../../packages/protocol/test/fixtures/csp-cases.json"
    ))
    .expect("fixture parses");
    assert!(cases.len() >= 3);
    for c in cases {
        let network: Vec<String> = c["network"]
            .as_array()
            .expect("network")
            .iter()
            .map(|h| h.as_str().expect("host").to_string())
            .collect();
        let shell = c["shellOrigin"].as_str().expect("shellOrigin");
        let base = c["appBase"].as_str().expect("appBase");
        assert_eq!(
            app_csp(&network, shell, base),
            c["csp"].as_str().expect("csp"),
            "{}",
            c["name"]
        );
    }
}

#[test]
fn manifest_parse_rules() {
    let ok = AppInfo::parse(&manifest_json()).expect("valid");
    assert_eq!(ok.id, "org.test.app");
    assert_eq!(ok.version, "1.0.0");
    assert_eq!(ok.network, vec!["api.example.com".to_string()]);

    let mut no_net = manifest_json();
    no_net.as_object_mut().expect("object").remove("network");
    assert_eq!(AppInfo::parse(&no_net).expect("valid").network.len(), 0);

    let with = |key: &str, value: serde_json::Value| {
        let mut m = manifest_json();
        m[key] = value;
        AppInfo::parse(&m)
    };
    assert!(with("id", "org.app".into()).is_none(), "id needs 3 parts");
    assert!(with("id", "Org.Test.App".into()).is_none());
    assert!(with("version", "1.0".into()).is_none());
    assert!(with("version", "1.0.0-beta.1".into()).is_some());
    assert!(with("network", serde_json::json!(["*.cdn.example.org"])).is_some());
    assert!(with("network", serde_json::json!(["localhost"])).is_none());
    assert!(with("network", serde_json::json!(["a.com/x"])).is_none());
    assert!(with("network", serde_json::json!("api.example.com")).is_none());
    assert!(with("manifestVersion", 2.into()).is_none());
}

// --- index.json -------------------------------------------------------------------

#[test]
fn index_lists_valid_apps_only() {
    let f = fixture();
    let r = get(&f, "/index.json");
    assert_eq!(r.status(), 200);
    assert_eq!(header(&r, "access-control-allow-origin"), Some("*"));
    assert_eq!(header(&r, "x-content-type-options"), Some("nosniff"));
    assert!(header(&r, "content-type")
        .unwrap_or("")
        .contains("application/json"));
    let v: serde_json::Value = serde_json::from_slice(r.body()).expect("json");
    let apps = v["apps"].as_array().expect("apps");
    assert_eq!(apps.len(), 1);
    assert_eq!(apps[0]["manifest"]["id"], "org.test.app");
    // The whole manifest goes out unchanged; the shell validates the full schema.
    assert_eq!(apps[0]["manifest"], manifest_json());
    assert_eq!(apps[0]["baseUrl"], "/org.test.app/1.0.0/");
}

#[test]
fn index_of_missing_root_is_empty() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let r = handle(&tmp.path().join("nope"), SHELL, APP, "GET", "/index.json");
    assert_eq!(r.status(), 200);
    assert_eq!(body(&r), r#"{"apps":[]}"#);
}

// --- static files -------------------------------------------------------------------

#[test]
fn html_gets_the_app_csp_and_nosniff() {
    let f = fixture();
    let r = get(&f, "/org.test.app/1.0.0/index.html");
    assert_eq!(r.status(), 200);
    assert_eq!(
        header(&r, "content-security-policy"),
        Some(expected_csp().as_str())
    );
    assert_eq!(header(&r, "x-content-type-options"), Some("nosniff"));
    assert!(header(&r, "content-type")
        .unwrap_or("")
        .contains("text/html"));
    assert_eq!(header(&r, "access-control-allow-origin"), Some("*"));
}

#[test]
fn js_has_javascript_type_acao_and_csp() {
    let f = fixture();
    let r = get(&f, "/org.test.app/1.0.0/main.js");
    assert_eq!(r.status(), 200);
    assert!(header(&r, "content-type")
        .unwrap_or("")
        .contains("text/javascript"));
    assert_eq!(header(&r, "access-control-allow-origin"), Some("*"));
    assert_eq!(
        header(&r, "content-security-policy"),
        Some(expected_csp().as_str())
    );
    assert_eq!(header(&r, "content-length"), Some("9"));
    assert_eq!(body(&r), "export {}");
}

#[test]
fn csp_names_the_app_folder_under_the_app_origin() {
    let f = fixture();
    let r = get(&f, "/org.test.app/1.0.0/index.html");
    let csp = header(&r, "content-security-policy").unwrap_or("");
    assert!(
        csp.contains("script-src 'self' ewapp://localhost/org.test.app/1.0.0/ 'wasm-unsafe-eval'"),
        "{csp}"
    );
    // Windows origin, and a trailing slash on the origin is not doubled.
    let r = handle(
        &f.root,
        SHELL,
        "http://ewapp.localhost/",
        "GET",
        "/org.test.app/1.0.0/index.html",
    );
    let csp = header(&r, "content-security-policy").unwrap_or("");
    assert!(
        csp.contains("default-src 'self' http://ewapp.localhost/org.test.app/1.0.0/;"),
        "{csp}"
    );
}

#[test]
fn svg_carries_the_csp() {
    let f = fixture();
    let r = get(&f, "/org.test.app/1.0.0/pic.svg");
    assert_eq!(r.status(), 200);
    assert_eq!(header(&r, "content-type"), Some("image/svg+xml"));
    assert_eq!(
        header(&r, "content-security-policy"),
        Some(expected_csp().as_str())
    );
}

#[test]
fn unknown_extension_is_octet_stream() {
    let f = fixture();
    let r = get(&f, "/org.test.app/1.0.0/data.bin");
    assert_eq!(header(&r, "content-type"), Some("application/octet-stream"));
}

#[test]
fn query_and_fragment_are_ignored() {
    let f = fixture();
    assert_eq!(get(&f, "/org.test.app/1.0.0/main.js?v=2").status(), 200);
    assert_eq!(get(&f, "/index.json?x").status(), 200);
}

#[test]
fn head_works_other_methods_are_405() {
    let f = fixture();
    let head = handle(&f.root, SHELL, APP, "HEAD", "/org.test.app/1.0.0/main.js");
    assert_eq!(head.status(), 200);
    assert!(head.body().is_empty());
    assert_eq!(header(&head, "content-length"), Some("9"));
    let head_index = handle(&f.root, SHELL, APP, "HEAD", "/index.json");
    assert_eq!(head_index.status(), 200);
    assert!(head_index.body().is_empty());
    for m in ["POST", "PUT", "DELETE", "OPTIONS"] {
        let r = handle(&f.root, SHELL, APP, m, "/org.test.app/1.0.0/main.js");
        assert_eq!(r.status(), 405, "{m}");
        assert_eq!(header(&r, "allow"), Some("GET, HEAD"));
        assert_eq!(header(&r, "x-content-type-options"), Some("nosniff"));
    }
}

#[test]
fn missing_files_and_directories_are_404() {
    let f = fixture();
    for p in [
        "/org.test.app/1.0.0/nope.js",
        "/org.test.app/1.0.0/",
        "/org.test.app/",
        "/",
        "",
    ] {
        assert_eq!(get(&f, p).status(), 404, "{p}");
    }
}

#[cfg(unix)]
#[test]
fn symlink_escaping_root_is_404() {
    let f = fixture();
    let r = get(&f, "/org.test.app/1.0.0/link-out");
    assert_eq!(r.status(), 404);
    assert!(!body(&r).contains("top secret"));
}

#[test]
fn folder_must_match_manifest_id_and_version() {
    let f = fixture();
    // A copy of a valid app filed under the wrong version folder serves nothing.
    let wrong = f.root.join("org.test.app").join("2.0.0");
    write(&wrong.join("earlyweb.json"), &manifest_json().to_string());
    write(&wrong.join("main.js"), "export {}");
    assert_eq!(get(&f, "/org.test.app/2.0.0/main.js").status(), 404);
    // And a broken manifest serves nothing either.
    write(
        &f.root.join("org.broken.app").join("1.0.0").join("main.js"),
        "x",
    );
    assert_eq!(get(&f, "/org.broken.app/1.0.0/main.js").status(), 404);
}

// --- traversal ----------------------------------------------------------------------

#[test]
fn traversal_is_rejected() {
    let f = fixture();
    for p in [
        "/org.test.app/1.0.0/../../secret",
        "/org.test.app/1.0.0/%2e%2e/%2e%2e/secret",
        "/org.test.app/1.0.0/%2E%2E/%2E%2E/secret",
        "/org.test.app/1.0.0/..%2f..%2fsecret",
        "/org.test.app/1.0.0/%2e%2e%2f%2e%2e%2fsecret",
        "/org.test.app/1.0.0/%252e%252e%252f%252e%252e%252fsecret",
        "/org.test.app/1.0.0/..\\..\\secret",
        "/org.test.app/1.0.0/..%5c..%5csecret",
        "/org.test.app/1.0.0/main.js%00.png",
        "/org.test.app/1.0.0//etc/passwd",
        "/etc/passwd",
        "/..%2fsecret",
        "/%2e%2e/secret",
        "//etc/passwd",
    ] {
        let r = get(&f, p);
        assert_eq!(r.status(), 404, "{p}");
        assert!(!body(&r).contains("top secret"), "{p}");
        assert!(!body(&r).contains("root:"), "{p}");
    }
}

#[test]
fn sibling_directory_sharing_the_root_prefix_is_unreachable() {
    let f = fixture();
    for p in [
        "/org.test.app/1.0.0/../../../apps-evil/x.txt",
        "/%2e%2e/apps-evil/x.txt",
        "/apps-evil/x.txt",
    ] {
        let r = get(&f, p);
        assert_eq!(r.status(), 404, "{p}");
        assert!(!body(&r).contains("evil sibling"), "{p}");
    }
}

#[test]
fn proof_the_same_file_is_reachable_legitimately() {
    let f = fixture();
    let r = get(&f, "/org.test.app/1.0.0/main.js");
    assert_eq!(r.status(), 200);
    assert_eq!(body(&r), "export {}");
}

#[test]
fn malformed_percent_escapes_are_400() {
    let f = fixture();
    for p in [
        "/org.test.app/1.0.0/%E0%A4%A",
        "/org.test.app/1.0.0/%zz.js",
        "/org.test.app/1.0.0/%",
        "/org.test.app/1.0.0/%ff.js",
    ] {
        assert_eq!(get(&f, p).status(), 400, "{p}");
    }
    assert_eq!(get(&f, "/index.json").status(), 200);
}

#[test]
fn windows_style_paths_404() {
    let f = fixture();
    for p in [
        "/org.test.app/1.0.0/..%5c..%5cx",
        "/org.test.app/1.0.0/C:%2fx",
        "/org.test.app/1.0.0/C:x",
        "/org.test.app/1.0.0/main.js:stream",
    ] {
        assert_eq!(get(&f, p).status(), 404, "{p}");
    }
}

#[test]
fn manifest_with_bad_host_is_skipped() {
    let f = fixture();
    let dir = f.root.join("org.evil.app").join("1.0.0");
    let mut m = manifest_json();
    m["id"] = "org.evil.app".into();
    m["network"] = serde_json::json!(["evil.com; script-src *"]);
    write(&dir.join("earlyweb.json"), &m.to_string());
    write(&dir.join("index.html"), "<script>alert(1)</script>");

    let v: serde_json::Value = serde_json::from_slice(get(&f, "/index.json").body()).expect("json");
    let ids: Vec<&str> = v["apps"]
        .as_array()
        .expect("apps")
        .iter()
        .map(|a| a["manifest"]["id"].as_str().unwrap_or(""))
        .collect();
    assert_eq!(ids, vec!["org.test.app"]);
    assert_eq!(get(&f, "/org.evil.app/1.0.0/index.html").status(), 404);
}
