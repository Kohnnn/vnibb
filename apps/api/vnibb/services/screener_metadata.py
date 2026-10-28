"""Keep snapshot ratio evidence independent from retained quote provenance."""

from datetime import datetime

from sqlalchemy import JSON, String, case, cast, func, literal, update
from sqlalchemy.dialects.postgresql import JSONB

from vnibb.core.market_cap import reconcile_market_caps, resolve_market_cap
from vnibb.core.ratio_units import PERCENT_RATIO_FIELDS
from vnibb.models.screener import ScreenerSnapshot


def screener_metadata_updates(stmt, dialect_name, quote_missing):
    existing = ScreenerSnapshot.__table__.c
    incoming = stmt.excluded
    if dialect_name == "postgresql":
        def json_object(value):
            return func.coalesce(
                func.nullif(cast(value, JSONB), cast(literal("null"), JSONB)),
                cast(literal("{}"), JSONB),
            )

        old = json_object(existing.extended_metrics)
        old = case(
            (json_object(incoming.extended_metrics).has_key("shares_outstanding_provenance"),
             old.op("-")("shares_outstanding_provenance").op("-")("shares_outstanding")
                .op("-")("outstanding_shares").op("-")("sharesOutstanding")
                .op("-")("issue_share").op("-")("shares_unit").op("-")("shares_as_of")
                .op("-")("shares_source").op("-")("share_basis")),
            else_=old,
        )
        new = json_object(incoming.extended_metrics)
        non_price = new.op("-")("price_unit").op("-")("price_source")
        new = case((quote_missing, non_price), else_=new)
        new = case(
            (json_object(new.op("->")("ratio_units")).has_key("debt_assets"), new),
            else_=new.op("-")("debt_to_asset"),
        )
        units = json_object(old.op("->")("ratio_units")).op("||")(json_object(new.op("->")("ratio_units")))
        merged = old.op("||")(new).op("||")(func.jsonb_build_object("ratio_units", units))
        def has_marker(metric):
            return json_object(new.op("->")("ratio_units")).has_key(metric)

        def certified_value(metric):
            unit = new.op("->")("ratio_units").op("->>", return_type=String)(metric)
            return case((unit == "percent", incoming[metric]), else_=None)
        new_without_cap = new.op("-")("market_cap_provenance")
        merged = old.op("||")(new_without_cap).op("||")(func.jsonb_build_object("ratio_units", units))
        metadata = cast(merged, JSON)
    else:
        old = func.coalesce(func.nullif(existing.extended_metrics, "null"), "{}")
        new = func.coalesce(func.nullif(incoming.extended_metrics, "null"), "{}")
        old = case(
            (func.json_type(new, "$.shares_outstanding_provenance").is_not(None),
             func.json_remove(old, "$.shares_outstanding_provenance", "$.shares_outstanding",
                              "$.outstanding_shares", "$.sharesOutstanding", "$.issue_share",
                              "$.shares_unit", "$.shares_as_of", "$.shares_source", "$.share_basis")),
            else_=old,
        )
        new = case(
            (quote_missing, func.json_remove(new, "$.price_unit", "$.price_source")),
            else_=new,
        )
        new = case(
            (func.json_type(new, "$.ratio_units.debt_assets").is_not(None), new),
            else_=func.json_remove(new, "$.debt_to_asset"),
        )
        metadata = func.json_patch(old, func.json_remove(new, "$.market_cap_provenance"))
        def has_marker(metric):
            return func.json_type(new, f"$.ratio_units.{metric}").is_not(None)

        def certified_value(metric):
            return case((func.json_extract(new, f"$.ratio_units.{metric}") == "percent", incoming[metric]), else_=None)

    updates = {
        "extended_metrics": metadata,
        "market_cap": existing.market_cap,
    }
    for metric in PERCENT_RATIO_FIELDS:
        if metric in existing:
            updates[metric] = case(
                (has_marker(metric), certified_value(metric)),
                else_=existing[metric],
            )
    return updates


async def reconcile_snapshot_cap(session, stored, incoming, *, without_fallback=None):
    """Reconcile under the row lock acquired by the preceding upsert."""
    incoming_metrics = incoming.get("extended_metrics") or {}
    incoming_cap = incoming_metrics.get("market_cap_provenance")
    if incoming_cap is None:
        return stored
    metrics = dict(stored.get("extended_metrics") or {})
    old_cap = metrics.get("market_cap_provenance")
    if without_fallback is not None and (old_cap is not None or stored.get("market_cap") is not None):
        incoming_cap = without_fallback
        incoming = {**incoming, "market_cap": without_fallback["value"]}
        if not incoming_cap["observations"] and incoming_cap["status"] != "conflict":
            return stored
    old = resolve_market_cap({"market_cap": stored.get("market_cap"),
                              "market_cap_provenance": old_cap}, source="postgres:screener_snapshot")
    new = resolve_market_cap({"market_cap": incoming.get("market_cap"),
                              "market_cap_provenance": incoming_cap}, source="incoming:screener_snapshot")
    cap = reconcile_market_caps(old, new)
    if (isinstance(incoming_cap, dict) and incoming_cap.get("carried_forward") is True
            and not old["observations"] and old["status"] != "conflict"):
        cap["carried_forward"] = True
    if (isinstance(old_cap, dict) and old_cap.get("carried_forward") is True
            and new["status"] != "available"):
        cap["carried_forward"] = True
    if isinstance(old_cap, dict) and old_cap.get("carried_forward") is True and new["status"] == "available":
        observations = old["observations"]
        value_observations = [item for item in observations if item.get("value") is not None]
        try:
            cutoff = datetime.fromisoformat(new["as_of"]).date()
            historical = bool(value_observations) and not any(item.get("shares_conflict") for item in observations) and all(
                isinstance(item.get("as_of"), str)
                and datetime.fromisoformat(item["as_of"].replace("Z", "+00:00")).date() < cutoff
                for item in value_observations
            )
        except (TypeError, ValueError):
            historical = False
        if historical:
            cap = new
    metrics["market_cap_provenance"] = cap
    await session.execute(
        update(ScreenerSnapshot).where(
            ScreenerSnapshot.symbol == stored["symbol"],
            ScreenerSnapshot.snapshot_date == stored["snapshot_date"],
        ).values(market_cap=cap["value"], extended_metrics=metrics)
    )
    return {**stored, "market_cap": cap["value"], "extended_metrics": metrics}
