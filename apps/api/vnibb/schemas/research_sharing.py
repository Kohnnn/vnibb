"""Frozen research transfer contracts; no executable or model instruction fields."""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_RESEARCH_BUNDLE_BYTES = 5 * 1024 * 1024
MAX_RESEARCH_SHARES = 100
MAX_SHARE_DAYS = 30


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ThesisCitation(StrictModel):
    itemId: str = Field(pattern=r"^nb:[^\s]{1,200}$")
    title: str = Field(min_length=1, max_length=300)
    capturedAt: str = Field(max_length=100)
    source: str | None = Field(default=None, min_length=1, max_length=200)
    url: str | None = Field(default=None, min_length=1, max_length=2048)
    sourceId: str | None = Field(default=None, min_length=1, max_length=300)
    symbol: str | None = Field(default=None, min_length=1, max_length=40)
    asOf: str | None = Field(default=None, min_length=1, max_length=100)


class InvestmentThesis(StrictModel):
    status: Literal["researching", "watching", "active", "closed"]
    thesis: str
    catalysts: str
    risks: str
    invalidation: str
    reviewDate: str = Field(pattern=r"^(?:\d{4}-\d{2}-\d{2})?$")
    notebookItemIds: list[str] | None = Field(default=None, min_length=1, max_length=50)
    citations: list[ThesisCitation] | None = Field(default=None, min_length=1, max_length=50)


class BundledThesis(StrictModel):
    symbol: str = Field(pattern=r"^[A-Z0-9]{3}$")
    thesis: InvestmentThesis
    note: str | None = None


class NotebookSource(StrictModel):
    id: str | None = None
    label: str | None = None
    url: str | None = None
    sourceUrl: str | None = None
    feedUrl: str | None = None
    sourceName: str | None = None
    sourceSystem: str | None = None
    asOf: str | None = None
    publishedAt: str | None = None


class NotebookAgent(StrictModel):
    provider: str | None = None
    model: str | None = None


class NotebookArtifact(StrictModel):
    artifactId: str | None = None
    responseId: str | None = None
    artifactType: str | None = None


class NotebookItem(StrictModel):
    id: str = Field(pattern=r"^nb:[^\s]{1,200}$")
    kind: Literal["news", "widget_snapshot", "agent_answer", "note", "artifact"]
    title: str = Field(min_length=1)
    body: str | None = None
    symbol: str | None = None
    tags: list[str] | None = None
    sources: list[NotebookSource] | None = None
    agent: NotebookAgent | None = None
    artifact: NotebookArtifact | None = None
    dedupeKey: str | None = None
    provenance: dict | None = None
    createdAt: str


class ResearchBundle(StrictModel):
    format: Literal["vnibb-thesis-evidence"]
    version: Literal[1]
    createdAt: str
    theses: list[BundledThesis] = Field(min_length=1, max_length=50)
    items: list[NotebookItem] = Field(max_length=200)

    @field_validator("version", mode="before")
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError("Unsupported research bundle version")
        return value


class ResearchShareCreate(StrictModel):
    bundle: ResearchBundle
    recipient_ids: list[str] = Field(min_length=1, max_length=20)
    expires_at: str


class ResearchShareSummary(BaseModel):
    share_id: UUID
    owner_id: UUID
    recipient_ids: list[UUID]
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
    thesis_count: int
    evidence_count: int


class ResearchShareRead(ResearchShareSummary):
    bundle: ResearchBundle
