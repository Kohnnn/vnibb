#!/usr/bin/env python3
"""Execute the optimized daily market refresh and print a compact JSON summary."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from vnibb.services.sync_all_data import run_daily_market_sync


def _configure_stdio() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


async def _main() -> int:
    _configure_stdio()
    results = await run_daily_market_sync()
    payload = {
        key: {
            "success": value.success,
            "synced_count": value.synced_count,
            "error_count": value.error_count,
            "duration_seconds": round(value.duration_seconds, 2),
            "errors": value.errors,
        }
        for key, value in results.items()
    }
    print(json.dumps(payload, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
