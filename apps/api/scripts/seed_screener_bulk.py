"""Seed screener snapshots through the admission-aware pipeline."""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.services.data_pipeline import data_pipeline


async def seed_bulk():
    return await data_pipeline.sync_screener_data()


if __name__ == "__main__":
    asyncio.run(seed_bulk())
