//! The virtual-path jail: the one place that turns an app-visible POSIX-style path such as
//! `/home/user/Documents/a.txt` into a real path, and refuses anything that could land
//! outside the EarlyWeb folders.
//!
//! Layout (PLAN.md §3.7): `/home/user/**` is the user's EarlyWeb home; `/apps`, `/system`
//! and `/tmp` live under the data dir. `/` and `/home` are purely virtual.

use crate::error::FsError;
use std::fs;
use std::path::{Path, PathBuf};

const ROOT_KIDS: &[&str] = &["apps", "home", "system", "tmp"];
const HOME_KIDS: &[&str] = &["user"];
/// Prefix of the temporary files atomic writes use. Hidden from listings, and reserved:
/// no user-visible name may start with it, so a real file is never mistaken for a leftover.
pub(crate) const TEMP_PREFIX: &str = ".~ew-";
const MAX_SEGMENT_BYTES: usize = 255;
const BAD_CHARS: &[char] = &['\\', ':', '*', '?', '"', '<', '>', '|'];
const RESERVED: &[&str] = &[
    "con",
    "prn",
    "aux",
    "nul",
    "com1",
    "com2",
    "com3",
    "com4",
    "com5",
    "com6",
    "com7",
    "com8",
    "com9",
    "lpt1",
    "lpt2",
    "lpt3",
    "lpt4",
    "lpt5",
    "lpt6",
    "lpt7",
    "lpt8",
    "lpt9",
    // Superscript digits and the console handles are reserved too (Microsoft's naming docs).
    "com\u{b9}",
    "com\u{b2}",
    "com\u{b3}",
    "lpt\u{b9}",
    "lpt\u{b2}",
    "lpt\u{b3}",
    "conin$",
    "conout$",
];

/// What a virtual path points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    /// A directory that exists only in the virtual tree, with its fixed children.
    Virtual(&'static [&'static str]),
    /// A real location. `path` has been checked to resolve inside `root`.
    Real {
        root: PathBuf,
        path: PathBuf,
        /// True when `path` is the mapped root itself (e.g. `/home/user`, `/tmp`).
        is_root: bool,
    },
}

#[derive(Debug, Clone)]
pub struct Vfs {
    home: PathBuf,
    apps: PathBuf,
    system: PathBuf,
    tmp: PathBuf,
}

fn ensure_folder(p: &Path) -> Result<(), FsError> {
    match fs::metadata(p) {
        Ok(m) if !m.is_dir() => Err(FsError::new(
            "EINVAL",
            format!("{} exists and is not a folder", p.display()),
        )),
        _ => Ok(()),
    }
}

impl Vfs {
    /// Creates `home` and `data` if missing, then canonicalizes both. Existing contents are
    /// never touched; a path that exists as a plain file is an error, not something to replace.
    pub fn new(home: PathBuf, data: PathBuf) -> Result<Vfs, FsError> {
        // Validate both before creating either, so a failure leaves nothing half-made.
        ensure_folder(&home)?;
        ensure_folder(&data)?;
        fs::create_dir_all(&home)?;
        fs::create_dir_all(&data)?;
        let home = home.canonicalize()?;
        let data = data.canonicalize()?;
        Ok(Vfs {
            apps: data.join("apps"),
            system: data.join("system"),
            tmp: data.join("tmp"),
            home,
        })
    }

    /// Maps a virtual path to a [`Node`], or fails with `EINVAL` (malformed path or
    /// a name that can't be stored on every OS), `ENOENT` (no such root) or `EPERM`
    /// (would resolve outside its root, e.g. through a symlink).
    pub fn resolve(&self, vpath: &str) -> Result<Node, FsError> {
        let segs = normalize(vpath)?;
        let Some((first, rest)) = segs.split_first() else {
            return Ok(Node::Virtual(ROOT_KIDS));
        };
        let (root, rest): (&Path, &[String]) = match first.as_str() {
            "home" => match rest.split_first() {
                None => return Ok(Node::Virtual(HOME_KIDS)),
                Some((u, tail)) if u == "user" => (&self.home, tail),
                Some(_) => return Err(no_such(vpath)),
            },
            "apps" => (&self.apps, rest),
            "system" => (&self.system, rest),
            "tmp" => (&self.tmp, rest),
            _ => return Err(no_such(vpath)),
        };
        // Both `/apps`-style roots live under the canonical data dir and may not exist yet;
        // the jail below handles missing tails, so only the segments need checking here.
        for seg in rest {
            check_segment(seg)?;
        }
        let mut path = root.to_path_buf();
        path.extend(rest);
        jail(root, &path)?;
        Ok(Node::Real {
            root: root.to_path_buf(),
            is_root: rest.is_empty(),
            path,
        })
    }
}

