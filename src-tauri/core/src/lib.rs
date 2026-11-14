//! EarlyWeb core: the virtual-path jail, file operations, key-value store, CSP and the
//! `ewapp://` request handler. Deliberately free of Tauri so it builds and tests anywhere.

pub mod csp;
pub mod error;
pub mod kv;
pub mod manifest;
pub mod ops;
pub mod protocol;
pub mod vfs;

pub use error::FsError;
pub use kv::Kv;
pub use ops::FsStat;
pub use vfs::{Node, Vfs};
