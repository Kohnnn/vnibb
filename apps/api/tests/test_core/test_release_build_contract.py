import json
import os
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
WINDOWS_BASH = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
BASH = str(WINDOWS_BASH) if os.name == "nt" and WINDOWS_BASH.exists() else "bash"


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


def test_release_build_emits_the_published_immutable_manifest(tmp_path: Path) -> None:
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
        "PLATFORM": "linux/arm64",
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
        "platform": "linux/arm64",
        "tag": "v1.6.1",
    }


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
        "    print('{\"providers\": {\"data_backend\": \"hybrid\", \"appwrite_write_enabled\": false, \"allow_anonymous_dashboard_writes\": true}, \"revision\": \"abc1234\"}')\n"
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


def test_retired_premium_bootstrap_fails_after_guidance() -> None:
    script = (ROOT / "scripts/oracle/bootstrap_vnstock_premium.sh").read_text(
        encoding="utf-8"
    )

    assert "Retired:" in script
    assert "deployment/env.oracle" in script
    assert script.rstrip().endswith("exit 1")
