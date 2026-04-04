from __future__ import annotations

import io
import logging
from typing import Any

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - optional dependency at runtime
    PdfReader = None

logger = logging.getLogger(__name__)

MAX_DOCUMENT_TEXT_LENGTH = 12000
SUPPORTED_TEXT_TYPES = {
    "text/plain",
    "text/markdown",
    "application/json",
}


class AIDocumentService:
    def _truncate_text(self, value: str) -> str:
        text = str(value or "").strip()
        if len(text) <= MAX_DOCUMENT_TEXT_LENGTH:
            return text
        return f"{text[:MAX_DOCUMENT_TEXT_LENGTH]}..."

    def _extract_text(
        self, filename: str, content_type: str | None, content: bytes
    ) -> tuple[str, str]:
        normalized_type = str(content_type or "").strip().lower()
        normalized_name = str(filename or "document").strip()

        if normalized_type == "application/pdf" or normalized_name.lower().endswith(".pdf"):
            if PdfReader is None:
                raise ValueError(
                    "PDF support is unavailable on this runtime. Install pypdf to enable PDF ingestion."
                )
            reader = PdfReader(io.BytesIO(content))
            extracted_pages = [page.extract_text() or "" for page in reader.pages[:25]]
            return self._truncate_text("\n\n".join(extracted_pages)), "pdf"

        if normalized_type in SUPPORTED_TEXT_TYPES or normalized_name.lower().endswith(
            (".txt", ".md", ".json")
        ):
            decoded = content.decode("utf-8", errors="ignore")
            return self._truncate_text(decoded), "text"

        raise ValueError("Unsupported document type. Upload PDF, TXT, MD, or JSON files.")

    async def ingest_document(
        self,
        *,
        filename: str,
        content_type: str | None,
        content: bytes,
    ) -> dict[str, Any]:
        text, doc_type = self._extract_text(filename, content_type, content)
        if not text:
            raise ValueError("Document contains no extractable text.")

        lines = [line.strip() for line in text.splitlines() if line.strip()][:12]
        return {
            "id": f"doc-{abs(hash((filename, len(content), doc_type))) % 10_000_000}",
            "filename": filename,
            "contentType": content_type,
            "documentType": doc_type,
            "text": text,
            "preview": " ".join(lines)[:320],
            "charCount": len(text),
        }


ai_document_service = AIDocumentService()
