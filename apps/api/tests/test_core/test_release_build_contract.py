import ast
import json
import os
import shlex
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
WINDOWS_BASH = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
BASH = str(WINDOWS_BASH) if os.name == "nt" and WINDOWS_BASH.exists() else shutil.which("bash") or "bash"


def test_release_build_passes_the_git_revision_without_a_secret() -> None:
    dockerfile = (ROOT / "apps/api/Dockerfile").read_text(encoding="utf-8")
    script = (ROOT / "scripts/oracle/build_release_image.sh").read_text(encoding="utf-8")

    assert "ARG IMAGE_RELEASE_REVISION=unknown" in dockerfile
    assert 'RUN printf \'%s\\n\' "$IMAGE_RELEASE_REVISION" > /app/.release-revision' in dockerfile
    assert 'revision="${IMAGE_RELEASE_REVISION:-}"' in script
    assert 'revision="$(git rev-parse --verify HEAD)"' in script
    assert '--build-arg "IMAGE_RELEASE_REVISION=$revision"' in script
    assert '--metadata-file "$metadata_file"' in script
    assert "containerimage.digest" in script
    assert "containerimage.descriptor" in script
    assert "docker buildx imagetools inspect" not in script
    assert '"repository":"%s"' in script
    assert '"digest":"%s"' in script
    assert '"image":"%s@%s"' in script
    assert '"revision":"%s"' in script
    assert '"platform":"%s"' in script
    assert '"tag":"%s"' in script
    assert "Published image digest unavailable" in script


@pytest.mark.parametrize("platform", ["linux/amd64", "linux/arm64"])
def test_release_build_emits_the_published_immutable_manifest(tmp_path: Path, platform: str) -> None:
    digest = "sha256:" + "a" * 64
    docker = tmp_path / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        "metadata_file=\"\"\n"
        "while (($#)); do\n"
        "  case \"$1\" in\n"
        "    --metadata-file) metadata_file=\"$2\"; shift 2 ;;\n"
        "    *) shift ;;\n"
        "  esac\n"
        "done\n"
        "[[ -n \"$metadata_file\" ]] || exit 1\n"
        f"printf '%s\\n' '{{\"containerimage.descriptor\":{{\"digest\":\"{digest}\"}}}}' > \"$metadata_file\"\n",
        encoding="utf-8",
    )
    docker.chmod(docker.stat().st_mode | stat.S_IXUSR)
    environment = os.environ | {
        "IMAGE_RELEASE_REVISION": "abc1234",
        "PLATFORM": platform,
        "PYTHON_BIN": sys.executable,
        "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}",
    }

    result = subprocess.run(
        [BASH, "scripts/oracle/build_release_image.sh", "registry.example.com/vnibb/api:v1.6.1"],
        cwd=ROOT,
        env=environment,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "repository": "registry.example.com/vnibb/api",
        "digest": digest,
        "image": f"registry.example.com/vnibb/api@{digest}",
        "revision": "abc1234",
        "platform": platform,
        "tag": "v1.6.1",
    }


