"""Keep snapshot ratio evidence independent from retained quote provenance."""

from sqlalchemy import JSON, String, case, cast, func, literal
from sqlalchemy.dialects.postgresql import JSONB

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
        metadata = cast(merged, JSON)
    else:
        old = func.coalesce(func.nullif(existing.extended_metrics, "null"), "{}")
        new = func.coalesce(func.nullif(incoming.extended_metrics, "null"), "{}")
        new = case(
            (quote_missing, func.json_remove(new, "$.price_unit", "$.price_source")),
            else_=new,
        )
        new = case(
            (func.json_type(new, "$.ratio_units.debt_assets").is_not(None), new),
            else_=func.json_remove(new, "$.debt_to_asset"),
        )
        metadata = func.json_patch(old, new)
        def has_marker(metric):
            return func.json_type(new, f"$.ratio_units.{metric}").is_not(None)

        def certified_value(metric):
            return case((func.json_extract(new, f"$.ratio_units.{metric}") == "percent", incoming[metric]), else_=None)

    updates = {"extended_metrics": metadata}
    for metric in PERCENT_RATIO_FIELDS:
        if metric in existing:
            updates[metric] = case(
                (has_marker(metric), certified_value(metric)),
                else_=existing[metric],
            )
    return updates
