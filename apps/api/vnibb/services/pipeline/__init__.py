"""
Data Pipeline Module

This module organizes the data pipeline into focused sub-modules:
- base: Base classes and common utilities
- price_pipeline: Price data synchronization
- financials_pipeline: Financial statement sync
- screener_pipeline: Screener metrics sync
- news_pipeline: News aggregation
- scheduler: Job scheduling

The original data_pipeline.py is preserved for backward compatibility.
"""

from vnibb.services.data_pipeline import DataPipeline

__all__ = ["DataPipeline"]
