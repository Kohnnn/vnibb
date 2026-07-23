"""Tests for cache TTL resolution and centralized-constant consistency.

Two invariants are enforced:

1. ``resolve_cache_ttl`` precedence: explicit ``ttl`` > centralized
   ``REDIS_CACHE_TTLS[key_prefix]`` > ``settings.redis_cache_ttl``.
2. No ``@cached(...)`` site may pass an explicit ``ttl=`` that *diverges*
   from a centralized ``REDIS_CACHE_TTLS`` value for the same ``key_prefix``.
   This catches the ``market_indices`` bug class where an inline magic TTL
   silently overrode the intended shared constant.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from vnibb.core.cache import resolve_cache_ttl
from vnibb.core.cache_constants import REDIS_CACHE_TTLS
from vnibb.core.config import settings

API_V1_DIR = Path(__file__).resolve().parents[2] / "vnibb" / "api" / "v1"


class TestResolveCacheTtl:
    def test_explicit_ttl_wins(self):
        assert resolve_cache_ttl(15, "market_indices") == 15

    def test_falls_back_to_centralized_constant(self):
        assert resolve_cache_ttl(None, "market_indices") == REDIS_CACHE_TTLS["market_indices"]

    def test_unknown_prefix_falls_back_to_settings_default(self):
        assert resolve_cache_ttl(None, "not_a_real_prefix") == settings.redis_cache_ttl


def _iter_cached_decorators():
    """Yield (file, lineno, ttl_value, key_prefix) for every @cached(...) call."""
    for path in sorted(API_V1_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
            if name != "cached":
                continue
            ttl_value = None
            key_prefix = None
            for kw in node.keywords:
                if kw.arg == "ttl" and isinstance(kw.value, ast.Constant):
                    ttl_value = kw.value.value
                elif kw.arg == "key_prefix" and isinstance(kw.value, ast.Constant):
                    key_prefix = kw.value.value
            yield path.name, node.lineno, ttl_value, key_prefix


class TestCachedSiteConsistency:
    def test_no_explicit_ttl_diverges_from_centralized_constant(self):
        divergences = []
        for filename, lineno, ttl_value, key_prefix in _iter_cached_decorators():
            if key_prefix is None or ttl_value is None:
                continue
            centralized = REDIS_CACHE_TTLS.get(key_prefix)
            if centralized is not None and ttl_value != centralized:
                divergences.append(
                    f"{filename}:{lineno} @cached(ttl={ttl_value}, "
                    f"key_prefix={key_prefix!r}) diverges from "
                    f"REDIS_CACHE_TTLS[{key_prefix!r}]={centralized}"
                )
        assert not divergences, (
            "Explicit @cached ttl diverges from centralized REDIS_CACHE_TTLS. "
            "Drop the inline ttl= to inherit the shared constant, or update the "
            "constant:\n" + "\n".join(divergences)
        )

    def test_scan_found_cached_sites(self):
        # Guards against the AST walker silently matching nothing (e.g. after a
        # refactor renames the decorator) and giving false confidence.
        assert any(kp is not None for _, _, _, kp in _iter_cached_decorators())
