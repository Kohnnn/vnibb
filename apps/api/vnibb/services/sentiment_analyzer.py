"""
Sentiment Analyzer Service using Gemini AI

Analyzes Vietnamese news articles for market sentiment.
Classifies as: Bullish, Neutral, or Bearish with confidence scores.
"""

import os
import re
import logging
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

try:
    import google.generativeai as genai
    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False

logger = logging.getLogger(__name__)


class SentimentAnalyzer:
    """
    AI-powered sentiment analysis for Vietnamese financial news.
    
    Uses Gemini API for intelligent sentiment classification.
    Falls back to rule-based analysis if API is unavailable.
    """
    
    # Vietnamese sentiment keywords for fallback
    BULLISH_KEYWORDS = [
        "tăng trưởng", "lợi nhuận", "tích cực", "khả quan", "tăng",
        "đột phá", "thành công", "mở rộng", "phát triển", "cải thiện",
        "vượt kế hoạch", "kỷ lục", "tăng mạnh", "tăng cao"
    ]
    
    BEARISH_KEYWORDS = [
        "giảm", "lỗ", "sụt giảm", "tiêu cực", "khó khăn", "rủi ro",
        "thất bại", "suy giảm", "đình trệ", "khủng hoảng", "sa thải",
        "phá sản", "nợ xấu", "giảm mạnh", "lỗ nặng"
    ]
    
    SENTIMENT_PROMPT = """Phân tích bài báo tài chính tiếng Việt sau đây và trả về kết quả theo định dạng JSON chính xác:

Bài báo:
Tiêu đề: {title}
Nội dung: {content}

Yêu cầu phân tích:
1. Sentiment: Xác định tâm lý thị trường là "bullish" (tích cực), "neutral" (trung lập), hoặc "bearish" (tiêu cực)
2. Confidence: Độ tin cậy từ 0-100 (số nguyên)
3. Symbols: Danh sách mã cổ phiếu được đề cập (tối đa 5 mã)
4. Sectors: Danh sách ngành được đề cập (tối đa 3 ngành)
5. Summary: Tóm tắt 2-3 câu bằng tiếng Việt

Trả về CHÍNH XÁC theo định dạng JSON sau (không thêm markdown hay text khác):
{{
  "sentiment": "bullish|neutral|bearish",
  "confidence": 85,
  "symbols": ["VNM", "HPG"],
  "sectors": ["Ngân hàng", "Bất động sản"],
  "summary": "Tóm tắt ngắn gọn về nội dung chính của bài báo."
}}"""
    
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        self.model = None
        self._initialized = False
        self._cache = {}  # Simple in-memory cache
        self._cache_ttl = timedelta(hours=24)
        
        if self.api_key and HAS_GEMINI:
            try:
                genai.configure(api_key=self.api_key)
                # Use gemini-1.5-flash for faster, cheaper sentiment analysis
                self.model = genai.GenerativeModel(
                    'gemini-1.5-flash',
                    generation_config={
                        'temperature': 0.3,  # Lower temp for more consistent results
                        'top_p': 0.8,
                        'top_k': 40,
                    }
                )
                self._initialized = True
                logger.info("SentimentAnalyzer initialized with Gemini 1.5 Flash")
            except Exception as e:
                logger.error(f"Failed to configure Gemini: {e}")
        else:
            if not HAS_GEMINI:
                logger.warning("google-generativeai not installed. Using rule-based sentiment.")
            elif not self.api_key:
                logger.warning("GOOGLE_API_KEY not found. Using rule-based sentiment.")
    
    @property
    def is_available(self) -> bool:
        """Check if AI sentiment analysis is available."""
        return self._initialized and self.model is not None
    
    async def analyze_article(
        self,
        title: str,
        content: Optional[str] = None,
        summary: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Analyze sentiment of a news article.
        
        Args:
            title: Article title
            content: Full article content (optional)
            summary: Article summary (optional)
            
        Returns:
            Dict with sentiment, confidence, symbols, sectors, summary
        """
        # Use cache key based on title
        cache_key = f"sentiment_{hash(title)}"
        
        # Check cache
        if cache_key in self._cache:
            cached_result, cached_time = self._cache[cache_key]
            if datetime.utcnow() - cached_time < self._cache_ttl:
                logger.debug(f"Using cached sentiment for: {title[:50]}")
                return cached_result
        
        # Prepare text for analysis
        text_to_analyze = content or summary or title
        
        if self.is_available:
            result = await self._analyze_with_ai(title, text_to_analyze)
        else:
            result = self._analyze_with_rules(title, text_to_analyze)
        
        # Cache result
        self._cache[cache_key] = (result, datetime.utcnow())
        
        return result
    
    async def _analyze_with_ai(self, title: str, content: str) -> Dict[str, Any]:
        """Analyze using Gemini AI."""
        try:
            # Truncate content to avoid token limits (max ~2000 chars)
            content_truncated = content[:2000] if len(content) > 2000 else content
            
            prompt = self.SENTIMENT_PROMPT.format(
                title=title,
                content=content_truncated
            )
            
            # Generate response
            response = await self.model.generate_content_async(prompt)
            
            # Parse JSON response
            result_text = response.text.strip()
            
            # Remove markdown code blocks if present
            result_text = re.sub(r'```json\s*', '', result_text)
            result_text = re.sub(r'```\s*', '', result_text)
            
            import json
            result = json.loads(result_text)
            
            # Validate and normalize
            sentiment = result.get("sentiment", "neutral").lower()
            if sentiment not in ["bullish", "neutral", "bearish"]:
                sentiment = "neutral"
            
            confidence = int(result.get("confidence", 50))
            confidence = max(0, min(100, confidence))  # Clamp to 0-100
            
            symbols = result.get("symbols", [])[:5]  # Max 5 symbols
            sectors = result.get("sectors", [])[:3]  # Max 3 sectors
            ai_summary = result.get("summary", "")
            
            return {
                "sentiment": sentiment,
                "confidence": confidence,
                "symbols": symbols,
                "sectors": sectors,
                "ai_summary": ai_summary,
            }
            
        except Exception as e:
            logger.error(f"AI sentiment analysis failed: {e}")
            # Fallback to rule-based
            return self._analyze_with_rules(title, content)
    
    def _analyze_with_rules(self, title: str, content: str) -> Dict[str, Any]:
        """Fallback rule-based sentiment analysis."""
        text = f"{title} {content}".lower()
        
        bullish_count = sum(1 for kw in self.BULLISH_KEYWORDS if kw in text)
        bearish_count = sum(1 for kw in self.BEARISH_KEYWORDS if kw in text)
        
        total_keywords = bullish_count + bearish_count
        
        if total_keywords == 0:
            sentiment = "neutral"
            confidence = 50
        elif bullish_count > bearish_count:
            sentiment = "bullish"
            confidence = min(50 + (bullish_count * 10), 80)
        elif bearish_count > bullish_count:
            sentiment = "bearish"
            confidence = min(50 + (bearish_count * 10), 80)
        else:
            sentiment = "neutral"
            confidence = 60
        
        # Extract symbols (basic regex for Vietnamese stock codes)
        symbols = re.findall(r'\b([A-Z]{3})\b', title + " " + content[:500])
        symbols = list(set(symbols))[:5]  # Unique, max 5
        
        return {
            "sentiment": sentiment,
            "confidence": confidence,
            "symbols": symbols,
            "sectors": [],
            "ai_summary": title[:200],  # Use title as summary
        }
    
    async def analyze_batch(
        self,
        articles: List[Dict[str, Any]],
        max_concurrent: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Analyze multiple articles in batch with concurrency control.
        
        Args:
            articles: List of dicts with 'title', 'content', 'summary'
            max_concurrent: Max concurrent API calls
            
        Returns:
            List of sentiment results
        """
        semaphore = asyncio.Semaphore(max_concurrent)
        
        async def analyze_with_semaphore(article):
            async with semaphore:
                return await self.analyze_article(
                    title=article.get("title", ""),
                    content=article.get("content"),
                    summary=article.get("summary")
                )
        
        tasks = [analyze_with_semaphore(article) for article in articles]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Handle exceptions
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Batch analysis failed for article {i}: {result}")
                # Use fallback
                processed_results.append(self._analyze_with_rules(
                    articles[i].get("title", ""),
                    articles[i].get("content", "")
                ))
            else:
                processed_results.append(result)
        
        return processed_results
    
    def calculate_market_sentiment(
        self,
        articles: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Calculate aggregate market sentiment from multiple articles.
        
        Args:
            articles: List of articles with sentiment data
            
        Returns:
            Market sentiment summary
        """
        if not articles:
            return {
                "overall": "neutral",
                "bullish_count": 0,
                "neutral_count": 0,
                "bearish_count": 0,
                "total_articles": 0,
                "trend_direction": "stable",
            }
        
        bullish = sum(1 for a in articles if a.get("sentiment") == "bullish")
        neutral = sum(1 for a in articles if a.get("sentiment") == "neutral")
        bearish = sum(1 for a in articles if a.get("sentiment") == "bearish")
        total = len(articles)
        
        # Determine overall sentiment
        if bullish > bearish and bullish > neutral:
            overall = "bullish"
        elif bearish > bullish and bearish > neutral:
            overall = "bearish"
        else:
            overall = "neutral"
        
        # Calculate trend (compare recent vs older articles)
        mid_point = len(articles) // 2
        recent_bullish = sum(1 for a in articles[:mid_point] if a.get("sentiment") == "bullish")
        older_bullish = sum(1 for a in articles[mid_point:] if a.get("sentiment") == "bullish")
        
        if recent_bullish > older_bullish * 1.2:
            trend = "improving"
        elif recent_bullish < older_bullish * 0.8:
            trend = "declining"
        else:
            trend = "stable"
        
        return {
            "overall": overall,
            "bullish_count": bullish,
            "neutral_count": neutral,
            "bearish_count": bearish,
            "total_articles": total,
            "bullish_percentage": round(bullish / total * 100, 1) if total > 0 else 0,
            "bearish_percentage": round(bearish / total * 100, 1) if total > 0 else 0,
            "trend_direction": trend,
        }


# Singleton instance
sentiment_analyzer = SentimentAnalyzer()
