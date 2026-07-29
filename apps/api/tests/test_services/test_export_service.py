import asyncio
from datetime import date

import pytest
from fastapi import HTTPException
from vnibb.api.v1.export import MAX_EXPORT_PEERS, _validate_historical_window, export_dashboard
from vnibb.core import scheduler
from vnibb.core.auth import User
from vnibb.services.export_service import ExportLimitError, ExportService


@pytest.mark.asyncio
async def test_csv_export_streams_stdlib_rows():
    response = ExportService.to_csv([{"symbol": "VNM", "close": 75_000}], "prices")
    body = "".join([chunk async for chunk in response.body_iterator])

    assert body == "symbol,close\r\nVNM,75000\r\n"


@pytest.mark.asyncio
async def test_csv_export_neutralizes_formula_cells():
    response = ExportService.to_csv(
        [{"formula": " \t=SUM(A1:A2)", "tab": "\t@cmd", "safe": "text"}],
        "prices",
    )
    body = "".join([chunk async for chunk in response.body_iterator])

    assert "' \t=SUM(A1:A2)" in body
    assert "'\t@cmd" in body


def test_export_rejects_oversized_cell(monkeypatch):
    monkeypatch.setattr("vnibb.services.export_service.MAX_EXPORT_CELL_BYTES", 4)

    with pytest.raises(ExportLimitError, match="cell"):
        ExportService.to_csv([{"symbol": "VNMIBB"}], "prices")


@pytest.mark.asyncio
async def test_lock_renewal_observes_exception_from_cancelled_runner(caplog):
    class Lock:
        ttl_seconds = 1

        async def renew(self):
            return False

    async def runner():
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            raise ValueError("cancelled runner failed") from None

    with pytest.raises(RuntimeError, match="renewal failed"):
        await scheduler._run_with_lock_renewal("test_job", runner, Lock())

    assert "cancelled runner failed" in caplog.text


@pytest.mark.asyncio
async def test_dashboard_export_scopes_query_to_current_user():
    class Result:
        def scalar_one_or_none(self):
            return None

    class Database:
        async def execute(self, statement):
            assert "owner" in str(statement.compile(compile_kwargs={"literal_binds": True}))
            return Result()

    with pytest.raises(HTTPException, match="Dashboard not found"):
        await export_dashboard(
            7,
            db=Database(),
            current_user=User(id="owner", email="", role="user"),
        )


def test_export_rejects_excess_rows_before_materialization(monkeypatch):
    monkeypatch.setattr("vnibb.services.export_service.MAX_EXPORT_ROWS", 1)

    with pytest.raises(ExportLimitError, match="row limit"):
        ExportService.to_csv([{"symbol": "VNM"}, {"symbol": "FPT"}], "prices")


def test_historical_window_and_peer_limits_are_bounded():
    _validate_historical_window(date(2020, 1, 1), date(2029, 12, 29), "1D")
    assert MAX_EXPORT_PEERS == 20

    with pytest.raises(HTTPException, match="Historical range"):
        _validate_historical_window(date(2020, 1, 1), date(2031, 1, 2), "1D")
