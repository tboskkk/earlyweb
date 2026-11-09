use serde::Serialize;
use std::fmt;
use std::io;

/// An error as the shell sees it: one of the protocol's error codes plus a message.
/// Serializes to `{"code": "...", "message": "..."}`, which `toEwError` in
/// `packages/backends` turns back into an `EwError`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FsError {
    /// One of `EPERM ENOENT EEXIST EINVAL EQUOTA`.
    pub code: &'static str,
    pub message: String,
}

impl FsError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        FsError {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for FsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for FsError {}

impl From<io::Error> for FsError {
    fn from(e: io::Error) -> Self {
        let code = match e.kind() {
            io::ErrorKind::NotFound => "ENOENT",
            io::ErrorKind::AlreadyExists => "EEXIST",
            io::ErrorKind::PermissionDenied => "EPERM",
            io::ErrorKind::StorageFull => "EQUOTA",
            _ => "EINVAL",
        };
        FsError::new(code, e.to_string())
    }
}
