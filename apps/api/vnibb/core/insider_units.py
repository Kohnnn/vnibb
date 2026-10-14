"""Normalized insider deal direction tokens.

Free/alternate providers state insider direction as Vietnamese or English text
("Mua", "Bán", "Buy", "Sell"). Every consumer that classifies a deal must use
this single mapping so a SELL is never counted as a BUY and an unstated or
unmapped direction is never silently treated as a sale.
"""

import math
from collections.abc import Mapping
from typing import Any


def normalize_deal_action(value: object) -> str | None:
    """Map supplied source text to BUY/SELL; None when no direction is stated.

    Unclassifiable but present text returns "UNKNOWN" so consumers can tell a
    stated-but-unmapped direction apart from a missing one. Never guesses.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    lowered = text.lower()
    is_buy = any(token in lowered for token in ("mua", "buy"))
    is_sell = any(token in lowered for token in ("bán", "ban", "sell"))
    if is_buy == is_sell:
        return "UNKNOWN"
    return "BUY" if is_buy else "SELL"


def admitted_deal_value(deal: Any) -> float | None:
    """Return the canonical VND deal value, or None when it is not certifiable.

    Only a finite stored `deal_value` backed by explicit VND unit evidence in
    the stored provider payload is admitted; a value without unit evidence is
    never summed as VND, and an admitted zero stays zero.
    """
    if isinstance(deal, Mapping):
        value = deal.get("deal_value")
        raw_data = deal.get("raw_data")
    else:
        value = getattr(deal, "deal_value", None)
        raw_data = getattr(deal, "raw_data", None)
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    if not isinstance(raw_data, Mapping) or raw_data.get("value_unit") != "VND":
        return None
    return number
