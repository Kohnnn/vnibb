"""GET-only contract smoke; does not certify prices, adjustments or deployed parity."""

import argparse
import json
import math
import re
from datetime import date
from urllib.parse import urlencode, urlsplit
from urllib.request import urlopen


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="API origin, without /api/v1")
    parser.add_argument("--symbol", default="VNM")
    parser.add_argument("--start", type=date.fromisoformat, required=True)
    parser.add_argument("--end", type=date.fromisoformat, required=True)
    args = parser.parse_args()
    origin = urlsplit(args.base_url)
    if origin.scheme not in {"http", "https"} or not origin.hostname or origin.username:
        parser.error("base-url must be an HTTP(S) origin without credentials")
    if origin.path not in {"", "/"} or origin.query or origin.fragment:
        parser.error("base-url must not contain a path, query or fragment")
    if args.start > args.end or not re.fullmatch(r"[A-Za-z0-9]{1,12}", args.symbol):
        parser.error("use a valid symbol and start <= end")
    base = args.base_url.rstrip("/") + "/api/v1"

    def get(path: str) -> dict:
        with urlopen(base + path, timeout=60) as response:
            body = json.load(response)
        assert isinstance(body, dict), f"Invalid JSON response: {path}"
        return body

    health = get("/health/")
    params = urlencode({"symbol": args.symbol.upper(), "start_date": args.start,
                        "end_date": args.end, "interval": "1D", "source": "KBS",
                        "adjustment_mode": "raw"})
    history = get("/equity/historical?" + params)
    rows, meta = history.get("data"), history.get("meta")
    assert isinstance(rows, list) and isinstance(meta, dict), "Missing history envelope"
    assert meta.get("count") == len(rows), "History count mismatch"
    seen = set()
    for row in rows:
        session = date.fromisoformat(str(row["time"])[:10])
        assert args.start <= session <= args.end, f"Out-of-window session: {session}"
        assert session not in seen, f"Duplicate session: {session}"
        seen.add(session)
        if meta.get("unit_status") == "confirmed_vnd":
            assert row.get("price_unit") == "VND", f"Uncertified row: {session}"
        for field in ("open", "high", "low", "close"):
            value = row.get(field)
            assert value is None or (isinstance(value, (int, float))
                                     and not isinstance(value, bool) and math.isfinite(value)), (
                f"Invalid {field}: {session}"
            )
    assert rows or history.get("error") or meta.get("warnings"), "Unexplained empty history"
    print(json.dumps({"revision": health.get("revision"), "symbol": args.symbol.upper(),
                      "sessions": len(rows), "unit_status": meta.get("unit_status"),
                      "source_counts": meta.get("source_counts"),
                      "warnings": meta.get("warnings"),
                      "limit": "Contract checks only; provider values and adjustment basis unverified."},
                     indent=2))


if __name__ == "__main__":
    main()
