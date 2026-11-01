"""Seed screener snapshots through the admission-aware pipeline."""

import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.services.data_pipeline import data_pipeline


async def seed_screener_batch(batch_size=None, max_stocks=2000):
    if batch_size is not None:
        raise ValueError("The admission-aware screener pipeline does not support batch_size")
    if max_stocks is not None and max_stocks <= 0:
        raise ValueError("max_stocks must be positive or None")
    count = await data_pipeline.sync_screener_data(limit=max_stocks)
    return count > 0


if __name__ == "__main__":
    sys.exit(0 if asyncio.run(seed_screener_batch(max_stocks=None)) else 1)
