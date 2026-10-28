"""
Data Pipeline Module

This module organizes the data pipeline into focused sub-modules:
- base: Base classes and common utilities
- financials_pipeline: Financial statement sync
- screener_pipeline: Screener metrics sync
- news_pipeline: News aggregation
- scheduler: Job scheduling

Scheduled price acquisition uses the canonical data_pipeline.py implementation.
"""

from vnibb.services.data_pipeline import DataPipeline

__all__ = ["DataPipeline"]
