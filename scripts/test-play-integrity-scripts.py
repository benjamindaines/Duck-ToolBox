#!/usr/bin/env python3
"""Verify restoration quoting and OEM boot ordering with isolated command doubles."""
import os
from pathlib import Path
import subprocess
import tempfile

SCRIPT_DIR = Path(__file__).resolve().parent
ENGINE = SCRIPT_DIR if (SCRIPT_DIR / "android").is_dir() else SCRIPT_DIR.parent / "components/play-integrity"
SCRIPTS = ENGINE / "scripts"


def run(script, root, **environment):
    subprocess.run(["sh", "-c", script], check=True, env={
        **os.environ, "PIF_ENGINE_DATA": str(root), "PIF_ENGINE_SCRIPTS": str(SCRIPTS),
        "PIF_ENGINE_ROOT": str(root / "module"), **environment,
    })


with tempfile.TemporaryDirectory(prefix="pif-shell-test-") as directory:
    root = Path(directory)
    payload = "a'\"$(touch " + str(root / "must-not-exist") + ")`id`\\tail"
    run('''
getprop() { printf '1'; }
resetprop() {
  if [ "$#" = 0 ]; then printf '[persist.test]: [%s]\\n' "$TEST_VALUE";
  elif [ "$#" = 1 ]; then printf '%s' "$TEST_VALUE";
  fi
}
. "$PIF_ENGINE_SCRIPTS/common_func.sh"
persistprop persist.test replacement
resetprop() { printf '%s' "$4" > "$PIF_ENGINE_DATA/restored"; }
. "$PIF_ENGINE_DATA/uninstall.sh"
''', root, TEST_VALUE=payload)
    assert (root / "restored").read_text() == payload
    assert not (root / "must-not-exist").exists()
    (root / "uninstall.sh").unlink()
    (root / "uninstall.sh").write_text('false\nprintf unexpected > "$PIF_ENGINE_DATA/continued"\n')
    recovery = subprocess.run(["sh", str(SCRIPTS / "stage.sh"), "cleanup"], env={
        **os.environ, "PIF_ENGINE_DATA": str(root), "PIF_ENGINE_SCRIPTS": str(SCRIPTS),
        "PIF_ENGINE_ROOT": str(root / "module"), "PIF_ENGINE_MODE": "full",
    }, capture_output=True)
    assert recovery.returncode != 0
    assert (root / "uninstall.sh").exists()
    assert not (root / "continued").exists()
    (root / "uninstall.sh").unlink()

    for mode in ["full", "scripts-only"]:
        (root / "skippersistprop").touch()
        (root / "custom.app_replace_list.txt").write_text("")
        run('''
getprop() { printf '1'; }
magisk() { printf 'magisk %s\\n' "$*" >> "$PIF_ENGINE_DATA/order"; return 0; }
resetprop() {
  if [ "$#" = 1 ]; then printf 'original';
  else printf 'resetprop %s\\n' "$*" >> "$PIF_ENGINE_DATA/order";
  fi
}
toybox() { printf '1'; }
ui_print() { :; }
KSU=false APATCH=false
. "$PIF_ENGINE_SCRIPTS/post-fs-data.sh"
printf 'late\\n' >> "$PIF_ENGINE_DATA/order"
. "$PIF_ENGINE_SCRIPTS/service.sh"
''', root, PIF_ENGINE_MODE=mode)
        lines = (root / "order").read_text().splitlines()
        late = lines.index("late")
        assert any("ro.debuggable" in item for item in lines[:late])
        assert not any("ro.boot.verifiedbootstate" in item for item in lines[:late])
        assert any("ro.boot.verifiedbootstate" in item for item in lines[late:])
        expected = "rm" if mode == "full" else "add"
        assert any(f"magisk --denylist {expected} com.google.android.gms" in item for item in lines)
        (root / "order").unlink()

print("Shell restoration, DenyList modes and OEM ordering passed")
