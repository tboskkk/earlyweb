//! A tiny key-value store for the shell's saved state (window session, app permissions).
//! Each key is one JSON file, `<dir>/<key>.json`, replaced atomically on every write. A file
//! that fails to parse reads as missing, so a torn or hand-edited file never stops boot.

use crate::error::FsError;
use crate::ops::atomic_write;
use crate::vfs::{check_segment, ensure_folder};
use serde_json::Value;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

const MAX_KEY_LEN: usize = 64;

#[derive(Debug, Clone)]
pub struct Kv {
    dir: PathBuf,
}

impl Kv {
    /// Creates `dir` if missing. A `dir` that exists as a plain file is an error.
    pub fn new(dir: PathBuf) -> Result<Kv, FsError> {
        ensure_folder(&dir)?;
        fs::create_dir_all(&dir)?;
        Ok(Kv {
            dir: dir.canonicalize()?,
        })
    }

    /// The stored value, or `None` if the key is unset or its file is not valid JSON.
    pub fn get(&self, key: &str) -> Result<Option<Value>, FsError> {
        let path = self.file(key)?;
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        match serde_json::from_slice(&bytes) {
            Ok(v) => Ok(Some(v)),
            Err(e) => {
                eprintln!("EarlyWeb: ignoring corrupt state {}: {e}", path.display());
                Ok(None)
            }
        }
    }

    pub fn set(&self, key: &str, value: &Value) -> Result<(), FsError> {
        let path = self.file(key)?;
        let bytes = serde_json::to_vec(value)
            .map_err(|e| FsError::new("EINVAL", format!("cannot encode {key}: {e}")))?;
        atomic_write(&path, &bytes)
    }

    /// Deleting a key that is not set is fine.
    pub fn delete(&self, key: &str) -> Result<(), FsError> {
        match fs::remove_file(self.file(key)?) {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    fn file(&self, key: &str) -> Result<PathBuf, FsError> {
        check_key(key)?;
        Ok(self.dir.join(format!("{key}.json")))
    }
}

/// Keys match `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$`, and `<key>.json` must also be a
/// portable file name (so `con` is refused: `con.json` can't exist on Windows).
fn check_key(key: &str) -> Result<(), FsError> {
    let ok_char = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-');
    let valid = !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && !key.starts_with('.')
        && key.chars().all(ok_char);
    if !valid {
        return Err(FsError::new(
            "EINVAL",
            format!("invalid state key: {key:?}"),
        ));
    }
    check_segment(&format!("{key}.json"))
        .map_err(|_| FsError::new("EINVAL", format!("invalid state key: {key:?}")))
}
