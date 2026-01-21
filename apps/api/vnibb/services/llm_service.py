
import os
import logging
import json
from typing import AsyncGenerator, Dict, Any, List, Optional

try:
    import google.generativeai as genai
    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False

logger = logging.getLogger(__name__)

class LlmService:
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        self.model = None
        self._initialized = False
        
        if self.api_key and HAS_GEMINI:
            try:
                genai.configure(api_key=self.api_key)
                # Use Gemini 1.5 Flash for better performance and efficiency
                self.model = genai.GenerativeModel('gemini-1.5-flash')
                self._initialized = True
                logger.info("LlmService initialized with Gemini 1.5 Flash")

            except Exception as e:
                logger.error(f"Failed to configure Gemini: {e}")
        else:
            if not HAS_GEMINI:
                logger.warning("google-generativeai package not installed.")
            elif not self.api_key:
                logger.warning("GOOGLE_API_KEY or GEMINI_API_KEY not found in environment.")

    @property
    def is_available(self) -> bool:
        """Check if the LLM service is properly configured and available."""
        return self._initialized and self.model is not None

    async def generate_response_stream(self, messages: List[Dict[str, str]], context: Dict[str, Any]) -> AsyncGenerator[str, None]:
        """
        Generates a streaming response from the LLM based on chat history and context.
        """
        if not self.is_available:
            # Mock / Fallback response
            yield "### AI Copilot (Offline Mode)\n\n"
            yield "I am currently running in **offline mode** because I couldn't connect to the Google Gemini API.\n\n"
            yield f"**Last Query:** {messages[-1]['content'] if messages else 'None'}\n\n"
            return

        try:
            # Construct a system prompt
            system_prompt = (
                "You are VNIBB Copilot, an expert financial analyst for the Vietnam Stock Market. "
                "You answer questions based ONLY on the provided context data and your general financial knowledge. "
                "Do not hallucinate data. If the context doesn't contain the answer, say so.\n\n"
                "**Style Guidelines:**\n"
                "- Be concise and direct.\n"
                "- Use Markdown for formatting.\n"
                "- Use Vietnamese currency formatting (e.g., 100 tỷ VND) if relevant.\n\n"
            )
            
            # Context
            context_str = json.dumps(context, indent=2, default=str)
            
            # Construct full prompt with history
            # Gemini raw API is easiest with a single block for statelessness, 
            # or we can use chat session. Stateless text prompt is often more predictable for simple bots.
            
            full_prompt = f"{system_prompt}\n\nCONTEXT DATA:\n```json\n{context_str}\n```\n\nCHAT HISTORY:\n"
            
            for msg in messages:
                role = "User" if msg['role'] == 'user' else "Assistant"
                full_prompt += f"{role}: {msg['content']}\n"
            
            full_prompt += "\nAssistant:"

            # Generate
            generation_config = genai.types.GenerationConfig(
                temperature=0.7,
            )
            
            response = await self.model.generate_content_async(
                full_prompt, 
                stream=True, 
                generation_config=generation_config
            )
            
            async for chunk in response:
                if chunk.text:
                    # Optional: speed up by yielding smaller chunks if the model provides large blocks
                    yield chunk.text

        except Exception as e:
            logger.error(f"Error generating LLM response: {str(e)}")
            yield f"\n\n**Error encountered:** {str(e)}"

# Singleton
llm_service = LlmService()
