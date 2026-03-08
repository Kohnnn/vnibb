
import json
import logging
import os
from collections.abc import AsyncGenerator
from typing import Any

try:
    from google import genai
    from google.genai import types

    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False

logger = logging.getLogger(__name__)

class LlmService:
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
        self.client = None
        self.model_name = "gemini-1.5-flash"
        self._initialized = False

        if self.api_key and HAS_GEMINI:
            try:
                self.client = genai.Client(api_key=self.api_key)
                self._initialized = True
                logger.info("LlmService initialized with Gemini 1.5 Flash")

            except Exception as e:
                logger.error(f"Failed to configure Gemini: {e}")
        else:
            if not HAS_GEMINI:
                logger.warning("google-genai package not installed.")
            elif not self.api_key:
                logger.warning("GOOGLE_API_KEY or GEMINI_API_KEY not found in environment.")

    @property
    def is_available(self) -> bool:
        """Check if the LLM service is properly configured and available."""
        return self._initialized and self.client is not None

    async def generate_response_stream(self, messages: list[dict[str, str]], context: dict[str, Any]) -> AsyncGenerator[str, None]:
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
            generation_config = types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.7,
            )

            response = await self.client.aio.models.generate_content_stream(
                model=self.model_name,
                contents=full_prompt,
                config=generation_config,
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
