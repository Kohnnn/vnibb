"""
VnStock Market Overview Fetcher

Fetches market indices and overview data for Vietnam stock market.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError

from vnibb.providers.vnstock import get_vnstock
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Shared thread pool for parallel fetching across requests
# This avoids the blocking behavior of 'with ThreadPoolExecutor' on timeout
_executor = ThreadPoolExecutor(max_workers=10)


def _first_non_none(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _coerce_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class MarketOverviewQueryParams(BaseModel):
    """Query parameters for market overview."""

    pass


class MarketIndexData(BaseModel):
    """Standardized market index data."""

    index_name: str
    current_value: Optional[float] = None
    change: Optional[float] = None
    change_pct: Optional[float] = None
    volume: Optional[float] = None
    high: Optional[float] = None
    low: Optional[float] = None
    time: Optional[Any] = None  # Could be datetime or string

    model_config = {
        "json_schema_extra": {
            "example": {
                "index_name": "VN-INDEX",
                "current_value": 1250.5,
                "change": 12.3,
                "change_pct": 0.99,
            }
        }
    }


class VnstockMarketOverviewFetcher(BaseFetcher[MarketOverviewQueryParams, MarketIndexData]):
    """Fetcher for market overview via vnstock."""

    provider_name = "vnstock"
    requires_credentials = False

    @staticmethod
    def transform_query(params: MarketOverviewQueryParams) -> dict[str, Any]:
        return {}

    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: Optional[dict[str, str]] = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_running_loop()

        index_candidates: dict[str, list[str]] = {
            "VNINDEX": ["VNINDEX", "VN-INDEX"],
            "VN30": ["VN30"],
            "HNX": ["HNX", "HNXINDEX", "HNX-INDEX"],
            "UPCOM": ["UPCOM", "UPCOMINDEX", "UPCOM-INDEX"],
        }

        source_candidates: list[str] = []
        for candidate in ("VCI", settings.vnstock_source, "TCBS", "DNSE", "KBS"):
            normalized = (candidate or "").strip().upper()
            if normalized and normalized not in source_candidates:
                source_candidates.append(normalized)

        def _fetch_single_index(index_name: str, symbols: list[str]) -> Optional[dict[str, Any]]:
            """Fetch a single market index with timeout handling."""
            try:
                stock_manager = get_vnstock()
                from datetime import datetime, timedelta

                end_date = datetime.now()
                start_date = end_date - timedelta(days=5)
                prev_end_date = end_date - timedelta(days=1)
                prev_start_date = prev_end_date - timedelta(days=45)

                for source in source_candidates:
                    for symbol in symbols:
                        stock = stock_manager.stock(symbol=symbol, source=source)
                        df = stock.quote.history(
                            start=start_date.strftime("%Y-%m-%d"),
                            end=end_date.strftime("%Y-%m-%d"),
                            show_log=False,
                        )
                        if df is None or df.empty:
                            continue

                        if "time" in df.columns:
                            df = df.sort_values("time")
                        elif "date" in df.columns:
                            df = df.sort_values("date")

                        latest = df.iloc[-1].to_dict()
                        prev_close = None
                        if len(df.index) > 1:
                            prev_close = df.iloc[-2].get("close")

                        if prev_close is None:
                            prev_close = _first_non_none(
                                latest.get("prev_close"),
                                latest.get("previous_close"),
                                latest.get("ref_price"),
                                latest.get("close_prev"),
                            )

                        if prev_close is None:
                            prev_df = stock.quote.history(
                                start=prev_start_date.strftime("%Y-%m-%d"),
                                end=prev_end_date.strftime("%Y-%m-%d"),
                                show_log=False,
                            )
                            if prev_df is not None and not prev_df.empty:
                                if "time" in prev_df.columns:
                                    prev_df = prev_df.sort_values("time")
                                elif "date" in prev_df.columns:
                                    prev_df = prev_df.sort_values("date")
                                prev_close = prev_df.iloc[-1].get("close")

                        if prev_close is not None:
                            latest["prev_close"] = prev_close

                        latest["index_name"] = index_name
                        latest["index_symbol"] = symbol
                        latest["source"] = source
                        return latest
            except Exception as e:
                # Downgrade to debug log to reduce noise if fetching fails
                logger.debug("Failed to fetch %s: %s", index_name, str(e))
            return None

        async def _fetch_index_async(
            pool, index_name: str, symbols: list[str], timeout: int = 8
        ) -> Optional[dict[str, Any]]:
            """Fetch a single index with timeout."""
            try:
                return await asyncio.wait_for(
                    loop.run_in_executor(pool, _fetch_single_index, index_name, symbols),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                logger.warning("Timeout fetching %s after %ss", index_name, timeout)
                return None
            except Exception as e:
                logger.warning("Error fetching %s: %s", index_name, e)
                return None

        try:
            indices = []

            # Fetch indices in parallel with per-index timeout of 8 seconds
            tasks = [
                _fetch_index_async(_executor, idx, symbols, timeout=8)
                for idx, symbols in index_candidates.items()
            ]

            # Total timeout of 15 seconds for all parallel requests
            results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True), timeout=15
            )

            for result in results:
                if isinstance(result, dict):
                    indices.append(result)

            return indices
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(provider="vnstock", timeout=15)
        except Exception as e:
            logger.error(f"vnstock market overview fetch error: {e}")
            raise ProviderError(message=str(e), provider="vnstock", details={})

    @staticmethod
    def transform_data(
        params: MarketOverviewQueryParams,
        data: List[dict[str, Any]],
    ) -> List[MarketIndexData]:
        results = []
        for row in data:
            try:
                # Handle different column names from different sources (VCI, TCBS, KBS)
                # VCI: close, change, pctChange
                # TCBS: price, change, percent_change
                # KBS: close, change, pct_change
                current_value = _first_non_none(
                    row.get("current_value"),
                    row.get("close"),
                    row.get("price"),
                    row.get("index_value"),
                )
                change = _first_non_none(
                    row.get("change"),
                    row.get("index_change"),
                    row.get("price_change"),
                    row.get("delta"),
                )
                change_pct = _first_non_none(
                    row.get("change_pct"),
                    row.get("pctChange"),
                    row.get("percent_change"),
                    row.get("pct_change"),
                    row.get("changePercent"),
                    row.get("percentChange"),
                    row.get("change_ratio"),
                )
                previous_close = _first_non_none(
                    row.get("prev_close"), row.get("previous_close"), row.get("ref_price")
                )
                open_price = row.get("open")
                volume = _first_non_none(row.get("volume"), row.get("total_volume"))
                high = _first_non_none(row.get("high"), row.get("highest"))
                low = _first_non_none(row.get("low"), row.get("lowest"))
                time_val = _first_non_none(
                    row.get("time"), row.get("trading_date"), row.get("date")
                )

                current_value_num = _coerce_float(current_value)
                change_num = _coerce_float(change)
                change_pct_num = _coerce_float(change_pct)
                previous_close_num = _coerce_float(previous_close)
                open_price_num = _coerce_float(open_price)

                if (
                    change_num is None
                    and current_value_num is not None
                    and previous_close_num is not None
                ):
                    change_num = current_value_num - previous_close_num

                if (
                    change_num is None
                    and current_value_num is not None
                    and change_pct_num is not None
                    and abs(change_pct_num + 100.0) > 1e-6
                ):
                    base_value = current_value_num / (1.0 + (change_pct_num / 100.0))
                    change_num = current_value_num - base_value

                if (
                    change_pct_num is None
                    and current_value_num is not None
                    and change_num is not None
                ):
                    base_value = current_value_num - change_num
                    if base_value not in (None, 0):
                        change_pct_num = (change_num / base_value) * 100

                if change_pct_num is None and current_value_num is not None:
                    base_value = None
                    if previous_close_num not in (None, 0):
                        base_value = previous_close_num
                    elif open_price_num not in (None, 0):
                        base_value = open_price_num
                    if base_value not in (None, 0):
                        delta = (
                            change_num if change_num is not None else current_value_num - base_value
                        )
                        change_pct_num = (delta / base_value) * 100

                results.append(
                    MarketIndexData(
                        index_name=_first_non_none(
                            row.get("index_name"), row.get("symbol"), "Unknown"
                        ),
                        current_value=current_value_num,
                        change=change_num,
                        change_pct=change_pct_num,
                        volume=_coerce_float(volume),
                        high=_coerce_float(high),
                        low=_coerce_float(low),
                        time=time_val,
                    )
                )
            except Exception as e:
                logger.warning(f"Skipping invalid market index row: {e}")
        return results
