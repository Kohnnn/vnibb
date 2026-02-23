"""
Vietnamese Sector Service

Provides sector-based aggregation and performance calculation for VN stocks.
Maps stocks to sectors using ICB codes and keywords.
"""

import logging
from typing import Dict, List, Optional
from pydantic import BaseModel, Field

from vnibb.core.vn_sectors import VN_SECTORS, SectorConfig, get_all_sectors


logger = logging.getLogger(__name__)


def _first_non_none(*values):
    for value in values:
        if value is not None:
            return value
    return None


def _coerce_optional_float(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_symbol(stock: dict) -> str:
    symbol = _first_non_none(stock.get("symbol"), stock.get("ticker"), "")
    return str(symbol).strip().upper()


def _extract_industry(stock: dict) -> str:
    industry = _first_non_none(
        stock.get("industry"),
        stock.get("industry_name"),
        stock.get("industryName"),
        stock.get("icb_name4"),
        stock.get("icb_name3"),
        stock.get("icb_name2"),
        "",
    )
    return str(industry).strip().lower()


def _extract_change_pct(stock: dict) -> Optional[float]:
    return _coerce_optional_float(
        _first_non_none(
            stock.get("price_change_1d_pct"),
            stock.get("change_pct"),
            stock.get("changePct"),
            stock.get("price_change_pct"),
            stock.get("priceChangePct"),
        )
    )


class StockBrief(BaseModel):
    """Brief stock info for sector display."""

    symbol: str
    price: Optional[float] = None
    change_pct: Optional[float] = Field(None, alias="changePct")

    model_config = {"populate_by_name": True}


class SectorPerformance(BaseModel):
    """Performance data for a single sector."""

    sector_id: str = Field(..., alias="sectorId")
    sector_name: str = Field(..., alias="sectorName")
    sector_name_en: str = Field(..., alias="sectorNameEn")
    change_pct: Optional[float] = Field(None, alias="changePct")
    top_gainer: Optional[StockBrief] = Field(None, alias="topGainer")
    top_loser: Optional[StockBrief] = Field(None, alias="topLoser")
    total_stocks: int = Field(0, alias="totalStocks")
    stocks: List[StockBrief] = []

    model_config = {"populate_by_name": True}


class SectorService:
    """Service for sector-based stock analysis."""

    @staticmethod
    async def get_stocks_by_sector(
        sector_id: str, screener_data: Optional[List[dict]] = None
    ) -> List[dict]:
        """
        Get stocks belonging to a sector based on ICB codes, keywords, or manual mapping.

        Args:
            sector_id: Sector identifier
            screener_data: Optional pre-fetched screener data

        Returns:
            List of stock data dicts
        """
        sector = VN_SECTORS.get(sector_id)
        if not sector:
            return []

        # If no screener data provided, return just the symbols
        if not screener_data:
            if sector.symbols:
                return [{"symbol": s} for s in sector.symbols]
            return []

        matched_stocks = []

        for stock in screener_data:
            symbol = _extract_symbol(stock)
            industry = _extract_industry(stock)
            sector_hint = (
                str(_first_non_none(stock.get("sector"), stock.get("sector_name"), ""))
                .strip()
                .lower()
            )
            icb_code = str(_first_non_none(stock.get("icb_code"), stock.get("icbCode"), ""))

            # Check manual symbols first
            if symbol in sector.symbols:
                matched_stocks.append(stock)
                continue

            # Respect explicit sector hint from upstream metadata when available.
            if sector_hint:
                if sector.name.lower() in sector_hint or sector.name_en.lower() in sector_hint:
                    matched_stocks.append(stock)
                    continue

            # Check ICB codes
            if icb_code:
                for code in sector.icb_codes:
                    if icb_code.startswith(code):
                        matched_stocks.append(stock)
                        break
                else:
                    # Check keywords in industry name
                    for keyword in sector.keywords:
                        if keyword.lower() in industry:
                            matched_stocks.append(stock)
                            break
            else:
                # No ICB code, check keywords only
                for keyword in sector.keywords:
                    if keyword.lower() in industry:
                        matched_stocks.append(stock)
                        break

        return matched_stocks

    @staticmethod
    async def calculate_sector_performance(screener_data: List[dict]) -> List[SectorPerformance]:
        """
        Calculate performance metrics for all sectors.

        Args:
            screener_data: Full screener data from vnstock

        Returns:
            List of SectorPerformance objects
        """
        results = []

        for sector_id, sector_config in VN_SECTORS.items():
            # Get stocks for this sector
            sector_stocks = await SectorService.get_stocks_by_sector(sector_id, screener_data)

            if not sector_stocks:
                # Include sector with 0 stocks for completeness
                results.append(
                    SectorPerformance(
                        sector_id=sector_id,
                        sector_name=sector_config.name,
                        sector_name_en=sector_config.name_en,
                        change_pct=None,
                        total_stocks=0,
                        stocks=[],
                    )
                )
                continue

            # Convert to list of StockBrief and calculate metrics
            stock_briefs = []
            total_change = 0.0
            valid_changes = 0
            top_gainer = None
            top_loser = None
            max_gain = float("-inf")
            max_loss = float("inf")

            for stock in sector_stocks:
                change_pct = _extract_change_pct(stock)
                price = _coerce_optional_float(
                    _first_non_none(stock.get("price"), stock.get("close"), stock.get("lastPrice"))
                )
                symbol = _extract_symbol(stock)

                brief = StockBrief(
                    symbol=symbol,
                    price=price,
                    change_pct=change_pct,
                )
                stock_briefs.append(brief)

                if change_pct is not None:
                    change_val = change_pct
                    total_change += change_val
                    valid_changes += 1

                    if change_val > max_gain:
                        max_gain = change_val
                        top_gainer = brief
                    if change_val < max_loss:
                        max_loss = change_val
                        top_loser = brief

            # Calculate average sector change
            avg_change = (total_change / valid_changes) if valid_changes > 0 else None

            # Sort stocks by change percentage
            stock_briefs.sort(
                key=lambda x: x.change_pct if x.change_pct is not None else 0, reverse=True
            )

            results.append(
                SectorPerformance(
                    sector_id=sector_id,
                    sector_name=sector_config.name,
                    sector_name_en=sector_config.name_en,
                    change_pct=round(avg_change, 2) if avg_change is not None else None,
                    top_gainer=top_gainer,
                    top_loser=top_loser,
                    total_stocks=len(sector_stocks),
                    stocks=stock_briefs[:10],  # Return top 10 stocks
                )
            )

        # Sort sectors by total stocks (most populated first)
        results.sort(key=lambda x: x.total_stocks, reverse=True)

        return results

    @staticmethod
    async def get_sector_top_movers(
        sector_id: str, screener_data: List[dict], type: str = "gainers", limit: int = 5
    ) -> List[StockBrief]:
        """
        Get top gainers or losers for a specific sector.

        Args:
            sector_id: Sector identifier
            screener_data: Full screener data
            type: "gainers" or "losers"
            limit: Max number of stocks to return

        Returns:
            List of StockBrief objects
        """
        sector_stocks = await SectorService.get_stocks_by_sector(sector_id, screener_data)

        # Convert and sort
        briefs = []
        for stock in sector_stocks:
            change_pct = _extract_change_pct(stock)
            if change_pct is None:
                continue
            briefs.append(
                StockBrief(
                    symbol=_extract_symbol(stock),
                    price=_coerce_optional_float(
                        _first_non_none(
                            stock.get("price"), stock.get("close"), stock.get("lastPrice")
                        )
                    ),
                    change_pct=change_pct,
                )
            )

        # Sort based on type
        briefs.sort(key=lambda x: x.change_pct or 0, reverse=(type == "gainers"))

        return briefs[:limit]
