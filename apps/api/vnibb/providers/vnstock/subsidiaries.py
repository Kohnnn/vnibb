"""
VnStock Subsidiaries Fetcher

Fetches company subsidiaries and affiliates data.
"""

import asyncio
import logging
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from vnibb.providers.base import BaseFetcher
from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.providers.vnstock.reference_fields import identity, supplied

logger = logging.getLogger(__name__)


class SubsidiariesQueryParams(BaseModel):
    """Query parameters for subsidiaries data."""
    
    symbol: str = Field(..., min_length=1, max_length=10)
    
    @field_validator("symbol")
    @classmethod
    def uppercase_symbol(cls, v: str) -> str:
        return v.upper().strip()


class SubsidiaryData(BaseModel):
    """Standardized subsidiary data."""
    
    symbol: str
    company_name: Optional[str] = None
    ownership_pct: Optional[float] = None
    charter_capital: Optional[float] = None
    subsidiary_symbol: Optional[str] = None
    relationship_type: str | None = None
    raw_data: dict[str, Any] | None = None
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "symbol": "VNM",
                "company_name": "Vinamilk Da Nang",
                "ownership_pct": 100,
            }
        }
    }


class VnstockSubsidiariesFetcher(BaseFetcher[SubsidiariesQueryParams, SubsidiaryData]):
    """Fetcher for subsidiaries via vnstock."""
    
    provider_name = "vnstock"
    requires_credentials = False
    propagate_provider_errors = True
    
    @staticmethod
    def transform_query(params: SubsidiariesQueryParams) -> dict[str, Any]:
        return {"symbol": params.symbol.upper()}
    
    @staticmethod
    async def extract_data(
        query: dict[str, Any],
        credentials: dict[str, str] | None = None,
    ) -> List[dict[str, Any]]:
        loop = asyncio.get_event_loop()
        
        def _fetch_sync() -> List[dict]:
            try:
                from vnibb.providers.vnstock.runtime import create_reference_company

                company = create_reference_company(query["symbol"], settings.vnstock_source)
                df = company.subsidiaries()
                
                if df is None or df.empty:
                    return []
                
                return df.to_dict("records")
            except Exception as e:
                logger.error(f"vnstock subsidiaries fetch error: {e}")
                raise ProviderError(message=str(e), provider="vnstock", details={"symbol": query["symbol"]})
        
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_sync),
                timeout=settings.vnstock_timeout,
            )
        except asyncio.TimeoutError:
            raise ProviderTimeoutError(provider="vnstock", timeout_seconds=settings.vnstock_timeout)
    
    @staticmethod
    def transform_data(
        params: SubsidiariesQueryParams,
        data: List[dict[str, Any]],
    ) -> List[SubsidiaryData]:
        results = []
        for row in data:
            try:
                results.append(SubsidiaryData(
                    symbol=params.symbol.upper(),
                    company_name=identity(supplied(row, "organ_name", "company_name", "companyName", "name", "tenCongTy"), "subsidiary"),
                    ownership_pct=supplied(row, "ownership_pct"),
                    raw_data=row,
                    charter_capital=supplied(row, "charter_capital", "charterCapital", "vonDieuLe"),
                    subsidiary_symbol=supplied(row, "sub_organ_code", "subsidiary_symbol", "sub_symbol"),
                    relationship_type=supplied(row, "type", "relationship_type"),
                ))
            except Exception as e:
                raise ProviderError("Invalid subsidiary row", provider="vnstock", cause=e) from e
        return results
