//! EarlyWeb core: the virtual-path jail, file operations, key-value store, CSP and the
//! `ewapp://` request handler. Deliberately free of Tauri so it builds and tests anywhere.

pub mod error;
pub mod vfs;

pub use error::FsError;
pub use vfs::{Node, Vfs};
