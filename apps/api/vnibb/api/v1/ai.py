from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import List, Optional, Any
from vnibb.services.ai_service import ai_service
from vnibb.services.comparison_service import comparison_service
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

class AnalysisRequest(BaseModel):
    question: Optional[str] = None

class ChatMessage(BaseModel):
    role: str # user or model
    parts: List[str]

class ChatRequest(BaseModel):
    message: str
    history: List[dict] = []
    symbol: Optional[str] = None

@router.post("/analyze/{symbol}")
async def analyze_stock(symbol: str, request: Optional[AnalysisRequest] = None):
    """
    Generate AI analysis for a stock using Gemini.
    """
    symbol = symbol.upper().strip()
    try:
        # Fetch real data for context
        stock_metrics = await comparison_service.get_stock_metrics(symbol)
        if not stock_metrics or not stock_metrics.metrics:
            raise HTTPException(status_code=404, detail=f"Data for {symbol} not found")
        
        analysis = await ai_service.analyze_stock(
            symbol=symbol,
            stock_data=stock_metrics.metrics,
            question=request.question if request else None
        )
        return {"symbol": symbol, "analysis": analysis}
    except Exception as e:
        logger.error(f"AI analysis endpoint failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chat")
async def chat(request: ChatRequest):
    """
    Interactive AI chat with optional stock context.
    """
    try:
        context_data = None
        if request.symbol:
            stock_metrics = await comparison_service.get_stock_metrics(request.symbol)
            context_data = stock_metrics.metrics if stock_metrics else None
            
        answer = await ai_service.chat(
            message=request.message,
            history=request.history,
            context_data=context_data
        )
        return {"answer": answer}
    except Exception as e:
        logger.error(f"AI chat endpoint failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
