use thiserror::Error;

#[derive(Debug, Error)]
pub enum SystemError {
    #[error("no supported root manager (KernelSU, APatch or Magisk) was found")]
    NoRootManager,
    #[error("only http(s) links can be opened: {0}")]
    InvalidUrl(String),
}

/// Stable error codes for the WebUI.
pub fn code_of(error: &anyhow::Error) -> &'static str {
    match error.downcast_ref::<SystemError>() {
        Some(SystemError::NoRootManager) => "no_root_manager",
        Some(SystemError::InvalidUrl(_)) => "invalid_url",
        None => "internal_error",
    }
}
