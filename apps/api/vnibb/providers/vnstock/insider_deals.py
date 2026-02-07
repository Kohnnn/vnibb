"""
Insider Deals Provider - Insider Trading Transactions

Provides access to insider trading transactions.
Uses vnstock company.insider_deals() method.
"""

import asyncio
import logging
from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError

logger = logging.getLogger(__name__)


def _patch_kbs_company_client() -> Optional[type]:
    try:
        from vnstock_data.core.utils.client import ProxyConfig as DataProxyConfig
        from vnstock_data.core.utils.client import send_request as data_send_request
        import vnstock_data.explorer.kbs.company as kbs_company

        if kbs_company.send_request is not data_send_request:
            kbs_company.send_request = data_send_request
        return DataProxyConfig
    except Exception as exc:
        logger.debug(f"KBS company client patch failed: {exc}")
        return None


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
    
    Wraps vnstock company.insider_deals() method.
    """
    
    @staticmethod
    async def fetch(
        symbol: str,
        limit: int = 20,
    ) -> List[InsiderDealData]:
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
                try:
                    from vnstock_data.api.company import Company

                    try:
                        company = Company(source="VCI", symbol=symbol.upper())
                        df = company.insider_trading(page=1, page_size=limit)
                        if df is not None and len(df) > 0:
                            return df.to_dict(orient="records")
                    except Exception as e:
                        logger.debug(f"VCI insider trading failed for {symbol}: {e}")

                    try:
                        company = Company(source="KBS", symbol=symbol.upper())
                        proxy_config_cls = _patch_kbs_company_client()
                        if proxy_config_cls is not None:
                            company._provider.proxy_config = proxy_config_cls()
                        df = company.insider_trading(page=1, page_size=limit)
                        if df is not None and len(df) > 0:
                            return df.to_dict(orient="records")
                    except Exception as e:
                        logger.debug(f"KBS insider trading failed for {symbol}: {e}")
                except Exception as e:
                    logger.debug(f"vnstock_data insider trading failed for {symbol}: {e}")

                from vnstock import Vnstock

                def _fetch_source(source: str):
                    stock = Vnstock().stock(symbol=symbol.upper(), source=source)
                    if not hasattr(stock.company, "insider_deals"):
                        raise AttributeError("insider_deals not supported")
                    df = stock.company.insider_deals()
                    if df is not None and len(df) > 0:
                        return df.head(limit).to_dict(orient="records")
                    return []

                source = settings.vnstock_source
                try:
                    records = _fetch_source(source)
                    if records:
                        return records
                except Exception as e:
                    logger.debug(f"{source} insider_deals failed for {symbol}: {e}")

                return []
            
            loop = asyncio.get_event_loop()
            records = await loop.run_in_executor(None, _fetch)
            
            result = []
            for r in records:
                result.append(InsiderDealData(
                    symbol=symbol.upper(),
                    insider_name=_truncate(
                        r.get("insiderName")
                        or r.get("insider_name")
                        or r.get("name")
                        or r.get("trader_name")
                        or r.get("dtthlq")
                        or r.get("dtlqlq"),
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
                    transaction_type=_truncate(
                        r.get("dealType")
                        or r.get("deal_type")
                        or r.get("type")
                        or r.get("action")
                        or r.get("type_name")
                        or r.get("transfer_type_id")
                        or r.get("transfer_title_type_id"),
                        50,
                    ),
                    transaction_date=str(
                        r.get("dealDate")
                        or r.get("deal_date")
                        or r.get("public_date")
                        or r.get("date")
                        or r.get("date_action_from")
                        or r.get("date_action_to")
                        or r.get("date_buy_expected")
                        or r.get("date_sell_expected")
                    ) if (
                        r.get("dealDate")
                        or r.get("deal_date")
                        or r.get("public_date")
                        or r.get("date")
                        or r.get("date_action_from")
                        or r.get("date_action_to")
                        or r.get("date_buy_expected")
                        or r.get("date_sell_expected")
                    ) else None,
                    registration_date=str(
                        r.get("registrationDate")
                        or r.get("registration_date")
                        or r.get("trading_date")
                        or r.get("date_action_from")
                        or r.get("date_action_to")
                    ) if (
                        r.get("registrationDate")
                        or r.get("registration_date")
                        or r.get("trading_date")
                        or r.get("date_action_from")
                        or r.get("date_action_to")
                    ) else None,
                    shares_before=_clean_number(
                        r.get("sharesBefore")
                        or r.get("shares_before")
                        or r.get("beforeVolume")
                        or r.get("volume_before")
                        or r.get("register_volume_before")
                    ),
                    shares_registered=_clean_number(
                        r.get("sharesRegistered")
                        or r.get("shares_registered")
                        or r.get("registeredVolume")
                        or r.get("register_buy_volume")
                        or r.get("register_sell_volume")
                        or r.get("register_volume_after")
                    ),
                    shares_executed=_clean_number(
                        r.get("sharesExecuted")
                        or r.get("shares_executed")
                        or r.get("dealVolume")
                        or r.get("buy_volume")
                        or r.get("sell_volume")
                    ),
                    shares_after=_clean_number(
                        r.get("sharesAfter")
                        or r.get("shares_after")
                        or r.get("afterVolume")
                        or r.get("volume_after")
                        or r.get("register_volume_after")
                    ),
                    ownership_before=_clean_number(
                        r.get("ownershipBefore")
                        or r.get("ownership_before")
                        or r.get("beforeRatio")
                        or r.get("volume_before_percent")
                        or r.get("register_volume_before_percent")
                    ),
                    ownership_after=_clean_number(
                        r.get("ownershipAfter")
                        or r.get("ownership_after")
                        or r.get("afterRatio")
                        or r.get("volume_after_percent")
                        or r.get("register_volume_after_percent")
                    ),
                ))
            
            return result
            
        except Exception as e:
            logger.error(f"Insider deals fetch failed for {symbol}: {e}")
            raise ProviderError(
                message=f"Failed to fetch insider deals for {symbol}: {e}",
                provider="vnstock",
                details={"symbol": symbol},
            )
