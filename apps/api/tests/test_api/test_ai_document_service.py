from __future__ import annotations

import pytest

from vnibb.services.ai_document_service import AIDocumentService


@pytest.mark.asyncio
async def test_ai_document_service_ingests_text_documents():
    service = AIDocumentService()

    document = await service.ingest_document(
        filename="note.txt",
        content_type="text/plain",
        content=b"This is a short research note about VCI and its valuation.",
    )

    assert document["filename"] == "note.txt"
    assert document["documentType"] == "text"
    assert "VCI" in document["text"]


@pytest.mark.asyncio
async def test_ai_document_service_rejects_unsupported_types():
    service = AIDocumentService()

    with pytest.raises(ValueError, match="Unsupported document type"):
        await service.ingest_document(
            filename="image.png",
            content_type="image/png",
            content=b"png-data",
        )
