
import io
from typing import Any, List, Optional, Union
import pandas as pd
from fastapi.responses import StreamingResponse

class ExportService:
    """Service for handling data export to various formats."""

    @staticmethod
    def to_csv(data: Union[List[dict], List[Any]], filename: str) -> StreamingResponse:
        """
        Convert list of data to CSV and return as StreamingResponse.
        
        Args:
            data: List of dictionaries or Pydantic models
            filename: Name of the file (without extension)
        """
        df = ExportService._to_dataframe(data)
        
        stream = io.StringIO()
        df.to_csv(stream, index=False)
        
        response = StreamingResponse(
            iter([stream.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}.csv",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
        return response

    @staticmethod
    def to_excel(data: Union[List[dict], List[Any]], filename: str) -> StreamingResponse:
        """
        Convert list of data to Excel and return as StreamingResponse.
        
        Args:
            data: List of dictionaries or Pydantic models
            filename: Name of the file (without extension)
        """
        try:
            import openpyxl
        except ImportError:
            raise ImportError("openpyxl is required for Excel export")

        df = ExportService._to_dataframe(data)
        
        stream = io.BytesIO()
        # Use existing pandas Excel writer
        with pd.ExcelWriter(stream, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name="Data")
            
        stream.seek(0)
        
        response = StreamingResponse(
            iter([stream.getvalue()]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename={filename}.xlsx",
                "Access-Control-Expose-Headers": "Content-Disposition"
            }
        )
        return response

    @staticmethod
    def _to_dataframe(data: Union[List[dict], List[Any]]) -> pd.DataFrame:
        """Helper to convert input data to DataFrame."""
        if not data:
            return pd.DataFrame()
            
        # If data is list of Pydantic models, dump to dict
        if hasattr(data[0], "model_dump"):
             data_dicts = [item.model_dump() for item in data]
        elif hasattr(data[0], "dict"): # Pydantic v1 fallback
             data_dicts = [item.dict() for item in data]
        else:
            data_dicts = data
            
        return pd.DataFrame(data_dicts)
