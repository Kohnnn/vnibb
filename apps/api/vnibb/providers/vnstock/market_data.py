"""VNStock implementation of the market-data operations used by callers."""

from __future__ import annotations

from typing import Any

from vnibb.core import financial_lane
from vnibb.providers.vnstock import runtime


def validate_source(source: str | None = None) -> str:
    return runtime.validate_source(source)


def history(symbol: str, source: str, *, start: str, end: str, interval: str | None = None,
            bypass_internal_retry: bool = False, mark_index_units: bool = False) -> Any:
    source = validate_source(source)
    quote = runtime.get_quote_class()(symbol=symbol, source=source)
    kwargs = {"start": start, "end": end}
    if interval is not None:
        kwargs["interval"] = interval
    method = quote.history
    original = getattr(method, "__wrapped__", None)
    frame = original(quote, **kwargs) if bypass_internal_retry and callable(original) else method(**kwargs)
    if frame is not None and hasattr(frame, "attrs"):
        attrs = frame.attrs
        actual_source = getattr(quote, "source", None)
        if isinstance(actual_source, str):
            attrs["provider_source"] = actual_source
        attrs["provider_module"] = getattr(quote, "__module__", None) or type(quote).__module__
        asset_type = getattr(quote, "asset_type", None)
        if asset_type is not None and not (frame.__dict__.get("category") or attrs.get("asset_type") or attrs.get("category")):
            attrs["asset_type"] = asset_type
        if mark_index_units and str(asset_type or "").lower() in {"index", "derivative"}:
            if attrs.get("price_unit") is None and attrs.get("priceUnit") is None:
                attrs["price_unit"] = "index_points"
    return frame


def intraday(symbol: str, source: str, *, page_size: int) -> Any:
    source = validate_source(source)
    quote = runtime.get_quote_class()(symbol=symbol, source=source)
    return quote.intraday(page_size=page_size)


def listing(source: str, *, view: str = "all_symbols", group: str | None = None) -> Any:
    source = validate_source(source)
    provider = runtime.get_listing_class()(source=source)
    if view == "symbols_by_group":
        return provider.symbols_by_group(group=group)
    if view == "symbols_by_exchange":
        return provider.symbols_by_exchange()
    if view == "symbols_by_industries":
        return provider.symbols_by_industries()
    if view == "all_symbols":
        return provider.all_symbols()
    raise ValueError(f"Unsupported listing view: {view}")


def listing_metadata(source: str) -> tuple[Any, Any, Any]:
    source = validate_source(source)
    provider = runtime.get_listing_class()(source=source)
    return provider.all_symbols(), provider.symbols_by_exchange(), provider.symbols_by_industries()


def financial_ratios(symbol: str, source: str) -> Any:
    source = validate_source(source)
    fundamental = runtime.import_vnstock_symbol("Fundamental")[0]()
    return fundamental.equity(symbol).ratio(source=source, period="year", lang="en", format="long")


def company_profile(symbol: str, source: str) -> dict[str, Any]:
    source = validate_source(source)
    company = runtime.get_company_class()(symbol=symbol, source=source)
    overview, profile, errors = {}, {}, []
    for method_name, target in (("overview", overview), ("profile", profile)):
        try:
            method = getattr(company, method_name, None)
            if method is None:
                continue
            frame = method()
            if frame is not None and not frame.empty:
                target.update(frame.iloc[0].to_dict())
        except Exception as exc:
            errors.append(exc)
    if not overview and not profile and errors:
        raise errors[-1]
    return {**profile, **overview}


def index_history(symbol: str, source: str, *, start: str, end: str) -> Any:
    source = validate_source(source)
    market = runtime.import_vnstock_symbol("Market")[0]()
    return market.index(symbol).ohlcv(start=start, end=end, source=source, floating=None)


def forex_rates() -> Any:
    return runtime.import_vnstock_symbol("Retail")[0]().exchange_rate()


def company_overview(symbol: str, source: str) -> Any:
    source = validate_source(source)
    return runtime.get_company_class()(symbol=symbol, source=source).overview()


def balance_sheet(symbol: str, source: str) -> Any:
    source = validate_source(source)
    return runtime.get_finance_class()(symbol=symbol, source=source).balance_sheet(period="year", lang="en")


def raw_dataset(symbol: str, source: str, dataset: str, *, start: str, end: str, limit: int) -> Any:
    source = validate_source(source)
    if dataset == "company.overview":
        return company_overview(symbol, source)
    methods = {"company.profile": "info", "company.shareholders": "shareholders", "company.officers": "officers", "company.subsidiaries": "subsidiaries", "company.events": "events"}
    if dataset in methods:
        company = runtime.import_vnstock_symbol("Reference")[0]().company(symbol)
        return getattr(company, methods[dataset])(source=source)
    market = runtime.import_vnstock_symbol("Market")[0]().equity(symbol)
    if dataset == "quote.history":
        return market.ohlcv(start=start, end=end, interval="1D", source=source, floating=None)
    if dataset == "quote.intraday":
        return market.trades(limit=limit, source=source)
    if dataset == "quote.price_depth":
        return market.volume_profile(source=source)
    if dataset == "company.trading_stats":
        return market.session_stats(source=source)
    raise ValueError(f"Unsupported dataset: {dataset}")


def price_board(symbols: list[str], source: str) -> Any:
    source = validate_source(source)
    return runtime.import_vnstock_symbol("Market")[0]().equity(symbols).quote(source=source)


async def run_reference(operation, timeout: float | None, *, key: tuple):
    return await runtime.run_reference_provider(operation, timeout=timeout, key=key)

async def run_financial(operation, timeout: float, *, key: tuple | None = None):
    return await financial_lane.run_financial(operation, timeout, key=key)
