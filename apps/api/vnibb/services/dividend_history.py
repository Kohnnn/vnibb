"""Consumer-side admission over retained rows; not a provider or a completeness check.

A typed Dividend column can describe a retained observation, not certify that a
payment occurred. CompanyEvent amounts need a retained evidence envelope: source
namespace, source_event_id, verified status, fiscal entitlement and typed terms.
Neither a similarity match nor the order rows were ingested establishes identity.
"""

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from vnibb.models.news import CompanyEvent, Dividend

DistributionType = Literal["cash", "stock", "mixed"]
DividendStatus = Literal["observed", "announced", "scheduled", "confirmed", "paid"]
ActionDateType = Literal["ex_date", "record_date", "payment_date"]
ACTION_DATES: tuple[ActionDateType, ...] = ("ex_date", "record_date", "payment_date")
RAW_DIVIDEND_SCOPE = "unreconciled_observations"
ADMITTED_DIVIDEND_SCOPE = "retained_observations"
DISCREPANCY_LIMIT = 20

_TYPE_ALIASES: dict[str, DistributionType] = {
    "cash": "cash", "cash_dividend": "cash", "dividend_cash": "cash",
    "tiền_mặt": "cash", "tiền": "cash", "tm": "cash",
    "stock": "stock", "stock_dividend": "stock", "dividend_stock": "stock",
    "cổ_phiếu": "stock", "cp": "stock",
    "mixed": "mixed", "mixed_dividend": "mixed", "cash_and_stock_dividend": "mixed",
}
_ACTIVE_STATUSES = {"announced", "scheduled", "confirmed", "paid"}
_CANCELLED_STATUSES = {"cancelled", "canceled"}
# The historical fetcher's flat shape erased the source aliases for cash, payment and fiscal year.
_LOSSY_DIVIDEND_FIELDS = {"dividend_type", "cash_dividend", "stock_dividend", "issue_year"}
_DATE_ALIASES = {
    "ex_date": ("ex_date", "exDate", "exright_date", "exRightDate"),
    "record_date": ("record_date", "recordDate", "ngayDKCC"),
    "payment_date": ("payment_date", "paymentDate", "payout_date", "ngayThanhToan"),
}


class DividendDistribution(BaseModel):
    symbol: str
    type: DistributionType
    dividend_type: DistributionType
    fiscal_year: int | None = None
    issue_year: int | None = None
    year: int | None = None  # Compatibility: fiscal entitlement only, never the action year.
    status: DividendStatus
    ex_date: date | None = None
    record_date: date | None = None
    payment_date: date | None = None
    published_at: str | None = None
    event_date: date | None = None
    cash_dividend: float | None = None
    currency: Literal["VND"] | None = None
    cash_unit: Literal["VND/share"] | None = None
    stock_dividend: float | None = Field(None, description="Percent of existing shares, not cash")
    stock_unit: Literal["percent_of_existing_shares"] | None = None
    dividend_ratio: float | None = Field(None, description="Reported cash rate as percent of par")
    annual_dps: None = None
    dividend_yield: None = None
    observation_basis: Literal["retained_dividend_record", "verified_event"]
    dataset: Literal["dividends", "company_events"]
    observation_id: int
    source: str | None = None
    source_event_id: str | None = None
    source_url: str | None = None
    revision: int | None = None
    description: str | None = None


class DividendDiscrepancy(BaseModel):
    code: str
    dataset: Literal["dividends", "company_events"]
    observation_id: int
    source: str | None = None
    source_event_id: str | None = None
    revision: int | None = None
    distribution_type: DistributionType | None = None
    fiscal_year: int | None = None
    observed_date: date | None = None
    observed_date_type: ActionDateType | Literal["event_date", "publication_date"] | None = None


class DividendCoverage(BaseModel):
    scope: Literal["retained_observations"] = ADMITTED_DIVIDEND_SCOPE
    status: Literal["partial", "unavailable"] = "unavailable"
    latest_covered_date: date | None = None
    latest_covered_date_type: ActionDateType | None = None
    admitted_count: int = 0
    discrepancy_count: int = 0
    discrepancies: list[DividendDiscrepancy] = Field(default_factory=list)
    payout_window_certified: Literal[False] = False
    annual_dps_unavailable_reason: Literal["uncertified_payout_window"] = "uncertified_payout_window"
    yield_unavailable_reason: Literal["uncertified_payout_window_and_price_basis"] = (
        "uncertified_payout_window_and_price_basis"
    )


