"""Documentation entry points must resolve inside a standalone clone.

Issue #254: the README handoff, docs hub and several package READMEs pointed at a
parent checkout (`../docs/`, `AGENTS.md`, a nested `vnibb/` app, per-package
`LICENSE` files) that does not exist when `Kohnnn/vnibb` is cloned on its own.
These checks read the tracked Markdown only; they do not fetch external URLs.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def tracked_markdown() -> list[Path]:
    listed = subprocess.run(
        ["git", "ls-files", "*.md"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    return [ROOT / name for name in listed.stdout.splitlines() if name]


def relative_targets(path: Path) -> list[str]:
    text = re.sub(r"```.*?```", "", path.read_text(encoding="utf-8", errors="replace"), flags=re.DOTALL)
    targets = []
    for match in LINK.finditer(text):
        target = match.group(1).split("#", 1)[0]
        if not target or SCHEME.match(target) or target.startswith(("/", "//")) or "<" in target:
            continue
        targets.append(target)
    return targets


def test_relative_markdown_links_resolve_in_a_standalone_clone() -> None:
    broken = [
        f"{path.relative_to(ROOT)} -> {target}"
        for path in tracked_markdown()
        for target in relative_targets(path)
        if not (path.parent / target).exists()
    ]
    assert broken == []


def test_handoff_does_not_require_a_parent_checkout() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    handoff = readme.split("## Quick handoff prompt")[1].split("## Fast commands")[0]

    for stale in ("`../docs/`", "`.agent/`", "Work from `vnibb/`", "1. Read `AGENTS.md`"):
        assert stale not in handoff, stale
    assert "`docs/README.md`" in handoff
    # Paths named as entry points must exist as tracked files.
    for referenced in re.findall(r"`((?:docs|apps|packages|scripts)/[^`\s]+)`", handoff):
        assert (ROOT / referenced).exists(), referenced


def test_agent_instructions_are_documented_as_optional_when_untracked() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    ignored = subprocess.run(["git", "check-ignore", "-q", "AGENTS.md"], cwd=ROOT, timeout=60).returncode == 0

    if ignored:
        assert "git-ignored" in readme
        assert "`.gitignore`" in readme


def test_package_readmes_use_the_repository_license() -> None:
    for package in ("apps/api", "apps/web", "packages/providers", "packages/widgets"):
        readme = ROOT / package / "README.md"
        assert (readme.parent / "LICENSE").exists() is False
        assert "[`LICENSE`](../../LICENSE)" in readme.read_text(encoding="utf-8"), package
