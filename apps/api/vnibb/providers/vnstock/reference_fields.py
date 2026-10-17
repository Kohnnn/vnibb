"""Field admission shared by free VCI reference transforms and SQL writers."""

from datetime import date, datetime, time
from typing import Any

from vnibb.core.exceptions import ProviderError


def supplied(row: dict, *keys: str) -> Any:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            value = value.strip()
            if value.lower() in {"", "none", "null", "nan", "nat", "<na>"}:
                continue
        else:
            try:
                if value != value:
                    continue
            except (TypeError, ValueError):
                continue
        return value
    return None


def identity(value: Any, dataset: str) -> str:
    text = supplied({"value": value}, "value")
    if not isinstance(text, str) or text.lower() in {"unknown", "untitled", "event"}:
        raise ProviderError(f"Invalid {dataset} identity", provider="vnstock")
    return text


def parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    if value is None:
        return None
    raw = str(value).strip()
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in (
        "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M", "%Y-%m-%d", "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None
