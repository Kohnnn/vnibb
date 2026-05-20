"""Rebuild OrderFlowDaily bucket columns from existing ForeignTrading data.

The daily_trading sync writes OrderFlowDaily rows with all bucket columns
NULL when the intraday-trades stage returns no data — but the
ForeignTrading table for the same (symbol, trade_date) usually IS populated
because the foreign_trading stage runs successfully. This helper merges
those values back into OrderFlowDaily so the flow-coverage endpoint and
TransactionFlow widget have a working fallback signal.

Run inside the API container:
    docker exec vnibb-api python /tmp/rebuild_orderflow.py
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from vnibb.core.database import async_session_maker
from vnibb.models.trading import ForeignTrading, OrderFlowDaily

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("rebuild_orderflow")


async def main() -> None:
    async with async_session_maker() as session:
        ft_rows = (
            await session.execute(
                select(
                    ForeignTrading.symbol,
                    ForeignTrading.trade_date,
                    ForeignTrading.buy_volume,
                    ForeignTrading.sell_volume,
                    ForeignTrading.net_volume,
                    ForeignTrading.buy_value,
                    ForeignTrading.sell_value,
                    ForeignTrading.net_value,
                )
            )
        ).all()
        logger.info("found %d ForeignTrading rows", len(ft_rows))

        upserted = 0
        for chunk_start in range(0, len(ft_rows), 500):
            chunk = ft_rows[chunk_start : chunk_start + 500]
            for row in chunk:
                values = {
                    "symbol": row.symbol,
                    "trade_date": row.trade_date,
                    "foreign_buy_volume": row.buy_volume,
                    "foreign_sell_volume": row.sell_volume,
                    "foreign_net_volume": row.net_volume,
                    "created_at": datetime.utcnow(),
                    "updated_at": datetime.utcnow(),
                }
                stmt = pg_insert(OrderFlowDaily).values(**values)
                stmt = stmt.on_conflict_do_update(
                    index_elements=["symbol", "trade_date"],
                    set_={
                        "foreign_buy_volume": stmt.excluded.foreign_buy_volume,
                        "foreign_sell_volume": stmt.excluded.foreign_sell_volume,
                        "foreign_net_volume": stmt.excluded.foreign_net_volume,
                        "updated_at": datetime.utcnow(),
                    },
                )
                await session.execute(stmt)
                upserted += 1
            await session.commit()
            logger.info("upserted %d / %d", upserted, len(ft_rows))

        logger.info("done: upserted %d OrderFlowDaily rows from ForeignTrading", upserted)


if __name__ == "__main__":
    asyncio.run(main())
