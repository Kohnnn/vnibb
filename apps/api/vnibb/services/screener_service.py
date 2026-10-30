"""
Screener Service - Dedicated service for screener data synchronization.

Extracts logic from DataPipeline to avoid circular dependency issues.
"""

import logging
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from vnibb.core.config import settings
from vnibb.core.database import async_session_maker
from vnibb.core.market_cap import resolve_market_cap
from vnibb.core.price_units import normalize_screener_record
from vnibb.core.ratio_units import PERCENT_RATIO_FIELDS
from vnibb.models.screener import ScreenerSnapshot
from vnibb.providers.vnstock.equity_screener import StockScreenerParams, VnstockScreenerFetcher
from vnibb.services.screener_metadata import reconcile_snapshot_cap, screener_metadata_updates

logger = logging.getLogger(__name__)


class ScreenerService:
    """
    Dedicated service for syncing screener data.
    """

    async def sync_screener_data(
        self,
        exchanges: list[str] = None,
        limit: int = 1700,
    ) -> int:
        """
        Sync stock screener data using robust VCI source logic.

        Returns: Number of screener records synced
        """
        logger.info(
            f"Starting screener data sync ({settings.vnstock_source}) via ScreenerService..."
        )

        try:
            if exchanges is None:
                exchanges = ["HOSE", "HNX", "UPCOM"]

            total_count = 0
            # We process exchanges one by one or collectively depends on fetcher
            # Here we loop to ensure we get data from all requested exchanges
            for exchange in exchanges:
                params = StockScreenerParams(
                    exchange=exchange, limit=limit, source=settings.vnstock_source
                )

                # Fetch data using the robust sym-by-sym logic in VnstockScreenerFetcher
                data = await VnstockScreenerFetcher.fetch(params)

                if not data:
                    logger.warning(f"No screener data found for exchange: {exchange}")
                    continue

                async with async_session_maker() as session:
                    count = 0
                    for item in data:
                        # Use upsert logic
                        # We map all available fields from the fetcher's model to our DB model.
                        # Note: We need to ensure we map fields correctly.
                        cap = resolve_market_cap(item, source="vnstock:screener_sync")

                        values = {
                            "symbol": item.symbol,
                            "snapshot_date": datetime.utcnow().date(),
                            "company_name": getattr(item, "organ_name", None)
                            or getattr(item, "company_name", None),
                            "market_cap": cap["value"],
                            "pe": item.pe,
                            "pb": item.pb,
                            "roe": item.roe,
                            "exchange": item.exchange or exchange,
                            "industry": getattr(item, "industry_name", None)
                            or getattr(item, "industry", None),
                            # Map other fields if available in item (ScreenerData)
                            # For now, sticking to the DataPipeline logic + verified fields
                        }

                        # Map on the value, not on the attribute's existence.
                        # `hasattr` is true whenever the field is declared, so a
                        # provider model that declares `price` but leaves it
                        # unset still passed the guard and wrote a row whose
                        # price was NULL -- indistinguishable downstream from a
                        # symbol that genuinely has no quote.
                        price = getattr(item, "price", None)
                        if price is not None:
                            values["price"] = price
                            values["trade_date"] = item.trade_date
                        volume = getattr(item, "volume", None)
                        if volume is not None:
                            values["volume"] = volume
                        roa = getattr(item, "roa", None)
                        if roa is not None:
                            values["roa"] = roa

                        values["price_unit"] = getattr(item, "price_unit", "unknown")
                        values["price_source"] = getattr(item, "price_source", None)
                        values["extended_metrics"] = {
                            "ratio_units": getattr(item, "ratio_units", {}),
                        }
                        if cap["observations"] or cap["status"] == "conflict":
                            values["extended_metrics"]["market_cap_provenance"] = cap
                        share_evidence = getattr(item, "shares_outstanding_provenance", None)
                        if isinstance(share_evidence, dict) and share_evidence.get("observations"):
                            values["extended_metrics"]["shares_outstanding_provenance"] = share_evidence
                        evidence = getattr(item, "provider_evidence", None)
                        if evidence is not None:
                            values["extended_metrics"]["provider_evidence"] = evidence
                        for metric in PERCENT_RATIO_FIELDS:
                            field = "debt_to_asset" if metric == "debt_assets" else metric
                            units = values["extended_metrics"]["ratio_units"]
                            value = (
                                getattr(item, field, None) if units.get(metric) == "percent" else None
                            )
                            if metric == "debt_assets":
                                if metric in units:
                                    values["extended_metrics"][field] = value
                            elif metric in ScreenerSnapshot.__table__.c:
                                values[metric] = value
                        values = normalize_screener_record(values)
                        # Same ownership rule as `CacheManager.store_screener_data`:
                        # a scheduled sync must not blank a column another writer
                        # already populated, and `source` is insert-only so the
                        # row's provenance survives a second writer.
                        dialect_insert = pg_insert if session.get_bind().dialect.name == "postgresql" else sqlite_insert
                        stmt = dialect_insert(ScreenerSnapshot).values(**values)
                        update_cols = {
                            k: func.coalesce(stmt.excluded[k], ScreenerSnapshot.__table__.c[k])
                            for k in values
                            if k not in ("symbol", "snapshot_date", "source")
                        }
                        update_cols.update(screener_metadata_updates(
                            stmt, session.bind.dialect.name, stmt.excluded.price.is_(None)
                        ))
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["symbol", "snapshot_date"], set_=update_cols
                        )

                        stored = await session.execute(stmt.returning(*ScreenerSnapshot.__table__.c))
                        await reconcile_snapshot_cap(session, dict(stored.mappings().one()), values)
                        count += 1

                    await session.commit()
                    total_count += count
                    logger.info(f"Synced {count} screener records for {exchange}")

            logger.info(f"Total synced {total_count} screener records")
            return total_count

        except Exception as e:
            logger.error(f"Screener sync failed: {e}")
            import traceback

            logger.error(traceback.format_exc())
            return 0


# Global instance
screener_service = ScreenerService()
