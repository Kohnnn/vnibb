"""Normalized insider deal direction tokens.

Free/alternate providers state insider direction as Vietnamese or English text
("Mua", "Bán", "Buy", "Sell"). Every consumer that classifies a deal must use
this single mapping so a SELL is never counted as a BUY and an unstated or
unmapped direction is never silently treated as a sale.
"""

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
