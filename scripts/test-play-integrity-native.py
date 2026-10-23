#!/usr/bin/env python3
"""Run the engine's native protocol tests without Android or the toolbox runtime."""
from pathlib import Path
import os
import subprocess
import tempfile

SCRIPT_DIR = Path(__file__).resolve().parent
STANDALONE = (SCRIPT_DIR / "android").is_dir()
ROOT = SCRIPT_DIR if STANDALONE else SCRIPT_DIR.parent
ENGINE = ROOT if STANDALONE else ROOT / "components/play-integrity"
SOURCE = ENGINE / "android/app/src/main/cpp"
VENDOR = ENGINE / "vendor" if STANDALONE else ROOT / "target/play-integrity/vendor"
TARGET = ROOT / "target/play-integrity/native-tests"
TARGET.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="pif-native-fixture-") as fixture:
    root=Path(fixture)
    subprocess.run([
        os.environ.get("CXX", "c++"), "-std=c++23", "-pthread",
        "-I", str(SOURCE), "-I", str(VENDOR),
        f'-DPIF_TEST_ROOT="{root}"',
        f'-DPIF_DATA_DIR="{root / "data"}"',
        f'-DPIF_MODULE_DIR="{root / "module/play-integrity"}"',
        str(ENGINE / "tests/native.cpp"), str(SOURCE / "config.cpp"),
        str(SOURCE / "companion.cpp"), "-o", str(TARGET),
    ], check=True)
    subprocess.run([str(TARGET)], check=True)
