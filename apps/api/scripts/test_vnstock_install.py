"""Check the platform wheel lock and credential-free package resolution."""

import json
import os
import platform
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest
from packaging.requirements import Requirement

ROOT = Path(__file__).resolve().parents[3]
CONSTRAINTS = ROOT / "apps/api/constraints-vnstock.txt"
SDK_VERSION = "5.2.1"
VENDOR_WHEELS = {
    ("linux", "x86_64"): (
        "manylinux_2_17_x86_64.manylinux2014_x86_64",
        "7ed7016a8aef823a20f4f8847196a4072cb97cb19801ce08a6981ac628200fc5",
    ),
    ("linux", "aarch64"): (
        "manylinux_2_17_aarch64.manylinux2014_aarch64",
        "12cbc32083cae37c9a3dd1a2b81a6d3bc507aee191525cd39e3c44b65ea2e90f",
    ),
    ("darwin", "x86_64"): (
        "macosx_10_12_x86_64",
        "a51da4a69aa54dc822f70d8517f55e46185b12658c2181c7819b1557f96d9b78",
    ),
    ("darwin", "arm64"): (
        "macosx_11_0_arm64",
        "fd1c348ee83cc9c96887d25bf9c4026d8f33afe24334d422fe9e4f910974e522",
    ),
    ("win32", "AMD64"): (
        "win_amd64",
        "dfc021041a87d86dbb161179e04f36bb9596355e37e3ba7816cb673054174539",
    ),
}


def test_api_and_provider_require_the_same_generation_five_sdk():
    for package in ("apps/api", "packages/providers"):
        project = tomllib.loads((ROOT / package / "pyproject.toml").read_text())["project"]
        dependencies = [Requirement(value) for value in project["dependencies"]]
        sdk = next(dependency for dependency in dependencies if dependency.name == "vnstock")
        assert str(sdk.specifier) == f"=={SDK_VERSION}"
        assert not {"vnai", "vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii"} & {
            dependency.name for dependency in dependencies
        }
        if package == "apps/api":
            pandas = next(dependency for dependency in dependencies if dependency.name == "pandas")
            assert str(pandas.specifier) == ">=2.0"


@pytest.mark.parametrize("target", VENDOR_WHEELS)
def test_wheel_lock_selects_one_hashed_publisher_wheel_per_platform(target):
    requirements = [
        Requirement(line)
        for line in CONSTRAINTS.read_text().splitlines()
        if line and not line.startswith("#")
    ]
    assert len(requirements) == len(VENDOR_WHEELS)
    assert {requirement.name for requirement in requirements} == {"vnstock"}
    target_os, machine = target
    selected = [
        requirement
        for requirement in requirements
        if requirement.marker.evaluate(
            {"sys_platform": target_os, "platform_machine": machine, "implementation_name": "cpython"}
        )
    ]
    tag, sha256 = VENDOR_WHEELS[target]
    assert len(selected) == 1
    assert selected[0].url == (
        f"https://vnstocks.com/api/packages/files/vnstock/{SDK_VERSION}/"
        f"vnstock-{SDK_VERSION}-cp310-abi3-{tag}.whl#sha256={sha256}"
    )


@pytest.mark.parametrize(
    "target_os,machine,implementation",
    [("linux", "armv7l", "cpython"), ("win32", "ARM64", "cpython"), ("linux", "x86_64", "pypy")],
)
def test_wheel_lock_does_not_select_unpublished_platforms(target_os, machine, implementation):
    requirements = [
        Requirement(line)
        for line in CONSTRAINTS.read_text().splitlines()
        if line and not line.startswith("#")
    ]
    assert not any(
        requirement.marker.evaluate(
            {"sys_platform": target_os, "platform_machine": machine, "implementation_name": implementation}
        )
        for requirement in requirements
    )


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
    tag, sha256 = VENDOR_WHEELS[(sys.platform, platform.machine())]
    package = installed["vnstock"]
    assert package["metadata"]["version"] == SDK_VERSION
    assert package["download_info"]["url"] == (
        f"https://vnstocks.com/api/packages/files/vnstock/{SDK_VERSION}/"
        f"vnstock-{SDK_VERSION}-cp310-abi3-{tag}.whl"
    )
    assert package["download_info"]["archive_info"]["hashes"]["sha256"] == sha256
    assert not {"vnai", "vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii"} & installed.keys()
