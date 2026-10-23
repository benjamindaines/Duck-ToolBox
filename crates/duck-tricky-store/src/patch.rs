//! Previewable patch-level updates owned by the keystore configuration adapters.
use crate::{
    model::{Backend, Policy},
    service::active_adapter,
};
use anyhow::{Context as _, Result, bail};
use duck_core::{
    Context,
    fs::{write_bytes_preserving, write_string_atomic},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs};

#[derive(Deserialize)]
pub struct Request {
    #[serde(default)]
    pub patch: String,
    #[serde(default)]
    pub revision: String,
    #[serde(default)]
    pub backup: String,
}
type Snapshot = BTreeMap<String, Option<String>>;
#[derive(Serialize, Deserialize)]
struct Backup {
    backend: Backend,
    before: Snapshot,
    applied_revision: String,
}
fn names(backend: Backend) -> &'static [&'static str] {
    match backend {
        Backend::TrickyStore => &["config.ini"],
        Backend::TrickyStoreLegacy => &["target.txt", "security_patch.txt"],
        Backend::TeeSimulator => &["config.json"],
        Backend::OhMyKeymint => &["injector.toml", "config.toml"],
    }
}
fn snapshot(ctx: &Context, dir: &str, backend: Backend) -> Result<Snapshot> {
    names(backend)
        .iter()
        .map(|name| {
            let path = ctx.sysroot.path(format!("{dir}/{name}"));
            if path.metadata().is_ok_and(|m| m.len() > 1024 * 1024) {
                bail!("configuration too large: {}", path.display());
            }
            Ok(((*name).into(), duck_core::fs::read_optional(&path)?))
        })
        .collect()
}
fn revision(snapshot: &Snapshot) -> Result<String> {
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(snapshot)?)))
}
fn restore_files(ctx: &Context, dir: &str, snapshot: &Snapshot) -> Result<()> {
    let mut failed = Vec::new();
    for (name, content) in snapshot {
        let path = ctx.sysroot.path(format!("{dir}/{name}"));
        let result = if let Some(content) = content {
            write_bytes_preserving(&path, content.as_bytes())
        } else if path.exists() {
            fs::remove_file(&path).map_err(Into::into)
        } else {
            Ok(())
        };
        if let Err(error) = result {
            failed.push(format!("{}: {error:#}", path.display()));
        }
    }
    if !failed.is_empty() {
        bail!("restore failed: {}", failed.join("; "));
    }
    Ok(())
}
fn proposed(backend: Backend, patch: &str) -> Result<Policy> {
    let valid = patch.len() == 10
        && patch.as_bytes()[4] == b'-'
        && patch.as_bytes()[7] == b'-'
        && patch
            .chars()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if !valid {
        bail!("expected security patch YYYY-MM-DD");
    }
    let date = time::Date::from_calendar_date(
        patch[..4].parse()?,
        time::Month::try_from(patch[5..7].parse::<u8>()?)?,
        patch[8..].parse()?,
    )
    .context("invalid security patch date")?;
    let _ = date;
    let compact = patch.replace('-', "");
    Ok(match backend {
        Backend::TrickyStore | Backend::TrickyStoreLegacy => [
            ("os_patch", compact[..6].into()),
            ("vendor_patch", compact.clone()),
            ("boot_patch", compact),
        ]
        .into_iter()
        .map(|(k, v)| (k.into(), v))
        .collect(),
        Backend::TeeSimulator => ["os_patch", "vendor_patch", "boot_patch"]
            .into_iter()
            .map(|k| (k.into(), patch.into()))
            .collect(),
        Backend::OhMyKeymint => [
            "security_patch",
            "os_patchlevel",
            "vendor_patchlevel",
            "boot_patchlevel",
        ]
        .into_iter()
        .map(|k| (k.into(), patch.into()))
        .collect(),
    })
}
pub fn preview(ctx: &Context, request: &Request) -> Result<Value> {
    let (detection, adapter) = active_adapter(&ctx.sysroot)?;
    let before = adapter.read(&ctx.sysroot)?;
    let values = proposed(detection.backend, &request.patch)?;
    let mut candidate = before.default_policy.clone();
    candidate.extend(values.clone());
    crate::policy::sanitize(&adapter.policy_schema(), candidate)?;
    let changes: Vec<_> = values
        .iter()
        .filter(|(k, v)| before.default_policy.get(*k) != Some(*v))
        .map(|(k, v)| json!({"key":k,"before":before.default_policy.get(k),"after":v}))
        .collect();
    Ok(
        json!({"backend":detection.backend,"patch":request.patch,"revision":revision(&snapshot(ctx,adapter.config_dir(),detection.backend)?)?,"changes":changes}),
    )
}
pub fn apply(ctx: &Context, request: &Request) -> Result<Value> {
    let (detection, adapter) = active_adapter(&ctx.sysroot)?;
    let before = snapshot(ctx, adapter.config_dir(), detection.backend)?;
    if revision(&before)? != request.revision {
        bail!("keystore configuration changed; preview again");
    }
    let mut config = adapter.read(&ctx.sysroot)?;
    let changes = proposed(detection.backend, &request.patch)?;
    let restart = adapter.restart_keys().iter().any(|key| {
        changes
            .get(*key)
            .is_some_and(|value| config.default_policy.get(*key) != Some(value))
    });
    config.default_policy.extend(changes);
    config.default_policy =
        crate::policy::sanitize(&adapter.policy_schema(), config.default_policy)?;
    let token = hex::encode(Sha256::digest(format!(
        "{}:{}:{}",
        request.revision,
        request.patch,
        duck_core::unix_now()
    )));
    let backup_path = ctx
        .paths
        .var_dir
        .join("tricky-store/patch-backups")
        .join(format!("{token}.json"));
    let mut backup = Backup {
        backend: detection.backend,
        before: before.clone(),
        applied_revision: String::new(),
    };
    private_backup(&backup_path, &backup)?;
    transaction(ctx, adapter.config_dir(), &before, &backup_path, || {
        adapter.write(&ctx.sysroot, &config)?;
        backup.applied_revision =
            revision(&snapshot(ctx, adapter.config_dir(), detection.backend)?)?;
        private_backup(&backup_path, &backup)
    })?;
    Ok(json!({"backup":token,"restart_required":restart}))
}
fn transaction<T>(
    ctx: &Context,
    dir: &str,
    before: &Snapshot,
    backup_path: &std::path::Path,
    publish: impl FnOnce() -> Result<T>,
) -> Result<T> {
    match publish() {
        Ok(value) => Ok(value),
        Err(error) => {
            if let Err(recovery) = restore_files(ctx, dir, before) {
                bail!("{error:#}; {recovery:#}; backup: {}", backup_path.display());
            }
            Err(error.context(format!(
                "original configuration restored; backup: {}",
                backup_path.display()
            )))
        }
    }
}
fn private_backup(path: &std::path::Path, backup: &Backup) -> Result<()> {
    write_string_atomic(path, &serde_json::to_string(backup)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}
pub fn restore(ctx: &Context, request: &Request) -> Result<Value> {
    if request.backup.len() != 64 || !request.backup.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("invalid backup token");
    }
    let path = ctx
        .paths
        .var_dir
        .join("tricky-store/patch-backups")
        .join(format!("{}.json", request.backup));
    let backup: Backup = serde_json::from_str(&fs::read_to_string(&path)?)?;
    let (detection, adapter) = active_adapter(&ctx.sysroot)?;
    if detection.backend != backup.backend
        || revision(&snapshot(ctx, adapter.config_dir(), detection.backend)?)?
            != backup.applied_revision
    {
        bail!(
            "keystore changed after apply; restore refused; backup: {}",
            path.display()
        );
    }
    restore_files(ctx, adapter.config_dir(), &backup.before)
        .with_context(|| format!("backup: {}", path.display()))?;
    Ok(json!({"restored":true,"restart_required":false}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mappings_are_backend_specific() {
        let date = "2026-10-05";
        assert_eq!(
            proposed(Backend::TrickyStore, date).unwrap()["os_patch"],
            "202610"
        );
        assert_eq!(
            proposed(Backend::TrickyStoreLegacy, date).unwrap()["boot_patch"],
            "20261005"
        );
        assert_eq!(
            proposed(Backend::TeeSimulator, date).unwrap()["os_patch"],
            date
        );
        assert_eq!(
            proposed(Backend::OhMyKeymint, date).unwrap()["security_patch"],
            date
        );
        assert!(proposed(Backend::TrickyStore, "2026-02-31").is_err());
    }
    #[test]
    fn readback_failure_restores_the_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let ctx = Context {
            paths: duck_core::AppPaths::for_root(root.path(), &root.path().join("runtime")),
            sysroot: duck_core::Sysroot::new(root.path()),
        };
        let dir = "/data/adb/tricky_store";
        let path = ctx.sysroot.path(format!("{dir}/config.ini"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "original\n").unwrap();
        let before = snapshot(&ctx, dir, Backend::TrickyStore).unwrap();
        let result: Result<()> =
            transaction(&ctx, dir, &before, &root.path().join("backup.json"), || {
                fs::write(&path, vec![b'x'; 1024 * 1024 + 1])?;
                snapshot(&ctx, dir, Backend::TrickyStore)?;
                Ok(())
            });
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("original configuration restored")
        );
        assert_eq!(fs::read_to_string(path).unwrap(), "original\n");
    }
}
