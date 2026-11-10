#!/usr/bin/env python3
"""Refuse DNSE daily-bar imports until source-use authorization is accepted."""

import json
import sys


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] in {"--help", "-h"}:
        print(
            "DNSE acquisition is unavailable. No import is performed.\n"
            "Arguments such as --symbols, --start and --end cannot enable acquisition."
        )
        return 0
    # ponytail: Hard stop only; replace after written DNSE rights and #168 acceptance.
    print(json.dumps({
        "status": "refused",
        "reason": "dnse_authorization_missing",
        "error": "DNSE source authorization is not accepted; acquisition is unavailable",
    }), file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
