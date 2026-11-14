//! The per-app Content-Security-Policy. Must stay byte-identical to
//! `packages/protocol/src/csp.ts`; `packages/protocol/test/fixtures/csp-cases.json` is
//! the contract both sides are tested against.

/// `network` must already be validated hosts (see `manifest::AppInfo::parse`): they are
/// pasted into the header as-is. `app_base` is the app's own folder URL, e.g.
/// `ewapp://localhost/org.earlyweb.notepad/0.1.0/`. It sits next to every `'self'`
/// because apps run in an opaque-origin sandbox, where WebKit's `'self'` matches nothing.
pub fn app_csp(network: &[String], shell_origin: &str, app_base: &str) -> String {
    let this = format!("'self' {app_base}");
    let mut connect = this.clone();
    for host in network {
        connect.push_str(" https://");
        connect.push_str(host);
    }
    [
        format!("default-src {this}"),
        format!("script-src {this} 'wasm-unsafe-eval'"),
        format!("style-src {this} 'unsafe-inline'"),
        format!("img-src {this} data: blob:"),
        format!("media-src {this} blob:"),
        format!("connect-src {connect}"),
        format!("frame-ancestors {shell_origin}"),
    ]
    .join("; ")
}
