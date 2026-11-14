//! File operations on real files, behind the jail in [`crate::vfs`]. Semantics and error
//! codes deliberately match the IndexedDB backend (`packages/backends/src/web/idb-fs.ts`),
//! so apps cannot tell which backend they run on.

use crate::error::FsError;
use crate::vfs::{check_segment, normalize, Node, Vfs, TEMP_PREFIX};
use serde::Serialize;
use std::fs;
use std::io::{self, ErrorKind, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A directory entry as the shell sees it. Field names match `FsStat` in `packages/backends`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FsStat {
    /// Normalized virtual path.
    pub path: String,
    pub name: String,
    /// `"file"` or `"dir"`.
    pub kind: &'static str,
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub mtime: f64,
}

fn ms(t: SystemTime) -> f64 {
    t.duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

fn stat_of(path: String, name: String, m: &fs::Metadata) -> FsStat {
    FsStat {
        path,
        name,
        kind: if m.is_dir() { "dir" } else { "file" },
        size: if m.is_dir() { 0 } else { m.len() },
        mtime: m.modified().map_or(0.0, ms),
    }
}

fn virtual_stat(path: String, name: String) -> FsStat {
    FsStat {
        path,
        name,
        kind: "dir",
        size: 0,
        mtime: ms(SystemTime::now()),
    }
}

/// The normalized virtual path and its last segment (empty for `/`).
fn vstring(vpath: &str) -> Result<(String, String), FsError> {
    let segs = normalize(vpath)?;
    let name = segs.last().cloned().unwrap_or_default();
    Ok((format!("/{}", segs.join("/")), name))
}

fn join_v(dir: &str, name: &str) -> String {
    if dir == "/" {
        format!("/{name}")
    } else {
        format!("{dir}/{name}")
    }
}

fn parent_v(path: &str) -> String {
    match path.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(i) => path[..i].to_string(),
    }
}

/// `ENOENT` for a missing path (or one below a file); everything else maps as usual.
fn missing(e: io::Error, what: &str, vpath: &str) -> FsError {
    match e.kind() {
        ErrorKind::NotFound | ErrorKind::NotADirectory => {
            FsError::new("ENOENT", format!("no such {what}: {vpath}"))
        }
        _ => e.into(),
    }
}

fn is_missing(e: &io::Error) -> bool {
    matches!(e.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory)
}

/// Writes to a hidden temp file in the same folder, flushes it to disk, then renames it over
/// the target. A crash leaves either the old file or the new one, never a torn mix.
pub(crate) fn atomic_write(target: &Path, data: &[u8]) -> Result<(), FsError> {
    let dir = target
        .parent()
        .ok_or_else(|| FsError::new("EINVAL", "path has no parent folder"))?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(
        "{TEMP_PREFIX}{}-{nanos}-{n}.tmp",
        std::process::id()
    ));
    let result = (|| -> io::Result<()> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(Into::into)
}

impl Vfs {
    /// `None` for a path that does not exist, including one under an unmapped root.
    pub fn stat(&self, vpath: &str) -> Result<Option<FsStat>, FsError> {
        let (vp, name) = vstring(vpath)?;
        match self.resolve(vpath) {
            Err(e) if e.code == "ENOENT" => Ok(None),
            Err(e) => Err(e),
            Ok(Node::Virtual(_)) => Ok(Some(virtual_stat(vp, name))),
            Ok(Node::Real { path, .. }) => match fs::metadata(&path) {
                Ok(m) => Ok(Some(stat_of(vp, name, &m))),
                Err(e) if is_missing(&e) => Ok(None),
                Err(e) => Err(e.into()),
            },
        }
    }

    /// Direct children, unsorted (the shell sorts). Skips anything that must not be visible:
    /// our temp files, names that cannot be stored on every OS, and symlinks that leave the
    /// root or dangle.
    pub fn list(&self, vpath: &str) -> Result<Vec<FsStat>, FsError> {
        let (vp, _) = vstring(vpath)?;
        let (root, path) = match self.resolve(vpath)? {
            Node::Virtual(kids) => {
                return Ok(kids
                    .iter()
                    .map(|k| virtual_stat(join_v(&vp, k), (*k).to_string()))
                    .collect());
            }
            Node::Real { root, path, .. } => (root, path),
        };
        let meta = fs::metadata(&path).map_err(|e| missing(e, "directory", &vp))?;
        if !meta.is_dir() {
            return Err(FsError::new("EINVAL", format!("not a directory: {vp}")));
        }
        let mut out = Vec::new();
        for entry in fs::read_dir(&path).map_err(|e| missing(e, "directory", &vp))? {
            let Ok(entry) = entry else { continue };
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if check_segment(&name).is_err() {
                continue;
            }
            let Ok(real) = entry.path().canonicalize() else {
                continue;
            };
            if !real.starts_with(&root) {
                continue;
            }
            let Ok(m) = fs::metadata(&real) else { continue };
            out.push(stat_of(join_v(&vp, &name), name, &m));
        }
        Ok(out)
    }

    pub fn read(&self, vpath: &str) -> Result<Vec<u8>, FsError> {
        let (vp, _) = vstring(vpath)?;
        let Node::Real { path, .. } = self.resolve(vpath)? else {
            return Err(FsError::new("EINVAL", format!("is a directory: {vp}")));
        };
        let meta = fs::metadata(&path).map_err(|e| missing(e, "file", &vp))?;
        if meta.is_dir() {
            return Err(FsError::new("EINVAL", format!("is a directory: {vp}")));
        }
        fs::read(&path).map_err(|e| missing(e, "file", &vp))
    }

    /// Atomically replaces (or creates) a file. The parent folder must already exist.
    pub fn write(&self, vpath: &str, data: &[u8]) -> Result<(), FsError> {
        let (vp, _) = vstring(vpath)?;
        let cannot = || FsError::new("EINVAL", format!("cannot write to {vp}"));
        let Node::Real { path, is_root, .. } = self.resolve(vpath)? else {
            return Err(cannot());
        };
        if is_root {
            return Err(cannot());
        }
        let parent = path.parent().ok_or_else(cannot)?;
        match fs::metadata(parent) {
            Ok(m) if m.is_dir() => {}
            Ok(_) => {
                return Err(FsError::new(
                    "EINVAL",
                    format!("not a directory: {}", parent_v(&vp)),
                ))
            }
            Err(e) => return Err(missing(e, "directory", &parent_v(&vp))),
        }
        let is_a_folder = || FsError::new("EINVAL", format!("is a directory: {vp}"));
        let target = match fs::symlink_metadata(&path) {
            // Write through a link like an editor would. `resolve` already proved the link
            // stays inside the root, so its canonical target does too.
            Ok(m) if m.is_symlink() => {
                let real = path.canonicalize()?;
                if fs::metadata(&real)?.is_dir() {
                    return Err(is_a_folder());
                }
                real
            }
            Ok(m) if m.is_dir() => return Err(is_a_folder()),
            Ok(_) => path,
            Err(e) if is_missing(&e) => path,
            Err(e) => return Err(e.into()),
        };
        atomic_write(&target, data)
    }

    /// Creates the folder and any missing parents. Already being a folder is fine; a file
    /// anywhere along the way is `EEXIST`.
    pub fn mkdir(&self, vpath: &str) -> Result<(), FsError> {
        let (vp, _) = vstring(vpath)?;
        let Node::Real { root, path, .. } = self.resolve(vpath)? else {
            return Ok(()); // virtual folders always exist
        };
        let mut chain: Vec<&Path> = path
            .ancestors()
            .take_while(|a| a.starts_with(&root))
            .collect();
        chain.reverse();
        for dir in chain {
            match fs::metadata(dir) {
                Ok(m) if m.is_dir() => {}
                Ok(_) => return Err(FsError::new("EEXIST", format!("not a directory: {vp}"))),
                Err(e) if e.kind() == ErrorKind::NotFound => match fs::create_dir(dir) {
                    Ok(()) => {}
                    // Lost a race with another creator: fine if it is now a folder.
                    Err(e) if e.kind() == ErrorKind::AlreadyExists && dir.is_dir() => {}
                    Err(e) => return Err(e.into()),
                },
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    /// Removes a file or a whole folder tree. A symlink is removed itself, never followed.
    pub fn remove(&self, vpath: &str) -> Result<(), FsError> {
        let (vp, _) = vstring(vpath)?;
        let cannot = || FsError::new("EINVAL", format!("cannot remove {vp}"));
        let Node::Real { path, .. } = self.resolve(vpath)? else {
            return Err(cannot());
        };
        if vp == "/home/user" {
            return Err(cannot());
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| missing(e, "path", &vp))?;
        if meta.is_symlink() {
            // Windows needs remove_dir for a link to a folder.
            fs::remove_file(&path).or_else(|_| fs::remove_dir(&path))?;
        } else if meta.is_dir() {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// Moves a file or folder. Never replaces an existing target (`EEXIST`), except to change
    /// only the letter case of a name on a case-insensitive filesystem.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), FsError> {
        let (fv, _) = vstring(from)?;
        let (tv, _) = vstring(to)?;
        let cannot = || FsError::new("EINVAL", format!("cannot rename {fv} to {tv}"));
        let (
            Node::Real {
                path: src,
                is_root: src_root,
                ..
            },
            Node::Real {
                path: dst,
                is_root: dst_root,
                ..
            },
        ) = (self.resolve(from)?, self.resolve(to)?)
        else {
            return Err(cannot());
        };
        if src_root || dst_root {
            return Err(cannot());
        }
        if fv == tv {
            return Err(FsError::new("EEXIST", format!("already exists: {tv}")));
        }
        if tv.starts_with(&format!("{fv}/")) {
            return Err(FsError::new(
                "EINVAL",
                format!("cannot move {fv} into itself"),
            ));
        }
        fs::symlink_metadata(&src).map_err(|e| missing(e, "path", &fv))?;
        match fs::symlink_metadata(&dst) {
            Ok(_) => {
                let same_file =
                    matches!((src.canonicalize(), dst.canonicalize()), (Ok(a), Ok(b)) if a == b);
                if !(fv.to_lowercase() == tv.to_lowercase() && same_file) {
                    return Err(FsError::new("EEXIST", format!("already exists: {tv}")));
                }
            }
            Err(e) if is_missing(&e) => {}
            Err(e) => return Err(e.into()),
        }
        let parent = dst.parent().ok_or_else(cannot)?;
        match fs::metadata(parent) {
            Ok(m) if m.is_dir() => {}
            Ok(_) => {
                return Err(FsError::new(
                    "EINVAL",
                    format!("not a directory: {}", parent_v(&tv)),
                ))
            }
            Err(e) => return Err(missing(e, "directory", &parent_v(&tv))),
        }
        fs::rename(&src, &dst).map_err(|e| {
            if e.kind() == ErrorKind::CrossesDevices {
                FsError::new("EINVAL", "cannot move between drives")
            } else {
                e.into()
            }
        })
    }
}