fn no_such(vpath: &str) -> FsError {
    FsError::new("ENOENT", format!("no such path: {vpath}"))
}

/// Mirrors `normalizePath` in `packages/backends/src/path.ts`: the path must be absolute,
/// `.` and empty segments vanish, and `..` pops one segment or, with nothing left to pop,
/// is an error. Returns the remaining segments.
pub(crate) fn normalize(p: &str) -> Result<Vec<String>, FsError> {
    if !p.starts_with('/') {
        return Err(FsError::new(
            "EINVAL",
            format!("path must be absolute: {p}"),
        ));
    }
    let mut out: Vec<String> = Vec::new();
    for seg in p.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if out.pop().is_none() {
                    return Err(FsError::new("EINVAL", format!("path escapes root: {p}")));
                }
            }
            s => out.push(s.to_string()),
        }
    }
    Ok(out)
}

/// A file name must be storable on Windows, macOS and Linux alike, so a home folder synced
/// between machines stays valid. The message names the rule that was broken.
pub(crate) fn check_segment(seg: &str) -> Result<(), FsError> {
    let bad = |why: String| {
        Err(FsError::new(
            "EINVAL",
            format!("invalid name {seg:?}: {why}"),
        ))
    };
    if seg.len() > MAX_SEGMENT_BYTES {
        return bad(format!("longer than {MAX_SEGMENT_BYTES} bytes"));
    }
    if let Some(c) = seg.chars().find(|c| c.is_control()) {
        return bad(format!(
            "control character U+{:04X} is not allowed",
            c as u32
        ));
    }
    if let Some(c) = seg.chars().find(|c| BAD_CHARS.contains(c)) {
        return bad(format!("the character {c} is not allowed"));
    }
    if seg.starts_with(TEMP_PREFIX) {
        return bad(format!(
            "names starting with {TEMP_PREFIX} are reserved for EarlyWeb"
        ));
    }
    if seg.ends_with('.') || seg.ends_with(' ') {
        return bad("cannot end with a dot or a space".to_string());
    }
    // Windows reserves these device names with any extension (`con.txt`, `com1.tar.gz`),
    // and ignores spaces between the name and the extension (`con .txt`).
    let stem = seg
        .split('.')
        .next()
        .unwrap_or(seg)
        .trim_end_matches(' ')
        .to_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        return bad("reserved name on Windows".to_string());
    }
    Ok(())
}

/// Requires that `path`, with every symlink in it resolved, stays inside `root` (which is
/// already canonical). Only the deepest part that exists can be resolved; the missing tail
/// is free of `..` (see [`normalize`]) so it cannot climb out.
///
/// A symlink that dangles is refused outright: writing through it would create its target,
/// and we cannot show that target is inside.
fn jail(root: &Path, path: &Path) -> Result<(), FsError> {
    let outside = || FsError::new("EPERM", "outside the EarlyWeb folder");
    let mut cur = Some(path);
    while let Some(p) = cur {
        // The walk has climbed above the root itself (e.g. `/tmp` before it is created):
        // nothing at or below the root exists, so there is no symlink that could escape.
        if !p.starts_with(root) {
            return Ok(());
        }
        match fs::symlink_metadata(p) {
            Ok(_) => {
                return match p.canonicalize() {
                    Ok(real) if real.starts_with(root) => Ok(()),
                    Ok(_) => Err(outside()),
                    // It exists but cannot be resolved: a dangling symlink.
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(outside()),
                    Err(e) => Err(e.into()),
                };
            }
            // Missing, or an ancestor is a file: look one level up.
            Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound) || is_not_a_dir(&e) => {
                cur = p.parent();
            }
            Err(e) => return Err(e.into()),
        }
    }
    Err(outside())
}

fn is_not_a_dir(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::NotADirectory
}
