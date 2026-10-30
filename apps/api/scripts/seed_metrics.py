import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vnibb.services.data_pipeline import data_pipeline


async def seed_metrics(symbols=None):
    if symbols is None:
        symbols = ["VNM", "FPT", "HPG", "VCB", "VIC", "MSN"]
    return await data_pipeline.sync_financial_ratios(symbols=symbols, period="quarter")


if __name__ == "__main__":
    asyncio.run(seed_metrics(sys.argv[1:] or None))
