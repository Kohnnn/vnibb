"""Check the credential-free API install against the actual package indexes."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
CONSTRAINTS = ROOT / "apps/api/constraints-vnstock.txt"
VENDOR_WHEELS = {
    "vnstock": (
        "4.0.9",
        "b51358c58c1fd9a299379f2d49b5c29e692fbae49e75f2ebc7cbfcc1cb996e64",
    ),
    "vnai": (
        "2.6.2",
        "5b2852157031322f817ac9a306d67fbf138ec824292eaeb0b75e4e884f093081",
    ),
}


@pytest.mark.parametrize("extras", ["", "[dev]"])
def test_api_install_resolves_publisher_wheels_without_credentials(tmp_path, extras):
    report = tmp_path / "install-report.json"
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--isolated",
        "--dry-run",
        "--ignore-installed",
        "--only-binary=:all:",
        "--report",
        str(report),
        "--index-url",
        "https://pypi.org/simple",
    ]
    command.extend(["--constraint", str(CONSTRAINTS)])
    command.append(f"{ROOT / 'apps/api'}{extras}")
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("PIP_", "VNSTOCK_"))
    }
    environment["PIP_CONFIG_FILE"] = os.devnull
    result = subprocess.run(command, capture_output=True, text=True, env=environment, timeout=180)
    assert result.returncode == 0, result.stderr[-3000:]

    installed = {
        item["metadata"]["name"].lower().replace("-", "_"): item
        for item in json.loads(report.read_text())["install"]
    }
    for name, (version, sha256) in VENDOR_WHEELS.items():
        package = installed[name]
        assert package["metadata"]["version"] == version
        assert package["download_info"]["url"].startswith(
            f"https://vnstocks.com/api/packages/files/{name}/{version}/"
        )
        assert package["download_info"]["archive_info"]["hashes"]["sha256"] == sha256