@pytest.mark.parametrize("platform", ["linux/arm/v7", "linux/ppc64le", "linux/amd64,linux/arm64"])
def test_release_build_rejects_unsupported_platform_before_invoking_tools(platform: str) -> None:
    result = subprocess.run(
        [BASH, "scripts/oracle/build_release_image.sh", "registry.example.com/vnibb/api:v1.6.1"],
        cwd=ROOT,
        env=os.environ | {"PLATFORM": platform, "IMAGE_RELEASE_REVISION": "abc1234", "PATH": ""},
        executable=BASH,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert f"Unsupported VNStock 5.2.1 image platform: {platform}" in result.stderr
    assert "use linux/amd64 or linux/arm64" in result.stderr


def test_release_workflow_publishes_only_immutable_main_revisions() -> None:
    workflow = (ROOT / ".github/workflows/publish-release-image.yml").read_text(
        encoding="utf-8"
    )

    assert "workflow_dispatch:" in workflow
    assert "contents: read" in workflow
    assert "packages: write" in workflow
    assert "git merge-base --is-ancestor" in workflow
    assert "secrets.GITHUB_TOKEN" in workflow
    assert "Require unused release tag" in workflow
    assert 'build_release_image.sh "${repository}:${RELEASE_TAG}"' in workflow
    assert "VNSTOCK_API_KEY" not in workflow


def test_generation_five_images_resolve_wheels_inside_each_target_platform() -> None:
    dockerfile = (ROOT / "apps/api/Dockerfile").read_text(encoding="utf-8")
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    release = (ROOT / ".github/workflows/publish-release-image.yml").read_text(encoding="utf-8")

    assert "FROM python:3.12-slim" in dockerfile
    assert "ARG TARGETPLATFORM" in dockerfile
    assert 'case "$TARGETPLATFORM"' in dockerfile
    assert "linux/amd64|linux/arm64" in dockerfile
    assert "BUILDPLATFORM" not in dockerfile
    assert "--only-binary=vnstock" in dockerfile
    assert "-c constraints-vnstock.txt" in dockerfile
    assert "installed == '5.2.1'" in dockerfile
    assert 'version("vnai")' not in dockerfile
    assert "runner: [ubuntu-24.04, ubuntu-24.04-arm]" in ci
    assert "python-version: ['3.11', '3.12']" in ci
    assert "architecture: [amd64, arm64]" in ci
    assert "platforms: linux/${{ matrix.architecture }}" in ci
    assert "scope=vnstock5-${{ matrix.architecture }}" in ci
    assert "docker/setup-qemu-action@v3" in ci
    assert "platforms: arm64" in ci
    assert "platforms: arm64" in release
    assert "VNSTOCK_API_KEY" not in ci
    for workflow in ("ci.yml", "reliability-gate.yml"):
        content = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
        installs = [line for line in content.splitlines() if "-c apps/api/constraints-vnstock.txt" in line]
        assert installs
        assert all("--only-binary=vnstock" in line for line in installs)


def test_runtime_verification_checks_expected_revision_and_configured_digest() -> None:
    script = (ROOT / "scripts/oracle/runtime_verify.sh").read_text(encoding="utf-8")

    assert 'EXPECTED_RELEASE_REVISION="${EXPECTED_RELEASE_REVISION:-}"' in script
    assert 'release_revision="$(read_json_field "$health_json" "revision")"' in script
    assert '"$release_revision" != "$EXPECTED_RELEASE_REVISION"' in script
    assert 'EXPECTED_IMAGE_REPOSITORY="${EXPECTED_IMAGE_REPOSITORY:-${VNIBB_API_IMAGE_REPOSITORY:-}}"' in script
    assert 'EXPECTED_IMAGE_DIGEST="${EXPECTED_IMAGE_DIGEST:-${VNIBB_API_IMAGE_DIGEST:-}}"' in script
    assert 'docker inspect --format' in script
    assert '"$configured_image" != "$expected_image"' in script


def test_runtime_verification_fails_when_digest_is_requested_without_docker(
    tmp_path: Path,
) -> None:
    curl = tmp_path / "curl"
    curl.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "arguments = sys.argv[1:]\n"
        "if any('/health/' in argument for argument in arguments):\n"
        "    print('{\"providers\": {\"data_backend\": \"hybrid\", \"allow_anonymous_dashboard_writes\": true}, \"revision\": \"abc1234\"}')\n"
        "elif 'OPTIONS' in arguments:\n"
        "    print('access-control-allow-origin: https://vnibb-web.vercel.app')\n"
        "    print('access-control-allow-headers: X-VNIBB-Client-ID')\n"
        "else:\n"
        "    print('200')\n",
        encoding="utf-8",
    )
    curl.chmod(curl.stat().st_mode | stat.S_IXUSR)
    grep = tmp_path / "grep"
    grep.write_text(f"#!{sys.executable}\nimport sys\nsys.exit(0)\n", encoding="utf-8")
    grep.chmod(grep.stat().st_mode | stat.S_IXUSR)

    result = subprocess.run(
        [BASH, "scripts/oracle/runtime_verify.sh"],
        cwd=ROOT,
        env=os.environ
        | {
            "CURL_BIN": str(curl),
            "PYTHON_BIN": sys.executable,
            "PATH": str(tmp_path),
            "EXPECTED_RELEASE_REVISION": "abc1234",
            "EXPECTED_IMAGE_REPOSITORY": "registry.example.com/vnibb/api",
            "EXPECTED_IMAGE_DIGEST": "sha256:" + "a" * 64,
        },
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0


def test_compose_requires_repository_and_digest_separately() -> None:
    compose = (ROOT / "docker-compose.oracle.yml").read_text(encoding="utf-8")

    assert "VNIBB_API_IMAGE_REPOSITORY" in compose
    assert "VNIBB_API_IMAGE_DIGEST" in compose
    assert "VNIBB_API_IMAGE:" not in compose


def test_free_release_image_never_imports_or_installs_paid_modules() -> None:
    dockerfile = (ROOT / "apps/api/Dockerfile").read_text(encoding="utf-8")
    script = (ROOT / "scripts/oracle/build_release_image.sh").read_text(encoding="utf-8")

    for setting in ("VNSTOCK_RUNTIME_TIER=free", "VNSTOCK_SOURCE=VCI", "VNSTOCK_RUNTIME_INSTALL=0"):
        assert setting in dockerfile
    for forbidden in ("--secret", "VNSTOCK_API_KEY", "VNSTOCK_PREMIUM", "vnstock-installer", "install_paid_packages"):
        assert forbidden not in dockerfile
        assert forbidden not in script

    guard = next(line for line in dockerfile.splitlines() if line.startswith("RUN python -c ") and "find_spec" in line)
    code = shlex.split(guard)[-1]
    tree = ast.parse(code)
    paid_modules = {"vnstock_data", "vnstock_ta", "vnstock_pipeline", "vnstock_news", "vnii"}
    declared_modules = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "modules" for target in node.targets)
    )
    assert set(declared_modules) == paid_modules
    assert "find_spec(name) is not None" in code
    assert "assert not present" in code
    imports = [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
    assert len(imports) == 1
    assert isinstance(imports[0], ast.ImportFrom)
    assert imports[0].module == "importlib.util"
    assert [alias.name for alias in imports[0].names] == ["find_spec"]
    assert "__import__" not in code
    assert "import_module" not in code


def test_retired_premium_scripts_are_removed_without_shims() -> None:
    assert not (ROOT / "scripts/oracle/bootstrap_vnstock_premium.sh").exists()
    assert not (ROOT / "scripts/oracle/check_vnstock_premium.sh").exists()
