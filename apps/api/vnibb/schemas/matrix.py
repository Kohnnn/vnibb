from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Identifier = Annotated[str, Field(min_length=1, max_length=128)]
Symbol = Annotated[str, Field(pattern=r"^[A-Z0-9]{1,12}$")]
PeriodType = Literal["year", "quarter"]
ReviewState = Literal["unreviewed", "reviewed"]
ResultIds = Annotated[list[Identifier], Field(min_length=1, max_length=120)]


class MatrixModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MatrixMetric(MatrixModel):
    key: str
    label: str
    value: str | None
    display: str
    unit: str
    period: str
    as_of: str | None
    basis: str
    evidence_ids: list[str]

    @model_validator(mode="after")
    def validate_value(self):
        if self.value is not None:
            try:
                if not Decimal(self.value).is_finite():
                    raise ValueError("Matrix metrics must be finite decimals")
            except InvalidOperation as exc:
                raise ValueError("Matrix metrics must be decimal strings") from exc
        elif self.display != "Unavailable":
            raise ValueError("Missing Matrix metrics must display Unavailable")
        return self


class MatrixPayload(MatrixModel):
    kind: Literal["number", "table", "text", "classification", "source_set", "artifact", "unavailable"]
    text: str | None = None
    metrics: list[MatrixMetric] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    artifact_ref: str | None = None


class MatrixEntity(MatrixModel):
    entity_id: str
    symbol: str
    name: str
    sector: str | None


class MatrixDimension(MatrixModel):
    dimension_id: str
    label: str
    question: str
    output_type: Literal["number", "table", "text", "classification", "source_set", "artifact"]
    source_scope: str
    definition_revision: str


class MatrixCell(MatrixModel):
    result_id: str
    entity_id: str
    dimension_id: str
    result_revision: str
    state: Literal["supported", "unavailable", "non_comparable", "failed", "denied"]
    payload: MatrixPayload
    evidence_ids: list[str]
    basis: str
    limitations: list[str]
    review_state: ReviewState


class MatrixEvidence(MatrixModel):
    evidence_id: str
    entity_id: str
    source: str
    locator: str
    field: str
    value: str | None
    unit: str
    period: str
    as_of: str | None
    captured_at: str
    provenance: Literal["stored_observation", "derived"]
    formula: str | None
    input_evidence_ids: list[str]
    limitations: list[str]


class MatrixSnapshot(MatrixModel):
    schema_version: Literal["matrix-v1"]
    matrix_id: str
    snapshot_id: str
    revision: str
    created_at: str
    synthetic: bool
    anchor_symbol: str
    playbook_id: str
    definition_revision: str
    period: str
    period_type: PeriodType
    entities: list[MatrixEntity] = Field(min_length=1, max_length=10)
    dimensions: list[MatrixDimension] = Field(min_length=1, max_length=12)
    cells: list[MatrixCell] = Field(min_length=1, max_length=120)
    limitations: list[str]

    @model_validator(mode="after")
    def validate_identity(self):
        entity_ids = {entity.entity_id for entity in self.entities}
        dimension_ids = {dimension.dimension_id for dimension in self.dimensions}
        if len(entity_ids) != len(self.entities) or len(dimension_ids) != len(self.dimensions):
            raise ValueError("Matrix entity and dimension identities must be unique")
        if len({cell.result_id for cell in self.cells}) != len(self.cells):
            raise ValueError("Matrix result identities must be unique")
        if len({(cell.entity_id, cell.dimension_id) for cell in self.cells}) != len(self.cells):
            raise ValueError("Matrix coordinates must identify one result")
        if any(d.definition_revision != self.definition_revision for d in self.dimensions):
            raise ValueError("Matrix definitions must match the frozen definition revision")
        for cell in self.cells:
            if cell.entity_id not in entity_ids or cell.dimension_id not in dimension_ids:
                raise ValueError("Matrix result must reference a retained entity and dimension")
            if cell.result_revision != self.revision:
                raise ValueError("Matrix result revision must match its snapshot")
            if cell.state == "denied" and (
                cell.evidence_ids or cell.payload.metrics or cell.payload.labels
                or cell.payload.artifact_ref or cell.payload.kind != "unavailable"
            ):
                raise ValueError("Denied Matrix results must not expose payload or evidence")
        return self


class MatrixCreate(MatrixModel):
    anchor_symbol: Symbol
    symbols: list[Symbol] = Field(min_length=2, max_length=10)
    playbook_id: Identifier
    period: Annotated[str, Field(pattern=r"^\d{4}(?:-Q[1-4])?$")]
    period_type: PeriodType = "year"
    matrix_id: Identifier | None = None

    @model_validator(mode="after")
    def validate_scope(self):
        if len(set(self.symbols)) != len(self.symbols):
            raise ValueError("Companies must be unique")
        if self.anchor_symbol not in self.symbols:
            raise ValueError("The shortlist must include the anchor company")
        if (self.period_type == "year") != (len(self.period) == 4):
            raise ValueError("Period must match period_type")
        return self


class MatrixSelection(MatrixModel):
    snapshot_id: Identifier
    result_ids: ResultIds

    @model_validator(mode="after")
    def validate_unique_results(self):
        if len(set(self.result_ids)) != len(self.result_ids):
            raise ValueError("Result IDs must be unique")
        return self


class MatrixReview(MatrixModel):
    result_ids: ResultIds
    state: ReviewState

    @model_validator(mode="after")
    def validate_unique_results(self):
        if len(set(self.result_ids)) != len(self.result_ids):
            raise ValueError("Result IDs must be unique")
        return self


class MatrixResearchRequest(MatrixModel):
    snapshot_id: str
    revision: str
    entity_ids: list[str]
    dimension_ids: list[str]
    result_ids: list[str]
    period: str
    source_scope: list[str]
    request_text: str
    snapshot: MatrixSnapshot
    evidence: list[MatrixEvidence]


class MatrixPlaybook(MatrixModel):
    playbook_id: str
    label: str
    description: str
    definition_revision: str
    dimensions: list[MatrixDimension]


class MatrixPreparation(MatrixModel):
    anchor_symbol: str
    playbook_id: str
    symbols: list[str]
    peer_basis: str
    periods: list[str]
    period_type: PeriodType
    limitations: list[str]
