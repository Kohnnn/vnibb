"""
AI Copilot Service

Provides natural language query processing for stock analysis.
Uses pattern matching for common queries with optional LLM fallback.
"""

import re
import logging
from typing import Dict, List, Optional, Tuple, Any
from pydantic import BaseModel, Field

from vnibb.core.config import settings

logger = logging.getLogger(__name__)



class CopilotQuery(BaseModel):
    """Input query for the copilot."""
    query: str
    context: Optional[Dict[str, Any]] = None


class CopilotResponse(BaseModel):
    """Response from the copilot."""
    answer: str
    data: Optional[Dict[str, Any]] = None
    suggested_actions: List[str] = Field(default_factory=list)
    intent: Optional[str] = None


# Intent patterns for common queries
INTENT_PATTERNS = {
    "analyze": [
        r"(?:analyze|phân tích|đánh giá)\s+(.+)",
    ],
    "compare": [
        r"compare\s+(.+?)(?:\s+and\s+|\s*,\s*)(.+)",
        r"so sánh\s+(.+?)(?:\s+và\s+|\s*,\s*)(.+)",
    ],
    "screener": [
        r"(?:show|find|list|tìm|cho xem)\s+(?:me\s+)?(.+?)\s+(?:with|có|where)\s+(.+)",
        r"(?:stocks?|cổ phiếu)\s+(?:with|có)\s+(.+)",
    ],
    "quote": [
        r"(?:price|quote|giá)\s+(?:of|cho|for)?\s*(.+)",
        r"(?:what.+trading.+at|giá bao nhiêu)\s+(.+)",
        r"(.+?)\s+(?:price|quote|giá)",
    ],
    "fundamentals": [
        r"(pe|pb|roe|roa|eps|dividend|cổ tức)\s+(?:for|of|cho|của)\s+(.+)",
        r"(.+?)\s+(pe|pb|roe|roa|eps)",
    ],
    "technical": [
        r"(?:technical|kỹ thuật|biểu đồ)\s+(?:outlook|view|analysis|phân tích)?\s*(?:for|of|cho|của)?\s*(.+)",
    ],
    "news": [
        r"(?:news|tin tức|sự kiện)\s*(?:for|of|cho|của)?\s*(.+)",
    ],
    "help": [
        r"^(?:help|trợ giúp|hướng dẫn|\?|how).*$",
    ],
}

PROMPT_TEMPLATES = {
    "analyze": (
        "Provide a comprehensive investment analysis for {symbol}. "
        "Include valuation (PE, PB), profitability (ROE, ROA), and a brief outlook based on current market position."
    ),
    "compare": (
        "Compare {symbol} with its key competitors. "
        "Highlight strengths and weaknesses in their financial metrics and market performance."
    ),
    "financials": (
        "Summarize the key financial highlights for {symbol} from the latest reports. "
        "Focus on revenue growth, net income trends, and cash flow health."
    ),
    "technical": (
        "Provide a technical analysis outlook for {symbol}. "
        "Comment on recent price action, key support/resistance levels, and prominent chart patterns if visible in the data."
    ),
    "news": (
        "Analyze the impact of recent news on {symbol}. "
        "Summarize the sentiment and potential market reaction to the latest headlines."
    ),
}


