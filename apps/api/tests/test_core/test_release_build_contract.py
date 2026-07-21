from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def test_release_build_passes_the_git_revision_without_a_secret() -> None:
    dockerfile = (ROOT / "apps/api/Dockerfile").read_text(encoding="utf-8")
    script = (ROOT / "scripts/oracle/build_release_image.sh").read_text(encoding="utf-8")

    assert "ARG IMAGE_RELEASE_REVISION=unknown" in dockerfile
    assert 'RUN printf \'%s\\n\' "$IMAGE_RELEASE_REVISION" > /app/.release-revision' in dockerfile
    assert 'revision="${IMAGE_RELEASE_REVISION:-$(git rev-parse --verify HEAD)}"' in script
    assert '--build-arg "IMAGE_RELEASE_REVISION=$revision"' in script


def test_retired_premium_bootstrap_fails_after_guidance() -> None:
    script = (ROOT / "scripts/oracle/bootstrap_vnstock_premium.sh").read_text(
        encoding="utf-8"
    )

    assert "Retired:" in script
    assert "deployment/env.oracle" in script
    assert script.rstrip().endswith("exit 1")
