from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx


def _load_env(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


async def _fetch_rows() -> list[dict[str, Any]]:
    from vnibb.providers.vnstock.market_overview import VnstockMarketOverviewFetcher

    rows = await VnstockMarketOverviewFetcher.extract_data({}, None)
    normalized: list[dict[str, Any]] = []
    for row in rows:
        index_code = str(row.get("index_name") or row.get("index_code") or "").upper().strip()
        if not index_code:
            continue

        time_value = str(row.get("time") or "").replace(" ", "T")
        if time_value and not time_value.endswith("Z"):
            time_value = f"{time_value}Z"

        normalized.append(
            {
                "index_code": index_code,
                "time": time_value,
                "open": str(row.get("open") if row.get("open") is not None else row.get("close")),
                "high": str(row.get("high") if row.get("high") is not None else row.get("close")),
                "low": str(row.get("low") if row.get("low") is not None else row.get("close")),
                "close": str(row.get("close")),
                "volume": str(row.get("volume") or 0),
                "value": str(row.get("value")) if row.get("value") is not None else None,
                "change": str(
                    (row.get("close") - row.get("prev_close"))
                    if row.get("close") is not None and row.get("prev_close") is not None
                    else row.get("change")
                )
                if (
                    (row.get("close") is not None and row.get("prev_close") is not None)
                    or row.get("change") is not None
                )
                else None,
                "change_pct": str(
                    (((row.get("close") - row.get("prev_close")) / row.get("prev_close")) * 100)
                    if row.get("close") is not None
                    and row.get("prev_close") not in (None, 0)
                    else row.get("change_pct")
                )
                if (
                    (row.get("close") is not None and row.get("prev_close") not in (None, 0))
                    or row.get("change_pct") is not None
                )
                else None,
                "created_at": time_value,
            }
        )
    return normalized


async def _upsert_documents(rows: list[dict[str, Any]], env: dict[str, str]) -> dict[str, int]:
    endpoint = (env.get("APPWRITE_ENDPOINT") or env.get("APPWRITE_URL") or "https://cloud.appwrite.io/v1").rstrip("/")
    project_id = env.get("APPWRITE_PROJECT_ID") or env.get("APPWRITE_NAME")
    api_key = env.get("APPWRITE_API_KEY") or env.get("APPWRITE_SECRET")
    database_id = env.get("APPWRITE_DATABASE_ID")
    if not project_id or not api_key or not database_id:
        raise RuntimeError("Missing Appwrite credentials in apps/api/.env")

    headers = {
        "X-Appwrite-Project": project_id,
        "X-Appwrite-Key": api_key,
        "Content-Type": "application/json",
    }
    base_url = f"{endpoint}/databases/{database_id}/collections/stock_indices/documents"

    created = 0
    updated = 0
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
        for row in rows:
            document_id = f"{row['index_code'].lower()}_{row['time'][:10].replace('-', '')}"
            response = await client.post(
                base_url,
                headers=headers,
                json={"documentId": document_id, "data": row},
            )
            if response.status_code == 409:
                response = await client.patch(
                    f"{base_url}/{document_id}",
                    headers=headers,
                    json={"data": row},
                )
                response.raise_for_status()
                updated += 1
                continue

            response.raise_for_status()
            created += 1

    return {"created": created, "updated": updated}


async def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    env = _load_env(repo_root / "apps" / "api" / ".env")
    rows = await _fetch_rows()
    result = await _upsert_documents(rows, env)
    print(json.dumps({"rows": len(rows), **result}, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
