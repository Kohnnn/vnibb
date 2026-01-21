"""
Screener Filter Service

Provides functionality to parse complex nested filters and apply them
to stock screener DataFrames or lists of ScreenerData objects.
"""

import logging
import json
from typing import List, Any, Optional, Union, Dict
import pandas as pd
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

class FilterCondition(BaseModel):
    """A single filter condition (e.g., pe > 10)."""
    field: str
    operator: str  # gt, lt, eq, gte, lte, between, in
    value: Any

class FilterGroup(BaseModel):
    """A group of filter conditions with AND/OR logic."""
    logic: str = Field(default="AND", pattern=r"^(AND|OR)$")
    conditions: List[Union[FilterCondition, 'FilterGroup']]

# Handle recursive type for FilterGroup
FilterGroup.model_rebuild()

class ScreenerFilterService:
    @staticmethod
    def apply_filters(df: pd.DataFrame, filter_group: Optional[FilterGroup]) -> pd.DataFrame:
        """
        Apply a FilterGroup to a DataFrame.
        
        Args:
            df: The DataFrame to filter.
            filter_group: The FilterGroup containing conditions.
            
        Returns:
            The filtered DataFrame.
        """
        if filter_group is None or not filter_group.conditions:
            return df

        if filter_group.logic == "AND":
            result_df = df
            for condition in filter_group.conditions:
                if isinstance(condition, FilterGroup):
                    result_df = ScreenerFilterService.apply_filters(result_df, condition)
                else:
                    result_df = ScreenerFilterService._apply_single_condition(result_df, condition)
            return result_df
        
        elif filter_group.logic == "OR":
            if not filter_group.conditions:
                return df
                
            dfs = []
            for condition in filter_group.conditions:
                if isinstance(condition, FilterGroup):
                    dfs.append(ScreenerFilterService.apply_filters(df.copy(), condition))
                else:
                    dfs.append(ScreenerFilterService._apply_single_condition(df.copy(), condition))
            
            # Combine results and drop duplicates by symbol/ticker
            if not dfs:
                return df
            
            combined = pd.concat(dfs).drop_duplicates(subset=["symbol"] if "symbol" in df.columns else None)
            return combined
            
        return df

    @staticmethod
    def _apply_single_condition(df: pd.DataFrame, cond: FilterCondition) -> pd.DataFrame:
        """Apply a single FilterCondition to the DataFrame."""
        if cond.field not in df.columns:
            logger.warning(f"Field {cond.field} not found in DataFrame columns")
            return df
            
        field = cond.field
        op = cond.operator
        val = cond.value
        
        try:
            if op == "gt":
                return df[df[field] > val]
            elif op == "lt":
                return df[df[field] < val]
            elif op == "eq":
                return df[df[field] == val]
            elif op == "gte":
                return df[df[field] >= val]
            elif op == "lte":
                return df[df[field] <= val]
            elif op == "between":
                if isinstance(val, list) and len(val) == 2:
                    return df[(df[field] >= val[0]) & (df[field] <= val[1])]
                logger.warning(f"Invalid value for 'between' operator: {val}")
            elif op == "in":
                if isinstance(val, list):
                    return df[df[field].isin(val)]
                logger.warning(f"Invalid value for 'in' operator: {val}")
            else:
                logger.warning(f"Unsupported operator: {op}")
        except Exception as e:
            logger.error(f"Error applying filter {cond}: {e}")
            
        return df

    @staticmethod
    def parse_filter_json(filter_json: str) -> Optional[FilterGroup]:
        """Parse JSON string into FilterGroup model."""
        if not filter_json:
            return None
        try:
            data = json.loads(filter_json)
            return FilterGroup(**data)
        except Exception as e:
            logger.error(f"Failed to parse filter JSON: {e}")
            return None

    @staticmethod
    def apply_multi_sort(df: pd.DataFrame, sort_str: Optional[str]) -> pd.DataFrame:
        """
        Apply multi-column sorting to the DataFrame.
        
        Args:
            df: The DataFrame to sort.
            sort_str: Sort string in format "field:order,field2:order2"
            
        Returns:
            The sorted DataFrame.
        """
        if not sort_str:
            return df
            
        sort_configs = sort_str.split(",")
        sort_fields = []
        sort_ascending = []
        
        for config in sort_configs:
            if ":" in config:
                field, order = config.split(":")
                if field in df.columns:
                    sort_fields.append(field)
                    sort_ascending.append(order.lower() == "asc")
            else:
                # Default to desc if no order provided
                if config in df.columns:
                    sort_fields.append(config)
                    sort_ascending.append(False)
                    
        if sort_fields:
            return df.sort_values(by=sort_fields, ascending=sort_ascending)
            
        return df
