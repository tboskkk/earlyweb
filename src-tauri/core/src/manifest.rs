//! The security-relevant slice of an app manifest. The shell validates the full schema
//! (`packages/protocol/src/manifest.ts`); Rust only needs what decides where files are
//! served from and what goes into the CSP header, with the same rules.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppInfo {
    pub id: String,
    pub version: String,
    pub network: Vec<String>,
}

// Same patterns as manifest.ts. `[0-9]`, not `\d`: Rust's `\d` is Unicode-aware.
const ID: &str = r"^[a-z0-9]+(\.[a-z0-9-]+){2,}$";
const SEMVER: &str = r"^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$";
const HOST: &str = r"^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$";

/// Matches `pattern`, compiled once. A pattern that fails to compile matches nothing,
/// so a bug here rejects every manifest instead of letting one through.
fn matches(cell: &'static OnceLock<Option<Regex>>, pattern: &str, s: &str) -> bool {
    cell.get_or_init(|| Regex::new(pattern).ok())
        .as_ref()
        .is_some_and(|re| re.is_match(s))
}

impl AppInfo {
    /// `None` unless `manifestVersion` is 1 and `id`, `version` and every `network` host
    /// are valid. One bad host rejects the whole manifest, so nothing reaches the CSP.
    pub fn parse(json: &serde_json::Value) -> Option<AppInfo> {
        static ID_RE: OnceLock<Option<Regex>> = OnceLock::new();
        static SEMVER_RE: OnceLock<Option<Regex>> = OnceLock::new();
        static HOST_RE: OnceLock<Option<Regex>> = OnceLock::new();

        if json.get("manifestVersion")?.as_f64()? != 1.0 {
            return None;
        }
        let id = json.get("id")?.as_str()?;
        let version = json.get("version")?.as_str()?;
        if !matches(&ID_RE, ID, id) || !matches(&SEMVER_RE, SEMVER, version) {
            return None;
        }
        let network = match json.get("network") {
            None => Vec::new(),
            Some(v) => v
                .as_array()?
                .iter()
                .map(|h| {
                    let h = h.as_str()?;
                    matches(&HOST_RE, HOST, h).then(|| h.to_string())
                })
                .collect::<Option<Vec<String>>>()?,
        };
        Some(AppInfo {
            id: id.to_string(),
            version: version.to_string(),
            network,
        })
    }
}
