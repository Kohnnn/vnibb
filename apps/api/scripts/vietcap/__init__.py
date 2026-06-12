"""Vietcap IQ / trading.vietcap.com.vn read-only ingestion package.

Standalone backfill utilities that pull public, auth-free Vietcap market and
fundamental data into the canonical n6v MongoDB ``vnibb-market`` database.

Vietcap is treated as the PRIMARY source. Where it overlaps existing
``vnstock-data`` rows, Vietcap wins (see ``dedup`` step in backfill_vietcap).

See ``vnibb/docs/VIETCAP_DATA_SOURCE.md`` for the full data contract.
"""
