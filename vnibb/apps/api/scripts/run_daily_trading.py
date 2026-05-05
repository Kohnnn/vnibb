import asyncio

from vnibb.services.data_pipeline import data_pipeline


asyncio.run(data_pipeline.run_daily_trading_updates())
