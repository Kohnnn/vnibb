
from datetime import date, timedelta
from typing import List, Literal, Optional
import io
import csv
import json

from fastapi import APIRouter, HTTPException, Query, Response, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.services.export_service import ExportService
from vnibb.providers.vnstock.financials import (
    VnstockFinancialsFetcher,
    FinancialsQueryParams,
    StatementType,
)
from vnibb.providers.vnstock.equity_historical import (
    VnstockEquityHistoricalFetcher,
    EquityHistoricalQueryParams,
)
from vnibb.providers.vnstock.equity_profile import (
    VnstockEquityProfileFetcher,
    EquityProfileQueryParams,
)

from vnibb.core.config import settings
from vnibb.services.comparison_service import comparison_service
from vnibb.core.exceptions import ProviderError, ProviderTimeoutError
from vnibb.core.database import get_db

router = APIRouter(prefix="/export", tags=["Export"])


@router.get("/dashboard/{dashboard_id}")
async def export_dashboard(
    dashboard_id: int,
    format: Literal["json", "csv"] = Query(default="json"),
    db: AsyncSession = Depends(get_db),
):
    """Export entire dashboard data as JSON or CSV."""
    from vnibb.services.dashboard_service import dashboard_service
    
    # Fetch dashboard
    dashboard = await dashboard_service.get_dashboard(dashboard_id, db)
    
    if not dashboard:
        raise HTTPException(404, "Dashboard not found")
    
    if format == "json":
        return dashboard
    
    # CSV export - flatten dashboard config
    output = io.StringIO()
    writer = csv.writer(output)
    
    writer.writerow([f"=== Dashboard: {dashboard.name} ==="])
    writer.writerow([f"ID: {dashboard.id}", f"User: {dashboard.user_id}"])
    writer.writerow([])
    
    writer.writerow(["=== Widgets ==="])
    writer.writerow(["ID", "Type", "Layout", "Config"])
    
    for widget in dashboard.widgets:
        writer.writerow([
            widget.widget_id,
            widget.widget_type,
            json.dumps(widget.layout),
            json.dumps(widget.widget_config)
        ])
    
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=dashboard_{dashboard_id}.csv"
        }
    )


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
        else:
            return ExportService.to_csv(data, filename)
            
    except (ProviderError, ProviderTimeoutError) as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except ImportError as e:
         raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
            source=settings.vnstock_source 

        )
        
        data = await VnstockEquityHistoricalFetcher.fetch(params)
        
        filename = f"{symbol}_ohlcv_{start_date}_{end_date}"
        
        if format == "excel":
            return ExportService.to_excel(data, filename)
        else:
            return ExportService.to_csv(data, filename)

    except (ProviderError, ProviderTimeoutError) as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {e.message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
        
        # Use comparison_service to get detailed metrics
        result = await comparison_service.compare(symbol_list)
        
        # Transform map to flat list for export
        # The service returns: { "VNM": StockMetrics(...), ... }
        # We need a list of dicts: [ {symbol: "VNM", price: ...}, ... ]
        
        export_data = []
        if result and result.data:
            for sym, metrics in result.data.items():
                # metrics is a StockMetrics object
                export_data.append(metrics)
        
        filename = f"peers_comparison_{len(symbol_list)}_stocks"
        
        if format == "excel":
            return ExportService.to_excel(export_data, filename)
        else:
            return ExportService.to_csv(export_data, filename)

    except (ProviderError, ProviderTimeoutError) as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