@dataclass(frozen=True)
class DividendHistory:
    rows: list[DividendDistribution]
    coverage: DividendCoverage


def _text(value: object) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _token(value: object) -> str:
    return "_".join((_text(value) or "").lower().replace("-", " ").split())


def _integer(value: object) -> int | None:
    if type(value) is int:
        return value
    if isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) <= 10:
        return int(value)
    return None


def _year(value: object) -> int | None:
    year = _integer(value)
    return year if year is not None and 1900 <= year <= 2100 else None


def _amount(value: object) -> float | None:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (ValueError, OverflowError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def _source_url(value: object) -> str | None:
    url = _text(value)
    if not url:
        return None
    try:
        parsed = urlsplit(url)
        if parsed.scheme in {"http", "https"} and parsed.hostname and parsed.username is None:
            return url
    except ValueError:
        pass
    return None


def _source_datetime(value: object) -> str | None:
    text = _text(value)
    if not text:
        return None
    try:
        if len(text) == 10:
            date.fromisoformat(text)
        else:
            datetime.fromisoformat(text)
    except ValueError:
        return None
    return text


def _day(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _source_datetime(value)
    if text:
        return date.fromisoformat(text) if len(text) == 10 else datetime.fromisoformat(text).date()
    # These are explicit DD/MM/YYYY date aliases in the company-event input.
    if isinstance(value, str):
        try:
            return datetime.strptime(value.strip(), "%d/%m/%Y").date()
        except ValueError:
            pass
    return None


def _latest_action(dates: dict[ActionDateType, date | None]) -> tuple[date | None, ActionDateType | None]:
    present = [(value, key) for key, value in dates.items() if value is not None]
    return max(present, key=lambda item: item[0]) if present else (None, None)


def _raw(row: CompanyEvent | Dividend) -> dict[str, Any]:
    return row.raw_data if isinstance(row.raw_data, dict) else {}


def is_dividend_candidate(event_type: str, raw: dict[str, Any], description: str | None) -> bool:
    """Identify candidates for review, never infer payout type from prose."""
    return any(
        token in _TYPE_ALIASES or token in {"div", "dividend"} or "dividend" in token
        for token in map(_token, (
            event_type, raw.get("event_code"), raw.get("action_subtype"), raw.get("action_category"),
            raw.get("dividend_type"),
        ))
    ) or any(
        word in (_text(value) or "").lower()
        for value in (description, raw.get("event_name"), raw.get("event_title_vi"))
        for word in ("cổ tức", "co tuc", "dividend")
    )


@dataclass(frozen=True)
class _Observation:
    row: CompanyEvent | Dividend
    raw: dict[str, Any]
    dates: dict[ActionDateType, date | None]
    kind: DistributionType | None
    fiscal_year: int | None
    issue_year: int | None
    status: str
    source: str | None
    event_id: str | None
    revision: int | None
    conflict: str | None

    @property
    def retained(self) -> bool:
        return isinstance(self.row, Dividend)

    @property
    def dataset(self) -> Literal["dividends", "company_events"]:
        return "dividends" if self.retained else "company_events"

    @property
    def identity(self) -> tuple[str, str] | None:
        if self.source and self.event_id and self.raw.get("verified") is True:
            return self.source.casefold(), self.event_id
        return None

    def discrepancy(self, code: str) -> DividendDiscrepancy:
        day, basis = _latest_action(self.dates)
        if day is None:
            if isinstance(self.row, CompanyEvent) and self.row.event_date:
                day, basis = self.row.event_date, "event_date"
            elif published := _day(self.raw.get("published_at") or self.raw.get("public_date")):
                day, basis = published, "publication_date"
        return DividendDiscrepancy(
            code=code, dataset=self.dataset, observation_id=self.row.id,
            source=self.source, source_event_id=self.event_id, revision=self.revision,
            distribution_type=self.kind, fiscal_year=self.fiscal_year,
            observed_date=day, observed_date_type=basis,
        )


def _typed_dates(
    raw: dict[str, Any], stored: dict[ActionDateType, date | None], *, lossy_projection: bool,
) -> tuple[dict[ActionDateType, date | None], bool]:
    dates = {}
    conflict = False
    for role, column in stored.items():
        basis = raw.get(f"{role}_basis")
        supplied = [_day(raw[key]) for key in _DATE_ALIASES[role] if raw.get(key) not in (None, "")]
        reported_day = column or next((day for day in supplied if day is not None), None)
        # Only the lossy legacy projection can make a publication/issue date
        # look like a typed payment date. Native dates can legitimately agree.
        ambiguous_payment = role == "payment_date" and lossy_projection and reported_day is not None and not any(
            _day(raw.get(key)) == reported_day for key in _DATE_ALIASES[role][1:]
        )
        if (basis is not None and basis != role) or (ambiguous_payment and basis != role):
            dates[role], conflict = None, True
        elif None in supplied or len(set(supplied + ([column] if column else []))) > 1:
            dates[role], conflict = None, True
        else:
            dates[role] = column or (supplied[0] if supplied else None)
    known = [day for day in dates.values() if day is not None]
    return dates, conflict or known != sorted(known)


def _observation(row: CompanyEvent | Dividend) -> _Observation:
    raw = _raw(row)
    retained = isinstance(row, Dividend)
    lossy_projection = _LOSSY_DIVIDEND_FIELDS <= raw.keys()
    method = row.issue_method if retained else row.event_type
    kinds = {
        kind for value in (method, raw.get("action_subtype"), raw.get("dividend_type"))
        if (kind := _TYPE_ALIASES.get(_token(value))) is not None
    }
    kind = next(iter(kinds)) if len(kinds) == 1 else None
    status = _token(raw.get("status")) or ("observed" if retained and raw.get("status") is None else "")
    if status in _CANCELLED_STATUSES or (not retained and _token(method) in _CANCELLED_STATUSES):
        status = "cancelled"
    revision = _integer(raw.get("revision"))
    fiscal_year, issue_year = _year(raw.get("fiscal_year")), _year(raw.get("issue_year"))
    if retained and not lossy_projection and raw.get("fiscal_year") is None and issue_year is None:
        fiscal_year = _year(row.cash_year)
    dates, date_conflict = _typed_dates(raw, {
        "ex_date": row.exercise_date if retained else row.ex_date,
        "record_date": row.record_date, "payment_date": row.payment_date,
    }, lossy_projection=lossy_projection)
    conflict = None
    if raw.get("symbol") is not None and (_text(raw.get("symbol")) or "").upper() != row.symbol:
        conflict = "issuer_mismatch"
    elif raw.get("revision") is not None and (revision is None or revision < 0):
        conflict = "unverified_revision"
    elif len(kinds) > 1:
        conflict = "conflicting_observations"
    elif (
        (raw.get("fiscal_year") is not None and fiscal_year is None)
        or (raw.get("issue_year") is not None and issue_year is None)
        or (retained and not lossy_projection and raw.get("fiscal_year") is not None
            and row.cash_year not in (None, fiscal_year))
    ):
        conflict = "unverified_fiscal_entitlement"
    elif date_conflict:
        conflict = "conflicting_date_basis"
    event_id = raw.get("source_event_id")
    return _Observation(
        row, raw, dates, kind, fiscal_year, issue_year, status, _text(raw.get("source")),
        str(event_id) if type(event_id) is int else _text(event_id), revision, conflict,
    )


def _admit(item: _Observation) -> tuple[DividendDistribution | None, str | None]:
    row, raw, kind = item.row, item.raw, item.kind
    if item.conflict in {"issuer_mismatch", "unverified_revision"}:
        return None, item.conflict
    legacy = item.retained and item.status == "observed"
    if raw.get("verified") is False or (not item.retained and raw.get("verified") is not True):
        return None, "unverified_event"
    if not legacy and item.identity is None:
        return None, "unverified_event_identity"
    if item.status == "cancelled":
        return None, "cancelled_event"
    if item.status not in _ACTIVE_STATUSES and not legacy:
        return None, "unverified_status"
    if item.conflict:
        return None, item.conflict
    if kind is None:
        return None, "unsupported_distribution_type"
    if not legacy and item.fiscal_year is None:
        return None, "unverified_fiscal_entitlement"
    if not any(item.dates.values()):
        return None, "missing_action_date"

    cash = _amount(raw.get("cash_dividend"))
    stock = _amount(raw.get("stock_dividend_percent"))
    typed_stock = _amount(raw.get("stock_dividend")) if raw.get("stock_dividend_unit") == "percent" else None
    if raw.get("cash_dividend") is not None and cash is None:
        return None, "unsupported_cash_basis"
    if (raw.get("stock_dividend_percent") is not None and stock is None) or (
        raw.get("stock_dividend_unit") == "percent" and raw.get("stock_dividend") is not None and typed_stock is None
    ):
        return None, "unsupported_stock_basis"
    if stock is not None and typed_stock is not None and stock != typed_stock:
        return None, "conflicting_observations"
    stock = stock if stock is not None else typed_stock
    if isinstance(row, Dividend) and cash is not None and row.dividend_value not in (None, cash):
        return None, "conflicting_observations"
    currency, unit = raw.get("currency"), raw.get("value_unit")
    cash_rate = None
    if kind in ("cash", "mixed"):
        # The typed legacy column is readable as an observation, not as a notice.
        # An unqualified raw amount itself cannot establish VND/share.
        if legacy and isinstance(row, Dividend) and not _LOSSY_DIVIDEND_FIELDS <= raw.keys() and (
            currency in (None, "VND") and unit in (None, "VND/share")
        ):
            if cash is None or currency is None or unit is None:
                cash = _amount(row.dividend_value)
            if not raw or raw.get("dividend_ratio_basis") == "percent_of_par":
                cash_rate = _amount(row.dividend_rate)
        elif currency != "VND" or unit != "VND/share":
            return None, "unsupported_cash_basis"
        if cash is None and isinstance(row, Dividend) and not _LOSSY_DIVIDEND_FIELDS <= raw.keys():
            cash = _amount(row.dividend_value)
        if cash is None:
            return None, "unsupported_cash_basis"
    elif cash not in (None, 0) or (isinstance(row, Dividend) and row.dividend_value not in (None, 0)):
        return None, "conflicting_observations"
    if kind in ("stock", "mixed") and stock is None:
        return None, "unsupported_stock_basis"
    if kind == "cash" and stock not in (None, 0):
        return None, "conflicting_observations"

    return DividendDistribution(
        symbol=row.symbol, type=kind, dividend_type=kind, fiscal_year=item.fiscal_year,
        issue_year=item.issue_year, year=item.fiscal_year, status=item.status, **item.dates,
        published_at=_source_datetime(raw.get("published_at") or raw.get("public_date")),
        event_date=row.event_date if isinstance(row, CompanyEvent) else None,
        cash_dividend=cash if kind != "stock" else None,
        currency="VND" if kind != "stock" else None, cash_unit="VND/share" if kind != "stock" else None,
        stock_dividend=stock if kind != "cash" else None, dividend_ratio=cash_rate,
        stock_unit="percent_of_existing_shares" if kind != "cash" else None,
        observation_basis="retained_dividend_record" if legacy else "verified_event",
        dataset=item.dataset, observation_id=row.id,
        source=item.source, source_event_id=item.event_id, revision=item.revision,
        source_url=_source_url(raw.get("source_url")),
        description=_text(raw.get("description")) or (_text(row.description) if isinstance(row, CompanyEvent) else None),
    ), None


def _terms(row: DividendDistribution) -> tuple:
    # Event/publication dates and descriptions can differ between aliases of
    # the same notice. They aren't evidence of a new payout or a new revision.
    return tuple(getattr(row, field) for field in (
        "type", "status", "fiscal_year", "issue_year", *ACTION_DATES,
        "cash_dividend", "currency", "stock_dividend", "dividend_ratio",
    ))


def _resolve_identity(group: list[_Observation]) -> tuple[_Observation, DividendDistribution | None, str | None]:
    first = group[0]
    if len(group) > 1:
        for field in ("kind", "fiscal_year"):
            if len({getattr(item, field) for item in group if getattr(item, field) is not None}) > 1:
                return first, None, "conflicting_observations"
        revisions = {item.revision for item in group}
        if len(revisions) > 1 and (None in revisions or any(item.conflict == "unverified_revision" for item in group)):
            return first, None, "unverified_revision"
        if None not in revisions:
            latest = max(revision for revision in revisions if revision is not None)
            group = [item for item in group if item.revision == latest]
    reviewed = [(item, *_admit(item)) for item in group]
    item, row, reason = reviewed[0]
    if any((other_reason, _terms(other) if other else None) != (reason, _terms(row) if row else None)
           for _, other, other_reason in reviewed[1:]):
        return item, None, "conflicting_observations"
    return item, row, reason


def _admitted_observations(
    observations: list[_Observation],
) -> tuple[list[tuple[_Observation, DividendDistribution]], list[DividendDiscrepancy]]:
    grouped: dict[tuple[str, str], list[_Observation]] = defaultdict(list)
    singletons = []
    discrepancies = []
    for item in observations:
        if item.conflict == "issuer_mismatch":
            discrepancies.append(item.discrepancy("issuer_mismatch"))
        elif item.identity is None:
            singletons.append([item])
        else:
            grouped[item.identity].append(item)
    admitted = []
    for group in [*grouped.values(), *singletons]:
        item, row, reason = _resolve_identity(group)
        if row is not None:
            admitted.append((item, row))
        else:
            discrepancies.append(item.discrepancy(reason or "unverified_event"))
    return admitted, discrepancies


def _unlinked_overlap(
    admitted: list[tuple[_Observation, DividendDistribution]],
) -> tuple[list[tuple[_Observation, DividendDistribution]], list[DividendDiscrepancy]]:
    """Withhold apparent duplicates rather than guessing at event identity.

    A lone legacy row can remain a retained observation. Explicitly distinct
    identities within one source can share the same action days.
    """
    by_date: dict[tuple[DistributionType, ActionDateType, date], list[_Observation]] = defaultdict(list)
    for item, row in admitted:
        for role, day in item.dates.items():
            if day is not None:
                for kind in ("cash", "stock") if row.type == "mixed" else (row.type,):
                    by_date[(kind, role, day)].append(item)
    rows, discrepancies = [], []
    for item, row in admitted:
        kinds = ("cash", "stock") if row.type == "mixed" else (row.type,)
        overlaps = {
            other.row for kind in kinds
            for role, day in item.dates.items() if day is not None
            for other in by_date[(kind, role, day)]
            if other is not item
            and (item.fiscal_year is None or other.fiscal_year in (None, item.fiscal_year))
            and (item.identity is None or other.identity is None or item.identity[0] != other.identity[0])
        }
        if overlaps:
            discrepancies.append(item.discrepancy("ambiguous_event_identity"))
        if not overlaps or (
            row.observation_basis == "retained_dividend_record"
            and not any(isinstance(other, Dividend) for other in overlaps)
        ):
            rows.append((item, row))
    return rows, discrepancies


async def load_dividend_history(db: AsyncSession, symbol: str, limit: int) -> DividendHistory:
    """Resolve both symbol-scoped stores before applying the presentation limit."""
    retained = (await db.scalars(select(Dividend).where(Dividend.symbol == symbol).order_by(Dividend.id))).all()
    events = (await db.scalars(select(CompanyEvent).where(CompanyEvent.symbol == symbol).order_by(CompanyEvent.id))).all()
    observations = [_observation(row) for row in retained]
    lifecycle = []
    for row in events:
        raw = _raw(row)
        if is_dividend_candidate(row.event_type, raw, row.description):
            observations.append(_observation(row))
        elif any(_token(value) in _CANCELLED_STATUSES for value in (row.event_type, raw.get("status"))):
            lifecycle.append(_observation(row))
    identities = {item.identity for item in observations if item.identity and item.conflict != "issuer_mismatch"}
    observations.extend(item for item in lifecycle if item.identity and item.identity in identities)
    admitted, discrepancies = _admitted_observations(observations)
    admitted, overlaps = _unlinked_overlap(admitted)
    discrepancies.extend(overlaps)
    admitted.sort(key=lambda pair: _latest_action(pair[0].dates)[0] or date.min, reverse=True)
    discrepancies.sort(key=lambda item: item.observed_date or date.min, reverse=True)
    latest, basis = _latest_action(admitted[0][0].dates) if admitted else (None, None)
    return DividendHistory(
        rows=[row for _, row in admitted[:limit]],
        coverage=DividendCoverage(
            status="partial" if admitted else "unavailable",
            latest_covered_date=latest, latest_covered_date_type=basis,
            admitted_count=len(admitted), discrepancy_count=len(discrepancies),
            discrepancies=discrepancies[:DISCREPANCY_LIMIT],
        ),
    )
