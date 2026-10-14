"""
Insider Deals Provider - Insider Trading Transactions

Free VCI exposes insider trades only through `company.events()` event codes
(DDIND/DDINS/DDRP). There is no `insider_deals` dataset on the free runtime, so
this fetcher reads the events feed and keeps every provided field verbatim.

Canonical admission rules:
- `deal_action` is a normalized BUY/SELL token (or None when the source states
  no direction); the raw Vietnamese/English action text stays in `raw_data`.
- `deal_price`/`deal_value` are admitted only when the source supplies both a
  numeric value and an explicit unit; without unit evidence the canonical columns
  stay None and no unit is invented. Admission reuses the canonical
  `vnibb.core.price_units.normalize_price_record` helper (thousand-VND scaling
  included) so no magnitude is ever guessed here.
- `provider_record_id` (the provider event id) and `record_hash` (stable content
  identity) are carried for writer-side identity, so distinct same-day trades are
  never merged.
"""

import asyncio
import hashlib
import logging
import re
from typing import Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError
from vnibb.core.insider_units import normalize_deal_action
from vnibb.core.price_units import normalize_price_record

logger = logging.getLogger(__name__)

INSIDER_EVENT_CODES = ("DDIND", "DDINS", "DDRP")

_QUANTITY_PATTERN = r"([0-9][0-9.,]*)\s+{symbol}\b"


def _truncate(value: object, limit: int) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    return text[:limit] if len(text) > limit else text


def _clean_number(value: object) -> Optional[object]:
    if value is None:
        return None
    try:
        if value != value:
            return None
    except Exception:
        return None
    return value


def _first_supplied(record: dict, *keys: str) -> object | None:
    for key in keys:
        value = _clean_number(record.get(key))
        if value is not None:
            return value
    return None


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None



def _admit_money(value: object, unit: object, field: str) -> tuple[float | None, str]:
    """Return (admitted value in canonical VND, canonical unit) or (None, "unknown")."""
    number = _clean_number(value)
    if number is None:
        return None, "unknown"
    normalized = normalize_price_record({field: number, "price_unit": unit})
    if normalized.get("price_unit") != "VND":
        return None, "unknown"
    admitted = normalized.get(field)
    return (float(admitted) if admitted is not None else None), "VND"


def _event_identity(record: dict, symbol: str) -> tuple[str | None, str | None]:
    provider_record_id = _normalize_text(record.get("id") or record.get("event_id"))
    parts = [
        str(record.get(key) or "")
        for key in (
            "event_code",
            "public_date",
            "start_date",
            "end_date",
            "action_type_vi",
            "action_type_en",
            "event_title_vi",
            "event_title_en",
        )
    ]
    digest = hashlib.sha256("|".join([symbol, *parts]).encode("utf-8")).hexdigest()[:32]
    return provider_record_id, digest


def _event_title(record: dict) -> str | None:
    return _normalize_text(record.get("event_title_vi") or record.get("event_title_en"))


def _event_insider_name(record: dict) -> str | None:
    title = _event_title(record)
    if not title or " - " not in title:
        return None
    return _truncate(title.rsplit(" - ", 1)[0].strip(), 255) or None


def _event_action_text(record: dict) -> str | None:
    explicit = _normalize_text(
        record.get("action_type_vi") or record.get("action_type_en") or record.get("event_name_vi")
    )
    if explicit:
        return explicit
    title = _event_title(record)
    if title and " - " in title:
        return title.rsplit(" - ", 1)[1]
    return None


def _event_registered_shares(record: dict, symbol: str) -> int | None:
    """Read the share count the title literally states; None when absent."""
    title = _event_title(record)
    if not title:
        return None
    match = re.search(_QUANTITY_PATTERN.format(symbol=re.escape(symbol.upper())), title)
    if not match:
        return None
    digits = re.sub(r"[^0-9]", "", match.group(1))
    return int(digits) if digits else None


# =============================================================================
# DATA MODELS
# =============================================================================

class InsiderDealData(BaseModel):
    """Insider trading transaction data."""
    symbol: str
    # Insider info
    insider_name: Optional[str] = Field(None, alias="insiderName")
    insider_position: Optional[str] = Field(None, alias="position")
    insider_relation: Optional[str] = Field(None, alias="relation")
    # Transaction details
    transaction_type: Optional[str] = Field(None, alias="dealType")
    transaction_date: Optional[str] = Field(None, alias="dealDate")
    registration_date: Optional[str] = Field(None, alias="registrationDate")
    deal_action: str | None = Field(None, alias="dealAction")
    deal_price: float | None = Field(None, alias="dealPrice")
    deal_value: float | None = Field(None, alias="dealValue")
    price_unit: str | None = None
    value_unit: str | None = None
    quantity_unit: str | None = None
    provider_record_id: str | None = None
    record_hash: str | None = None
    raw_data: dict | None = None
    # Shares
    shares_before: Optional[int] = Field(None, alias="sharesBefore")
    shares_registered: Optional[int] = Field(None, alias="sharesRegistered")
    shares_executed: Optional[int] = Field(None, alias="sharesExecuted")
    shares_after: Optional[int] = Field(None, alias="sharesAfter")
    # Ownership
    ownership_before: Optional[float] = Field(None, alias="ownershipBefore")
    ownership_after: Optional[float] = Field(None, alias="ownershipAfter")

    model_config = {"populate_by_name": True}


