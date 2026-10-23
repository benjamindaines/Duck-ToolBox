// SPDX-License-Identifier: GPL-3.0-only
// Modified 2026-10-23: private atomic storage and guarded recovery.
use anyhow::{Result, bail};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

#[derive(Debug)]
pub struct RecoveryError(pub Value);
impl std::fmt::Display for RecoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "configuration recovery failed: {}", self.0)
    }
}
impl std::error::Error for RecoveryError {}

pub fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn read(path: &Path) -> Result<String> {
    use std::io::Read;
    if !path.exists() {
        return Ok(String::new());
    }
    let mut value = String::new();
    fs::File::open(path)?
        .take(128 * 1024 + 1)
        .read_to_string(&mut value)?;
    if value.len() > 128 * 1024 {
        bail!("file exceeds 128 KiB: {}", path.display());
    }
    Ok(value)
}
pub fn private_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
pub fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(|| anyhow::anyhow!("no parent"))?;
    private_dir(parent)?;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, path)?;
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
pub fn write_json(path: &Path, value: &Value) -> Result<()> {
    atomic(path, &serde_json::to_vec_pretty(value)?)
}
pub fn json_file(path: &Path) -> Result<Value> {
    let raw = read(path)?;
    Ok(if raw.is_empty() {
        json!({})
    } else {
        serde_json::from_str(&raw)?
    })
}
pub struct Lock {
    _file: fs::File,
}
impl Lock {
    pub fn acquire(data: &Path) -> Result<Self> {
        private_dir(data)?;
        let path = data.join("write.lock");
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(path)?;
        file.try_lock()
            .map_err(|error| anyhow::anyhow!("engine is busy: {error}"))?;
        Ok(Self { _file: file })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_private_and_bounded() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("config");
        atomic(&path, b"old").unwrap();
        atomic(&path, b"new").unwrap();
        assert_eq!(read(&path).unwrap(), "new");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::write(&path, vec![b'x'; 128 * 1024 + 1]).unwrap();
        assert!(read(&path).is_err());
        let lock = Lock::acquire(root.path()).unwrap();
        assert!(Lock::acquire(root.path()).is_err());
        drop(lock);
        assert!(Lock::acquire(root.path()).is_ok());
    }
}
