import google.generativeai as genai
import logging
from typing import List, Dict, Optional
from vnibb.core.config import settings

logger = logging.getLogger(__name__)

class AIAnalysisService:
    def __init__(self):
        if not settings.gemini_api_key:
            logger.warning("GEMINI_API_KEY not set. AI features will be disabled.")
            self.enabled = False
            return
        
        try:
            genai.configure(api_key=settings.gemini_api_key)
            self.model = genai.GenerativeModel(settings.llm_model)
            self.enabled = True
        except Exception as e:
            logger.error(f"Failed to initialize Gemini AI: {e}")
            self.enabled = False
    
    async def analyze_stock(self, symbol: str, stock_data: dict, question: Optional[str] = None) -> str:
        if not self.enabled:
            return "AI Analysis is currently disabled. Please configure GEMINI_API_KEY."
            
        prompt = self._build_analysis_prompt(symbol, stock_data, question)
        try:
            response = await self.model.generate_content_async(prompt)
            return response.text
        except Exception as e:
            logger.error(f"Gemini analysis failed: {e}")
            return f"Error during AI analysis: {str(e)}"
    
    async def chat(self, message: str, history: list, context_data: Optional[dict] = None) -> str:
        if not self.enabled:
            return "AI Chat is currently disabled."
            
        try:
            # We can prepend context to the message if context_data is provided
            full_message = message
            if context_data:
                full_message = f"Context Data: {context_data}\n\nUser Question: {message}"
                
            chat = self.model.start_chat(history=history)
            response = await chat.send_message_async(full_message)
            return response.text
        except Exception as e:
            logger.error(f"Gemini chat failed: {e}")
            return f"Error during AI chat: {str(e)}"

    def _build_analysis_prompt(self, symbol: str, data: dict, question: Optional[str] = None) -> str:
        base_prompt = f"""
        You are a senior financial analyst specialized in the Vietnam Stock Market.
        Analyze the following data for ticker {symbol.upper()}:
        
        DATA SNAPSHOT:
        {data}
        
        INSTRUCTIONS:
        1. Provide a concise summary of the company's current valuation.
        2. Identify key risks and opportunities based on the provided metrics.
        3. Rate the stock as 'Bullish', 'Neutral', or 'Bearish' based on the data.
        4. Use professional, objective language.
        
        {f'USER SPECIFIC QUESTION: {question}' if question else ''}
        
        OUTPUT FORMAT: Markdown.
        """
        return base_prompt

# Singleton instance
ai_service = AIAnalysisService()
