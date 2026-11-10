"""Keep SDK implementation imports inside the provider package."""

import ast
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
PROVIDER = ROOT / "apps/api/vnibb/providers/vnstock"
TESTS = ROOT / "apps/api/tests"
IGNORED_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__"}


def _forbidden_imports(path: Path, source: str) -> list[str]:
    violations = []
    for node in sorted(ast.walk(ast.parse(source, filename=str(path))), key=lambda item: getattr(item, "lineno", 0)):
        if isinstance(node, ast.Import):
            modules = [item.name for item in node.names]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            modules = (
                [f"{module}.{item.name}" for item in node.names]
                if module.endswith("providers.vnstock") else [module]
            )
        elif (
            isinstance(node, ast.Call) and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
            and (
                isinstance(node.func, ast.Name) and node.func.id == "__import__"
                or isinstance(node.func, ast.Attribute) and node.func.attr == "import_module"
            )
        ):
            modules = [node.args[0].value]
        else:
            continue
        for module in modules:
            if (
                module == "vnstock" or module.startswith("vnstock.")
                or module == "vnibb.providers.vnstock.runtime"
                or module.startswith("vnibb.providers.vnstock.runtime.")
                or isinstance(node, ast.ImportFrom) and node.level
                and (module == "providers.vnstock.runtime" or module.startswith("providers.vnstock.runtime."))
            ):
                violations.append(f"{path}:{node.lineno}: {module}")
    return violations


def test_sdk_import_guard_reports_path_and_import():
    source = (
        "from vnibb.providers.vnstock import runtime\n"
        "import vnstock as sdk\n"
        "__import__('vnstock')\n"
        "from ..providers.vnstock.runtime import validate_source\n"
    )
    assert _forbidden_imports(Path("example.py"), source) == [
        "example.py:1: vnibb.providers.vnstock.runtime",
        "example.py:2: vnstock",
        "example.py:3: vnstock",
        "example.py:4: providers.vnstock.runtime",
    ]


def test_sdk_imports_are_confined_to_provider():
    violations = []
    for directory, dirs, files in os.walk(ROOT):
        root = Path(directory)
        dirs[:] = [
            name for name in dirs
            if name not in IGNORED_DIRS and root / name not in {PROVIDER, TESTS}
        ]
        if root.is_relative_to(PROVIDER) or root.is_relative_to(TESTS):
            dirs.clear()
            continue
        for name in files:
            if name.endswith(".py"):
                path = root / name
                violations.extend(_forbidden_imports(path.relative_to(ROOT), path.read_text(encoding="utf-8")))
    assert not violations, "Forbidden provider imports:\n" + "\n".join(violations)
