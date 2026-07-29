import csv
import io
from collections.abc import Iterator
from importlib.util import find_spec
from typing import Any

import pandas as pd
from fastapi.responses import StreamingResponse

MAX_EXPORT_ROWS = 10_000
MAX_EXPORT_BYTES = 10 * 1024 * 1024
MAX_EXPORT_CELL_BYTES = 1 * 1024 * 1024


class ExportLimitError(ValueError):
    pass


class ExportService:
    """Service for handling data export to various formats."""

    @staticmethod
    def to_csv(data: list[dict] | list[Any], filename: str) -> StreamingResponse:
        records, fieldnames = ExportService._validate(data)

        def stream() -> Iterator[str]:
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            yield output.getvalue()
            for record in records:
                output.seek(0)
                output.truncate(0)
                writer.writerow(record)
                yield output.getvalue()

        return StreamingResponse(
            stream(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}.csv",
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )

    @staticmethod
    def to_csv_rows(rows: list[list[Any]], filename: str) -> StreamingResponse:
        if len(rows) > MAX_EXPORT_ROWS + 1:
            raise ExportLimitError(f"Export exceeds {MAX_EXPORT_ROWS} row limit")
        rows = [[ExportService._prepare_cell(cell) for cell in row] for row in rows]
        output = io.StringIO()
        writer = csv.writer(output)
        total_bytes = 0
        for row in rows:
            output.seek(0)
            output.truncate(0)
            writer.writerow(row)
            total_bytes += len(output.getvalue().encode())
            if total_bytes > MAX_EXPORT_BYTES:
                raise ExportLimitError(f"Export exceeds {MAX_EXPORT_BYTES} byte limit")

        def stream() -> Iterator[str]:
            for row in rows:
                output.seek(0)
                output.truncate(0)
                writer.writerow(row)
                yield output.getvalue()

        return StreamingResponse(
            stream(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}.csv",
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )

    @staticmethod
    def to_excel(data: list[dict] | list[Any], filename: str) -> StreamingResponse:
        if find_spec("openpyxl") is None:
            raise ImportError("openpyxl is required for Excel export")

        records, _ = ExportService._validate(data)
        stream = io.BytesIO()
        with pd.ExcelWriter(stream, engine="openpyxl") as writer:
            pd.DataFrame(records).to_excel(writer, index=False, sheet_name="Data")
        if stream.tell() > MAX_EXPORT_BYTES:
            raise ExportLimitError(f"Export exceeds {MAX_EXPORT_BYTES} byte limit")
        stream.seek(0)
        return StreamingResponse(
            iter([stream.getvalue()]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename={filename}.xlsx",
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )

    @staticmethod
    def _validate(data: list[dict] | list[Any]) -> tuple[list[dict], list[str]]:
        if len(data) > MAX_EXPORT_ROWS:
            raise ExportLimitError(f"Export exceeds {MAX_EXPORT_ROWS} row limit")
        records = [ExportService._record(item) for item in data]
        fieldnames = list(dict.fromkeys(key for record in records for key in record))
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        total_bytes = len(output.getvalue().encode())
        for record in records:
            output.seek(0)
            output.truncate(0)
            writer.writerow(record)
            total_bytes += len(output.getvalue().encode())
            if total_bytes > MAX_EXPORT_BYTES:
                raise ExportLimitError(f"Export exceeds {MAX_EXPORT_BYTES} byte limit")
        return records, fieldnames

    @staticmethod
    def _prepare_cell(value: Any) -> Any:
        rendered = value if isinstance(value, str) else str(value)
        if len(rendered.encode("utf-8")) > MAX_EXPORT_CELL_BYTES:
            raise ExportLimitError(f"Export cell exceeds {MAX_EXPORT_CELL_BYTES} byte limit")
        if isinstance(value, str) and (
            value[:1] in {"\t", "\r"} or value.lstrip()[:1] in {"=", "+", "-", "@"}
        ):
            return f"'{value}"
        return value

    @staticmethod
    def _record(item: Any) -> dict[str, Any]:
        if hasattr(item, "model_dump"):
            record = item.model_dump(mode="json")
        elif hasattr(item, "dict"):
            record = item.dict()
        elif isinstance(item, dict):
            record = item
        else:
            raise TypeError("Export rows must be dictionaries or Pydantic models")
        return {
            ExportService._prepare_cell(key): ExportService._prepare_cell(value)
            for key, value in record.items()
        }