class InsiderDealsQueryParams(BaseModel):
    """Query parameters for insider deals."""
    symbol: str
    limit: int = 20


# =============================================================================
# FETCHER
# =============================================================================

class VnstockInsiderDealsFetcher:
    """
    Fetcher for insider trading transactions.

    Uses the free VCI events feed (DDIND/DDINS/DDRP). A source that exposes a
    dedicated `insider_deals` dataset is used first when available.
    """

    @staticmethod
    def _raw_records(company, limit: int) -> list[dict]:
        if hasattr(company, "insider_deals"):
            df = company.insider_deals()
            if df is not None and len(df) > 0:
                return df.head(limit).to_dict(orient="records")
            return []

        if not hasattr(company, "events"):
            raise AttributeError("Insider deals are unavailable in free VCI")

        df = company.events()
        if df is None or len(df) == 0:
            return []
        records = [
            record
            for record in df.to_dict(orient="records")
            if str(record.get("event_code") or "").upper() in INSIDER_EVENT_CODES
        ]
        return records[:limit]

    @staticmethod
    async def fetch(
        symbol: str,
        limit: int = 20,
    ) -> list[InsiderDealData]:
        """
        Fetch insider deals for a company.

        Args:
            symbol: Stock symbol
            limit: Maximum number of records

        Returns:
            List of InsiderDealData records
        """
        try:
            def _fetch():
                from vnibb.providers.vnstock.runtime import get_company_class, validate_source

                company = get_company_class()(symbol=symbol.upper(), source=validate_source(settings.vnstock_source))
                return VnstockInsiderDealsFetcher._raw_records(company, limit)

            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)

            result: list[InsiderDealData] = []
            for r in records:
                raw_price = _first_supplied(r, "dealPrice", "deal_price", "price", "transaction_price")
                raw_value = _first_supplied(r, "dealValue", "deal_value", "value", "transaction_value")
                raw_price_unit = _first_supplied(r, "price_unit", "priceUnit")
                raw_value_unit = _first_supplied(r, "value_unit", "valueUnit")
                deal_price, price_unit = _admit_money(raw_price, raw_price_unit, "price")
                deal_value, value_unit = _admit_money(raw_value, raw_value_unit, "price")

                action_text = _event_action_text(r)
                action = normalize_deal_action(action_text)
                provider_record_id, record_hash = _event_identity(r, symbol.upper())
                registered = _first_supplied(
                    r, "sharesRegistered", "shares_registered", "registeredVolume",
                    "register_buy_volume", "register_sell_volume", "register_volume_after",
                )
                if registered is None:
                    registered = _event_registered_shares(r, symbol)

                result.append(InsiderDealData(
                    symbol=symbol.upper(),
                    deal_action=action,
                    deal_price=deal_price,
                    deal_value=deal_value,
                    price_unit=price_unit,
                    value_unit=value_unit,
                    quantity_unit="shares" if registered is not None else None,
                    provider_record_id=provider_record_id,
                    record_hash=record_hash,
                    raw_data={
                        key: value.isoformat() if hasattr(value, "isoformat") else _clean_number(value)
                        for key, value in r.items()
                    },
                    insider_name=_truncate(
                        r.get("insiderName")
                        or r.get("insider_name")
                        or r.get("name")
                        or r.get("trader_name")
                        or r.get("dtthlq")
                        or r.get("dtlqlq")
                        or _event_insider_name(r),
                        255,
                    ),
                    insider_position=_truncate(
                        r.get("position")
                        or r.get("insider_position")
                        or r.get("extra_position_nlq")
                        or r.get("position_cd")
                        or r.get("ndd_position")
                        or r.get("title"),
                        100,
                    ),
                    insider_relation=r.get("relation") or r.get("insider_relation") or r.get("relation_ship_type"),
                    transaction_type=action or _truncate(action_text, 50),
                    transaction_date=_normalize_text(
                        r.get("dealDate")
                        or r.get("deal_date")
                        or r.get("public_date")
                        or r.get("date")
                    ),
                    registration_date=_normalize_text(
                        r.get("registrationDate")
                        or r.get("registration_date")
                        or r.get("start_date")
                        or r.get("trading_date")
                    ),
                    shares_before=_first_supplied(r, "sharesBefore", "shares_before", "beforeVolume", "volume_before", "register_volume_before"),
                    shares_registered=registered,
                    shares_executed=_first_supplied(r, "sharesExecuted", "shares_executed", "dealVolume", "buy_volume", "sell_volume"),
                    shares_after=_first_supplied(r, "sharesAfter", "shares_after", "afterVolume", "volume_after", "register_volume_after"),
                    ownership_before=_first_supplied(r, "ownershipBefore", "ownership_before", "beforeRatio", "volume_before_percent", "register_volume_before_percent"),
                    ownership_after=_first_supplied(r, "ownershipAfter", "ownership_after", "afterRatio", "volume_after_percent", "register_volume_after_percent"),
                ))

            return result

        except Exception as e:
            logger.error(f"Insider deals fetch failed for {symbol}: {e}")
            raise ProviderError(
                message=f"Failed to fetch insider deals for {symbol}: {e}",
                provider="vnstock",
                details={"symbol": symbol},
            )
