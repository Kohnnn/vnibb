import os

NON_GRANTABLE_SUPPLIERS = frozenset({"unknown", "vnstock", "vnstock_ratio"})


def allowlisted_matrix_sources() -> set[str]:
    sources = {source.strip() for source in os.getenv("MATRIX_EXPORT_ALLOWED_SOURCES", "").split(",") if source.strip()}
    return {source for source in sources
            if source.rsplit(":", 1)[-1] not in NON_GRANTABLE_SUPPLIERS
            and not (source.startswith("stored.sql.") and ":" not in source)}