class CopilotService:
    """
    AI Copilot for natural language stock queries.
    
    Supports:
    - Stock comparisons
    - Screener queries
    - Price quotes
    - Fundamental metrics
    - Sector queries
    """
    
    def __init__(self):
        self.patterns = INTENT_PATTERNS
        self.templates = PROMPT_TEMPLATES
    
    async def build_context_prompt(self, context: Dict[str, Any]) -> str:
        """
        Build a context-aware system prompt based on widget context.
        """
        symbol = context.get("symbol", "the stock")
        widget_type = context.get("widgetType", "General")
        
        context_msg = f"User is currently looking at the **{widget_type}** widget for **{symbol}**.\n"
        
        if widget_type == "Key Metrics":
            metrics = context.get("metrics", {})
            if metrics:
                context_msg += f"Current metrics for {symbol}: PE={metrics.get('pe', 'N/A')}, PB={metrics.get('pb', 'N/A')}, ROE={metrics.get('roe', 'N/A')}%.\n"
        
        elif widget_type == "Price Chart":
            price = context.get("price", "N/A")
            change = context.get("changePct", "0")
            context_msg += f"Latest price: {price} ({change}%).\n"
            
        return context_msg

    def get_template(self, intent: str, symbol: str) -> str:
        """Get the prompt template for a specific intent."""
        template = self.templates.get(intent)
        if template:
            return template.format(symbol=symbol)
        return ""
    
    def _parse_intent(self, query: str) -> Tuple[str, Dict[str, Any]]:
        """
        Parse the intent and extract entities from query.
        
        Returns tuple of (intent, entities).
        """
        query_lower = query.lower().strip()
        
        for intent, patterns in self.patterns.items():
            for pattern in patterns:
                match = re.search(pattern, query_lower, re.IGNORECASE)
                if match:
                    entities = {"groups": match.groups()}
                    return intent, entities
        
        return "unknown", {}
    
    def _extract_symbols(self, text: str) -> List[str]:
        """Extract stock symbols from text."""
        # Match 2-4 uppercase letter symbols
        symbols = re.findall(r'\b([A-Z]{2,4})\b', text.upper())
        # Also try to find them in context
        words = text.upper().split()
        for word in words:
            clean = re.sub(r'[^\w]', '', word)
            if 2 <= len(clean) <= 4 and clean.isalpha() and clean not in symbols:
                symbols.append(clean)
        return list(set(symbols))[:10]  # Max 10 symbols
    
    def _extract_criteria(self, criteria_text: str) -> Dict[str, Tuple[str, float]]:
        """
        Extract filter criteria from text.
        
        Examples:
        - "PE < 10" -> {"pe": ("<", 10)}
        - "ROE > 15%" -> {"roe": (">", 15)}
        """
        criteria = {}
        
        # Pattern: metric operator value
        pattern = r'(pe|pb|roe|roa|eps|dividend|volume|market.?cap)\s*([<>=!]+)\s*(\d+(?:\.\d+)?)'
        matches = re.findall(pattern, criteria_text.lower())
        
        for metric, op, value in matches:
            metric = metric.replace(' ', '_')
            criteria[metric] = (op, float(value))
        
        return criteria
    
    async def _handle_compare(self, entities: Dict) -> CopilotResponse:
        """Handle comparison queries."""
        from vnibb.services.comparison_service import comparison_service
        
        groups = entities.get("groups", ())
        symbols = []
        for g in groups:
            symbols.extend(self._extract_symbols(g))
        
        if len(symbols) < 2:
            return CopilotResponse(
                answer="Please specify at least 2 symbols to compare. Example: 'Compare VNM and FPT'",
                intent="compare"
            )
        
        try:
            result = await comparison_service.compare(symbols[:5])
            
            # Build summary
            summaries = []
            for symbol in symbols[:5]:
                stock = result.data.get(symbol)
                if stock and stock.price:
                    change = stock.change_pct or 0
                    summaries.append(f"{symbol}: {stock.price:,.0f}₫ ({change:+.2f}%)")
            
            return CopilotResponse(
                answer=f"Comparison of {', '.join(symbols[:5])}:\n" + "\n".join(summaries),
                data={"comparison": result.model_dump()},
                suggested_actions=["View full comparison", "Add to watchlist"],
                intent="compare"
            )
        except Exception as e:
            logger.error(f"Comparison failed: {e}")
            return CopilotResponse(
                answer=f"I couldn't compare those stocks. Error: {str(e)}",
                intent="compare"
            )
    
    async def _handle_quote(self, entities: Dict) -> CopilotResponse:
        """Handle price quote queries."""
        from vnibb.providers.vnstock import VnstockScreenerFetcher
        
        groups = entities.get("groups", ())
        symbols = []
        for g in groups:
            if g:
                symbols.extend(self._extract_symbols(g))
        
        if not symbols:
            return CopilotResponse(
                answer="Please specify a stock symbol. Example: 'Price of VNM'",
                intent="quote"
            )
        
        try:
            results = await VnstockScreenerFetcher.fetch(
                symbol=symbols[0],
                limit=1,
                source=settings.vnstock_source

            )
            
            if not results:
                return CopilotResponse(
                    answer=f"I couldn't find data for {symbols[0]}.",
                    intent="quote"
                )
            
            stock = results[0]
            change = stock.price_change_1d_pct or 0
            change_str = f"{'📈' if change >= 0 else '📉'} {change:+.2f}%"
            
            return CopilotResponse(
                answer=f"**{symbols[0]}** ({stock.company_name or 'N/A'})\n"
                       f"Price: {stock.price:,.0f}₫ {change_str}\n"
                       f"Volume: {stock.volume:,.0f}\n"
                       f"Market Cap: {(stock.market_cap or 0)/1e9:.2f}B",
                data={"quote": stock.model_dump()},
                suggested_actions=["View chart", "Compare with peers", "Add to watchlist"],
                intent="quote"
            )
        except Exception as e:
            logger.error(f"Quote fetch failed: {e}")
            return CopilotResponse(
                answer=f"I couldn't get the price for {symbols[0]}.",
                intent="quote"
            )
    
    async def _handle_screener(self, entities: Dict) -> CopilotResponse:
        """Handle screener/filter queries."""
        from vnibb.providers.vnstock import VnstockScreenerFetcher
        
        groups = entities.get("groups", ())
        criteria_text = " ".join(g for g in groups if g)
        criteria = self._extract_criteria(criteria_text)
        
        if not criteria:
            return CopilotResponse(
                answer="I understand you want to filter stocks, but I couldn't parse the criteria. "
                       "Try something like: 'Show me stocks with PE < 10 and ROE > 15'",
                intent="screener"
            )
        
        try:
            results = await VnstockScreenerFetcher.fetch(limit=500, source=settings.vnstock_source)

            
            # Apply filters
            filtered = []
            for stock in results:
                matches = True
                for metric, (op, value) in criteria.items():
                    stock_value = getattr(stock, metric.replace('-', '_'), None)
                    if stock_value is None:
                        matches = False
                        break
                    
                    if op == '<' and not (stock_value < value):
                        matches = False
                    elif op == '<=' and not (stock_value <= value):
                        matches = False
                    elif op == '>' and not (stock_value > value):
                        matches = False
                    elif op == '>=' and not (stock_value >= value):
                        matches = False
                    elif op == '=' and not (stock_value == value):
                        matches = False
                
                if matches:
                    filtered.append(stock)
            
            # Sort by market cap
            filtered.sort(key=lambda x: x.market_cap or 0, reverse=True)
            top_5 = filtered[:5]
            
            if not top_5:
                return CopilotResponse(
                    answer="No stocks match your criteria.",
                    data={"count": 0, "stocks": []},
                    intent="screener"
                )
            
            summaries = []
            for s in top_5:
                summaries.append(
                    f"• **{s.symbol}**: PE={s.pe:.2f}" if s.pe else f"• **{s.symbol}**"
                )
            
            return CopilotResponse(
                answer=f"Found {len(filtered)} stocks matching your criteria. Top 5:\n" + "\n".join(summaries),
                data={"count": len(filtered), "stocks": [s.symbol for s in filtered[:20]]},
                suggested_actions=["View all results", "Export to CSV", "Add to watchlist"],
                intent="screener"
            )
        except Exception as e:
            logger.error(f"Screener query failed: {e}")
            return CopilotResponse(
                answer="I couldn't run that screener query.",
                intent="screener"
            )
    
    async def _handle_help(self, entities: Dict) -> CopilotResponse:
        """Handle help queries."""
        return CopilotResponse(
            answer="🤖 **AI Copilot Help**\n\n"
                   "I can help you with:\n"
                   "• **Price quotes**: 'Price of VNM'\n"
                   "• **Comparisons**: 'Compare VNM and FPT'\n"
                   "• **Screening**: 'Show stocks with PE < 10'\n"
                   "• **Fundamentals**: 'PE ratio for VCB'\n\n"
                   "Try one of these commands!",
            suggested_actions=["Price of VNM", "Compare VNM and FPT", "Show banks with PE < 10"],
            intent="help"
        )
    
    async def _handle_unknown(self, query: str) -> CopilotResponse:
        """Handle unknown intents."""
        symbols = self._extract_symbols(query)
        
        if symbols:
            # Assume they want a quote
            return await self._handle_quote({"groups": symbols})
        
        return CopilotResponse(
            answer="I'm not sure what you're looking for. Try asking about:\n"
                   "• Stock prices: 'Price of VNM'\n"
                   "• Comparisons: 'Compare VNM and FPT'\n"
                   "• Screening: 'Stocks with PE < 10'",
            suggested_actions=["Help", "Price of VNM", "Compare VNM FPT"],
            intent="unknown"
        )
    
    async def process(self, query: CopilotQuery) -> CopilotResponse:
        """
        Process a natural language query.
        
        Uses pattern matching first, falls back to LLM for complex queries.
        """
        intent, entities = self._parse_intent(query.query)
        
        logger.info(f"Copilot: query='{query.query}', intent={intent}")
        
        handlers = {
            "compare": self._handle_compare,
            "quote": self._handle_quote,
            "screener": self._handle_screener,
            "help": self._handle_help,
        }
        
        handler = handlers.get(intent)
        if handler:
            return await handler(entities)
        
        # Try LLM for unknown intents
        try:
            from vnibb.services.llm_service import llm_service
            if llm_service.is_available:
                logger.info("Using LLM for complex query")
                result = await llm_service.chat(
                    query.query, 
                    context=query.context
                )
                if result.get("answer"):
                    return CopilotResponse(
                        answer=result["answer"],
                        data=result.get("data"),
                        suggested_actions=["Ask another question", "View chart"],
                        intent="llm"
                    )
        except Exception as e:
            logger.warning(f"LLM fallback failed: {e}")
        
        # Final fallback
        return await self._handle_unknown(query.query)


# Singleton instance
copilot_service = CopilotService()
