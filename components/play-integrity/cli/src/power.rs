// SPDX-License-Identifier: GPL-3.0-only
// Modified 2026-10-24: independent stop gate, readable without valid fingerprint configuration.
use crate::{Engine, files};
pub fn gated(engine: &Engine) -> bool {
    if !engine.data.join("disabled").exists() {
        return false;
    }
    let stopped = files::read(&engine.data.join("disabled"));
    let acknowledged = files::read(&engine.data.join("enabled-token"));
    match (stopped, acknowledged) {
        (Ok(a), Ok(b)) => {
            !engine.data.join("enabled-token").exists() || a.len() > 128 || b.len() > 128 || a != b
        }
        _ => true,
    }
}
pub fn disabled(engine: &Engine) -> bool {
    if gated(engine) {
        return true;
    }
    match files::json_file(&engine.data.join("options.json")) {
        Ok(value) if value.is_object() => value.get("enabled").is_some_and(|v| v != true),
        _ => true,
    }
}
