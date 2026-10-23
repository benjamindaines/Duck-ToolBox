// SPDX-License-Identifier: GPL-3.0-only
// Modified 2026-10-24: standalone engine operations; no toolbox runtime dependency.
use crate::{Engine, config, files, tasks, text};
use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::{fs, process::Command};

pub const UPSTREAM: &str = "23ec56c2440c4fd1a5e893a23ef7861d6366a828";
pub fn options(engine: &Engine) -> Result<Value> {
    let mut result = json!({"enabled":true,"mode":"full","skipdelprop":false,"skippersistprop":false,"skipmatchdevice":false});
    let stored = files::json_file(&engine.data.join("options.json"))?;
    if !stored.is_object() {
        bail!("options.json must be an object");
    }
    for key in [
        "enabled",
        "mode",
        "skipdelprop",
        "skippersistprop",
        "skipmatchdevice",
    ] {
        if let Some(value) = stored.get(key) {
            result[key] = value.clone();
        }
    }
    for key in [
        "enabled",
        "skipdelprop",
        "skippersistprop",
        "skipmatchdevice",
    ] {
        if !result[key].is_boolean() {
            bail!("options.json: {key} must be a boolean");
        }
    }
    if result["mode"] != "full" && result["mode"] != "scripts-only" {
        bail!("options.json: invalid mode");
    }
    Ok(result)
}
pub fn conflicts(engine: &Engine) -> Vec<String> {
    ["playintegrityfix", "safetynet-fix"]
        .into_iter()
        .filter(|id| {
            let path = engine.device(&format!("/data/adb/modules/{id}"));
            path.join("module.prop").exists()
                && !path.join("disable").exists()
                && !path.join("remove").exists()
        })
        .map(str::to_owned)
        .collect()
}
pub fn run(engine: &Engine, operation: &str, input: Value) -> Result<Value> {
    match operation {
        "status" => status(engine),
        "config" => config::current(engine),
        "preview" => config::preview(engine, &input),
        "import-preview" => {
            let source = text(&input, "source")?;
            if !source.starts_with('/') || source.contains('\0') {
                bail!("expected absolute device file path");
            }
            let content = files::read(&engine.device(source))?;
            if content.is_empty() {
                bail!("source file is empty or missing");
            }
            config::preview(
                engine,
                &json!({"content":content,"format":"auto","migrate":true,"advanced":true}),
            )
        }
        "apply" => apply(engine, &input),
        "restore" => restore(engine, &input),
        "options" => save_options(engine, &input),
        "task-start" => tasks::start(engine, &input),
        "task-status" => tasks::status(engine, text(&input, "id")?),
        "task-cancel" => tasks::cancel(engine, text(&input, "id")?),
        "restart" => restart(engine),
        "diagnose" => {
            let output = if engine.sysroot == std::path::Path::new("/") {
                Command::new("logcat")
                    .args([
                        "-d",
                        "-t",
                        "400",
                        "-s",
                        "PIF/Native",
                        "PIF/Java:DG",
                        "PIF/Java:PS",
                    ])
                    .output()
                    .ok()
                    .map(|o| {
                        String::from_utf8_lossy(&o.stdout)
                            .chars()
                            .take(65536)
                            .collect::<String>()
                    })
                    .unwrap_or_default()
            } else {
                String::new()
            };
            Ok(json!({"status":status(engine)?,"log":output,"verdict_verified":false}))
        }
        _ => bail!("unknown operation: {operation}"),
    }
}
fn compatibility(engine: &Engine) -> Result<Value> {
    let list = if engine.data.join("custom.app_replace_list.txt").exists() {
        files::read(&engine.data.join("custom.app_replace_list.txt"))?
    } else {
        files::read(&engine.module.join("scripts/app_replace_list.txt"))?
    };
    Ok(
        json!({"replacement_hash":files::hash(list.as_bytes()),"prop_handler_enabled":!engine.device("/data/adb/disable_prop_handler").exists()}),
    )
}
pub fn status(engine: &Engine) -> Result<Value> {
    let opts = options(engine)?;
    let conflict = conflicts(engine);
    let config = config::current(engine)?;
    let has_config = config["entries"].as_object().is_some_and(|m| !m.is_empty());
    let boot = files::read(&engine.device("/proc/sys/kernel/random/boot_id"))?
        .trim()
        .to_owned();
    let loaded = files::json_file(&engine.data.join("boot.json"))?;
    let evidence = files::json_file(&engine.data.join("attachment.json"))?;
    // Magisk's installation directory proves neither the setting nor a loaded
    // Zygisk runtime. Its boot-script environment is supplied by the daemon.
    let magisk_runtime = std::env::var("ZYGISK_ENABLED").as_deref() == Ok("1")
        || (!boot.is_empty() && loaded["boot_id"] == boot && loaded["zygisk_enabled"] == true);
    let zygisk = ["zygisksu", "rezygisk", "neozygisk"].iter().any(|id| {
        let path = engine.device(&format!("/data/adb/modules/{id}"));
        path.join("module.prop").exists()
            && !path.join("disable").exists()
            && !path.join("remove").exists()
    }) || magisk_runtime;
    let reboot = loaded["boot_id"] != boot
        || loaded["options"] != opts
        || loaded["compatibility"] != compatibility(engine)?;
    Ok(
        json!({"api":1,"upstream_revision":UPSTREAM,"options":opts,"has_config":has_config,"zygisk_detected":zygisk,
        "conflicts":conflict,"reboot_required":reboot,"attachment":evidence,"boot":loaded,
        "state":if !opts["enabled"].as_bool().unwrap_or(true){"disabled"}else if !conflict.is_empty(){"conflict"}else if opts["mode"]=="scripts-only"{"scripts-only"}else if !zygisk{"zygisk-unconfirmed"}else if !has_config{"configuration-required"}else{"configured"},
        "app_replace_list":if engine.data.join("custom.app_replace_list.txt").exists(){files::read(&engine.data.join("custom.app_replace_list.txt"))?}else{files::read(&engine.module.join("scripts/app_replace_list.txt"))?},"data_dir":engine.data,"source":"webroot/licenses/play-integrity-source.tar.gz","license":"licenses/play-integrity/GPL-3.0.txt","verdict_verified":false}),
    )
}
fn apply(engine: &Engine, input: &Value) -> Result<Value> {
    let _lock = files::Lock::acquire(&engine.data)?;
    let preview = config::preview(engine, input)?;
    if input["revision"] != preview["revision"] {
        bail!("configuration changed; preview again");
    }
    let path = engine.data.join("custom.pif.json");
    let old = files::read(&path)?;
    let new = text(&preview, "json")?;
    let token = files::hash(format!("{old}\0{new}").as_bytes());
    let backup = engine.data.join("backups").join(format!("{token}.json"));
    files::write_json(
        &backup,
        &json!({"content":old,"applied_hash":files::hash(new.as_bytes())}),
    )?;
    let publication = (|| -> Result<Value> {
        files::atomic(&path, new.as_bytes())?;
        let saved = config::current(engine)?;
        if saved["revision"] != files::hash(new.as_bytes()) {
            bail!("configuration readback failed");
        }
        Ok(saved)
    })();
    match publication {
        Ok(saved) => Ok(json!({"config":saved,"backup":token,"restart_required":true})),
        Err(error) => {
            if let Err(recovery) = files::atomic(&path, old.as_bytes()) {
                return Err(files::RecoveryError(json!({"path":path,"backup_path":backup,"apply_error":format!("{error:#}"),"restore_error":format!("{recovery:#}")})).into());
            }
            Err(error.context("publication failed; original configuration restored"))
        }
    }
}
fn restore(engine: &Engine, input: &Value) -> Result<Value> {
    let _lock = files::Lock::acquire(&engine.data)?;
    let token = text(input, "backup")?;
    if token.len() != 64 || !token.bytes().all(|c| c.is_ascii_hexdigit()) {
        bail!("invalid backup token");
    }
    let backup = engine.data.join("backups").join(format!("{token}.json"));
    let saved = files::json_file(&backup)?;
    let path = engine.data.join("custom.pif.json");
    if saved["applied_hash"] != files::hash(files::read(&path)?.as_bytes()) {
        bail!("configuration changed after apply; restore refused");
    }
    files::atomic(&path, text(&saved, "content")?.as_bytes()).map_err(|e| {
        files::RecoveryError(json!({"path":path,"backup_path":backup,"reason":e.to_string()}))
    })?;
    Ok(json!({"config":config::current(engine)?,"restart_required":true}))
}
fn save_options(engine: &Engine, input: &Value) -> Result<Value> {
    let _lock = files::Lock::acquire(&engine.data)?;
    let mut opts = options(engine)?;
    for key in [
        "enabled",
        "skipdelprop",
        "skippersistprop",
        "skipmatchdevice",
    ] {
        if let Some(value) = input.get(key) {
            if !value.is_boolean() {
                bail!("{key}: expected boolean");
            }
            opts[key] = value.clone();
        }
    }
    if let Some(mode) = input.get("mode") {
        if mode != "full" && mode != "scripts-only" {
            bail!("unsupported mode");
        }
        opts["mode"] = mode.clone();
    }
    if let Some(list) = input.get("app_replace_list") {
        let list = list
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("app_replace_list must be text"))?;
        for line in list
            .lines()
            .map(str::trim)
            .filter(|s| !s.is_empty() && !s.starts_with('#'))
        {
            if !line.starts_with('/')
                || line.contains("..")
                || line.contains(char::is_whitespace)
                || line.contains(['\0', ';', '`', '$', '\\'])
            {
                bail!("invalid ROM replacement path: {line}");
            }
        }
        files::atomic(
            &engine.data.join("custom.app_replace_list.txt"),
            list.as_bytes(),
        )?;
    }
    files::write_json(&engine.data.join("options.json"), &opts)?;
    Ok(json!({"options":opts,"reboot_required":true}))
}
fn restart(engine: &Engine) -> Result<Value> {
    if engine.sysroot != std::path::Path::new("/") {
        bail!("process restart requires a live device");
    }
    let mut results = Vec::new();
    for process in ["com.google.android.gms.unstable", "com.android.vending"] {
        let output = Command::new("killall").arg(process).output()?;
        results.push(json!({"process":process,"exit_code":output.status.code(),"output":String::from_utf8_lossy(&output.stderr)}));
    }
    Ok(json!({"processes":results,"verdict_verified":false}))
}
pub fn stage(engine: &Engine, phase: &str) -> Result<Value> {
    if !["early", "late", "setup", "uninstall"].contains(&phase) {
        bail!("invalid lifecycle phase");
    }
    let opts = options(engine)?;
    let active = opts["enabled"].as_bool().unwrap_or(true) && conflicts(engine).is_empty();
    let script_phase = if phase == "early" && !active {
        "cleanup"
    } else {
        phase
    };
    if phase != "early" && phase != "uninstall" && !active {
        return Ok(json!({"skipped":true}));
    }
    if phase == "uninstall" {
        let job = files::json_file(&engine.data.join("active-job.json"))?;
        if let Some(id) = job["id"].as_str() {
            tasks::cancel(engine, id)?;
            let end = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while tasks::status(engine, id)?["state"] == "running" {
                if std::time::Instant::now() >= end {
                    bail!("generator did not stop; engine data retained");
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
    files::private_dir(&engine.data)?;
    for (key, file) in [
        ("skipdelprop", "skipdelprop"),
        ("skippersistprop", "skippersistprop"),
        ("skipmatchdevice", "skipmatchdevice"),
    ] {
        let path = engine.data.join(file);
        if opts[key] == true {
            files::atomic(&path, b"")?;
        } else if path.exists() {
            fs::remove_file(path)?;
        }
    }
    let ksu = engine.device("/data/adb/ksud").exists() || engine.device("/data/adb/ksu").exists();
    let apatch =
        !ksu && (engine.device("/data/adb/apd").exists() || engine.device("/data/adb/ap").exists());
    let output = engine
        .shell()
        .env("KSU", if ksu { "true" } else { "false" })
        .env("APATCH", if apatch { "true" } else { "false" })
        .arg(engine.module.join("scripts/stage.sh"))
        .arg(script_phase)
        .env("PIF_ENGINE_DATA", &engine.data)
        .env("PIF_ENGINE_SCRIPTS", engine.module.join("scripts"))
        .env(
            "PIF_ENGINE_ROOT",
            engine.module.parent().unwrap_or(&engine.module),
        )
        .env("PIF_ENGINE_MODE", opts["mode"].as_str().unwrap_or("full"))
        .stdin(std::process::Stdio::null())
        .output()?;
    if !output.status.success() {
        bail!(
            "stage {phase} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    if phase == "early" {
        files::write_json(
            &engine.data.join("boot.json"),
            &json!({"boot_id":files::read(&engine.device("/proc/sys/kernel/random/boot_id"))?.trim(),"options":opts,"compatibility":compatibility(engine)?,"zygisk_enabled":std::env::var("ZYGISK_ENABLED").as_deref()==Ok("1")}),
        )?;
    }
    Ok(json!({"stage":phase,"output":String::from_utf8_lossy(&output.stdout)}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preview_apply_stale_revision_and_restore() {
        let root = tempfile::tempdir().unwrap();
        let e = Engine {
            data: root.path().join("data"),
            module: root.path().join("module"),
            sysroot: root.path().join("sys"),
        };
        assert_eq!(options(&e).unwrap()["enabled"], true);
        let mut input = json!({"content":"MODEL=A\nCUSTOM=x","format":"prop"});
        let p = config::preview(&e, &input).unwrap();
        input["revision"] = p["revision"].clone();
        let applied = apply(&e, &input).unwrap();
        assert_eq!(config::current(&e).unwrap()["entries"]["MODEL"], "A");
        assert!(apply(&e, &input).is_err());
        restore(&e, &json!({"backup":applied["backup"]})).unwrap();
        assert_eq!(config::current(&e).unwrap()["entries"], json!({}));
        assert!(restore(&e, &json!({"backup":"../escape"})).is_err());
    }
}
