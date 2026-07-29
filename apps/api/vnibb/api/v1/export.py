import json
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from vnibb.core.auth import User, get_dashboard_user
from vnibb.core.config import settings
from vnibb.core.database import get_db
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.models.dashboard import UserDashboard
from vnibb.providers.vnstock.equity_historical import (
    EquityHistoricalQueryParams,
    VnstockEquityHistoricalFetcher,
)
from vnibb.providers.vnstock.financials import (
    FinancialsQueryParams,
    StatementType,
    VnstockFinancialsFetcher,
)
from vnibb.services.comparison_service import comparison_service
from vnibb.services.export_service import MAX_EXPORT_ROWS, ExportLimitError, ExportService

router = APIRouter(prefix="/export", tags=["Export"])

MAX_EXPORT_PEERS = 20
MAX_HISTORICAL_DAYS = {
    "1m": 7,
    "5m": 31,
    "15m": 90,
    "30m": 180,
    "1H": 365,
    "1D": 3650,
    "1W": 7300,
    "1M": 10950,
}
MAX_HISTORICAL_ROWS = 10_000


def _validate_historical_window(start_date: date, end_date: date, interval: str) -> None:
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be on or after start_date")
    if (end_date - start_date).days > MAX_HISTORICAL_DAYS[interval]:
        raise HTTPException(
            status_code=413,
            detail=f"Historical range exceeds {MAX_HISTORICAL_DAYS[interval]} days for {interval}",
        )


@router.get("/dashboard/{dashboard_id}")
async def export_dashboard(
    dashboard_id: int,
    format: Literal["json", "csv"] = Query(default="json"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_dashboard_user),
):
    """Export entire dashboard data as JSON or CSV."""
    result = await db.execute(
        select(UserDashboard)
        .options(selectinload(UserDashboard.widgets))
        .where(
            UserDashboard.id == dashboard_id,
            UserDashboard.user_id == current_user.id,
        )
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(404, "Dashboard not found")
    if len(dashboard.widgets) > MAX_EXPORT_ROWS:
        raise HTTPException(status_code=413, detail="Dashboard exceeds export row limit")

    if format == "json":
        return dashboard

    rows = [
        [f"=== Dashboard: {dashboard.name} ==="],
        [f"ID: {dashboard.id}", f"User: {dashboard.user_id}"],
        [],
        ["=== Widgets ==="],
        ["ID", "Type", "Layout", "Config"],
    ]
    rows.extend(
        [
            widget.widget_id,
            widget.widget_type,
            json.dumps(widget.layout),
            json.dumps(widget.widget_config),
        ]
        for widget in dashboard.widgets
    )
    try:
        return ExportService.to_csv_rows(rows, f"dashboard_{dashboard_id}")
    except ExportLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc


@router.get(
    "/financials/{symbol}",
    summary="Export Financial Statements",
    description="Export financial statements (Income, Balance Sheet, Cash Flow) to Excel or CSV.",
)
async def export_financials(
    symbol: str,
    statement_type: Literal["income", "balance", "cashflow"] = Query(..., description="Statement type"),
    period: Literal["year", "quarter"] = Query(default="year", description="Period"),
    limit: int = Query(default=5, le=20),
    format: Literal["csv", "excel"] = Query(default="excel", description="Output format"),
) -> Response:
    """Export financial statements."""
    try:
        # Map statement_type to the enum
        st_enum = StatementType(statement_type)

        params = FinancialsQueryParams(
            symbol=symbol,
            statement_type=st_enum,
            period=period,
            limit=limit,
        )

        # Determine strict structure for export if necessary, but here we dump pydantic models
        data = await VnstockFinancialsFetcher.fetch(params)

        # Provide meaningful filename
        filename = f"{symbol}_{statement_type}_{period}"

        if format == "excel":
            return ExportService.to_excel(data, filename)
        return ExportService.to_csv(data, filename)

    except HTTPException:
        raise
    except ExportLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (ProviderError, ProviderTimeoutError) as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}") from e
    except ImportError as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e



@router.get(
    "/historical/{symbol}",
    summary="Export Historical Data",
    description="Export open-high-low-close-volume (OHLCV) data to CSV or Excel.",
)
async def export_historical(
    symbol: str,
    start_date: date = Query(default_factory=lambda: date.today() - timedelta(days=365)),
    end_date: date = Query(default_factory=date.today),
    interval: str = Query(default="1D"),
    format: Literal["csv", "excel"] = Query(default="csv"),
) -> Response:
    """Export historical price data."""
    try:
        params = EquityHistoricalQueryParams(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            interval=interval,
            source=settings.vnstock_source,
        )
        _validate_historical_window(params.start_date, params.end_date, params.interval)

        data = await VnstockEquityHistoricalFetcher.fetch(params)
        if len(data) > MAX_HISTORICAL_ROWS:
            raise ExportLimitError(f"Export exceeds {MAX_HISTORICAL_ROWS} row limit")

        filename = f"{symbol}_ohlcv_{start_date}_{end_date}"

        if format == "excel":
            return ExportService.to_excel(data, filename)
        return ExportService.to_csv(data, filename)

    except HTTPException:
        raise
    except ExportLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (ProviderError, ProviderTimeoutError) as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

@router.get(
    "/peers",
    summary="Export Peers Comparison",
    description="Export comparison data (metrics) for a list of stocks to CSV or Excel.",
)
async def export_peers(
    symbols: str = Query(..., description="Comma-separated list of symbols (e.g. VNM,VIC,FPT)"),
    format: Literal["csv", "excel"] = Query(default="excel"),
) -> Response:
    """Export peers comparison data."""
    try:
        symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]

        if not symbol_list:
            raise HTTPException(status_code=400, detail="No symbols provided")
        if len(symbol_list) > MAX_EXPORT_PEERS:
            raise HTTPException(status_code=413, detail=f"Export exceeds {MAX_EXPORT_PEERS} peer limit")

        # Use comparison_service to get detailed metrics
        result = await comparison_service.compare(symbol_list)

        # Transform map to flat list for export
        # The service returns: { "VNM": StockMetrics(...), ... }
        # We need a list of dicts: [ {symbol: "VNM", price: ...}, ... ]

        export_data = []
        if result and result.data:
            for metrics in result.data.values():
                # metrics is a StockMetrics object
                export_data.append(metrics)

        filename = f"peers_comparison_{len(symbol_list)}_stocks"

        if format == "excel":
            return ExportService.to_excel(export_data, filename)
        return ExportService.to_csv(export_data, filename)

    except HTTPException:
        raise
    except ExportLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (ProviderError, ProviderTimeoutError) as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
