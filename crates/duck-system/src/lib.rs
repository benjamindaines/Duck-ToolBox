//! Module lifecycle features Tricky Addon shipped for itself, generalised to the whole
//! toolbox: a device/system summary, uninstalling, rebooting and opening links outside
//! the WebView.

mod artifacts;
mod cli;
mod error;
mod files;
mod info;
pub use cli::{Command, FEATURE, run};
pub use error::SystemError;
pub use info::{ModuleIdentity, SystemInfo};
