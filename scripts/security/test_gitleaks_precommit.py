#!/usr/bin/env python3
"""Run: PATH=/path/to/gitleaks:$PATH python scripts/security/test_gitleaks_precommit.py.

Gitleaks and the pre-commit CLI must already be installed. Only synthetic secrets
are generated, in a temporary repository whose pre-commit hook is installed locally.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import shutil
import string
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
NAMES = ("DNSE_API_KEY", "DNSE_API_SECRET", "FINHAY_API_KEY", "FINHAY_API_SECRET")


def command(repo: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args, cwd=repo, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )


def checked(repo: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    result = command(repo, env, *args)
    if result.returncode:
        raise AssertionError(f"{args[0]} exited {result.returncode}; output withheld")
    return result


def main() -> None:
    gitleaks = shutil.which("gitleaks")
    pre_commit = shutil.which("pre-commit")
    if not gitleaks or not pre_commit:
        raise SystemExit("gitleaks and pre-commit must both be available on PATH")

    with tempfile.TemporaryDirectory(prefix="vnibb-gitleaks-test-") as temp:
        repo = Path(temp) / "repo"
        repo.mkdir()
        home = Path(temp) / "home"
        home.mkdir()
        env = os.environ.copy()
        for name in ("GITLEAKS_CONFIG", "GITLEAKS_CONFIG_TOML", "SKIP", "GIT_CONFIG_GLOBAL"):
            env.pop(name, None)
        env.update(
            HOME=str(home),
            PRE_COMMIT_HOME=str(home / "pre-commit"),
            XDG_CONFIG_HOME=str(home / "config"),
            GIT_CONFIG_NOSYSTEM="1",
            GIT_AUTHOR_NAME="Synthetic Hook Test",
            GIT_AUTHOR_EMAIL="test@example.invalid",
            GIT_COMMITTER_NAME="Synthetic Hook Test",
            GIT_COMMITTER_EMAIL="test@example.invalid",
        )
        checked(repo, env, "git", "init", "-q")
        for filename in (".gitleaks.toml", ".pre-commit-config.yaml"):
            shutil.copy2(ROOT / filename, repo / filename)
        checked(repo, env, pre_commit, "install", "--hook-type", "pre-commit")
        (repo / "safe.txt").write_text("safe baseline\n")
        checked(repo, env, "git", "add", ".")
        baseline = checked(repo, env, "git", "commit", "-qm", "safe baseline")
        assert "Gitleaks staged secrets" in baseline.stdout and "Passed" in baseline.stdout

        cases = 0
        for name in NAMES:
            for alphabet, length, punctuation in (
                (string.ascii_letters + string.digits, 40, ""),
                ("ABC123", 40, ""),
                (string.ascii_letters + string.digits, 8, ""),
                (string.ascii_letters + string.digits, 40, "$#,+/\\'\""),
            ):
                value = "".join(secrets.choice(alphabet) for _ in range(length)) + punctuation
                formats = [
                    ("assignment.env", f'export {name}={json.dumps(value)}\n'),
                    ("assignment.yaml", f"{name}: {json.dumps(value)}\n"),
                    ("assignment.json", json.dumps({name: value}) + "\n"),
                ]
                if '"' not in value and "'" not in value:
                    formats.extend([
                        ("assignment.env", f"{name}={value}\n"),
                        ("compose.yaml", f"services:\n  api:\n    environment:\n      - {name}={value}\n"),
                        ("assignment.env", f"export {name}='{value}'\n"),
                        ("shell.sh", f"export {name}='{value}';\n"),
                    ])
                for filename, text in formats:
                    candidate = repo / filename
                    candidate.write_text(text)
                    checked(repo, env, "git", "add", filename)
                    result = command(repo, env, "git", "commit", "-qm", "blocked")
                    assert result.returncode != 0, f"staged {name} in {filename} was accepted"
                    assert "Gitleaks staged secrets" in result.stdout and "Failed" in result.stdout
                    assert value not in result.stdout, "hook exposed a synthetic value"
                    checked(repo, env, "git", "rm", "--cached", "-q", filename)
                    candidate.unlink()
                    cases += 1

        (repo / "safe.env").write_text(NAMES[0] + "=\n" + NAMES[1] + '=""\n')
        checked(repo, env, "git", "add", "safe.env")
        staged = repo / "safe.txt"
        staged.write_text("safe staged content\n")
        checked(repo, env, "git", "add", "safe.txt")
        staged.write_text("safe staged content\n" + NAMES[0] + "=" + secrets.token_urlsafe(32) + "\n")
        unstaged = repo / "untracked.env"
        unstaged.write_text(NAMES[3] + "=" + secrets.token_urlsafe(32) + "\n")
        result = checked(repo, env, "git", "commit", "-qm", "staged content only")
        assert "Gitleaks staged secrets" in result.stdout and "Passed" in result.stdout
        assert NAMES[0] in staged.read_text() and unstaged.exists()
        assert checked(repo, env, "git", "show", "HEAD:safe.txt").stdout == "safe staged content\n"

        print(f"PASS: {cases} staged synthetic secrets blocked and redacted")
        print("PASS: staged safe content accepted while tracked and untracked secrets remain unstaged")


if __name__ == "__main__":
    main()
