"""
Application Configuration using Pydantic Settings.

Environment variables are loaded from .env file and validated at startup.
Supports both local development and Supabase production environments.

CRITICAL: This module validates configuration on import. Missing required
environment variables in production will cause the application to fail fast.
"""

import logging
import sys
from functools import lru_cache
from typing import Optional, List, Any

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """
    Application settings with environment variable support.
    
    Required variables (production):
    - DATABASE_URL: PostgreSQL connection string
    
    Optional variables with sensible defaults:
    - CORS_ORIGINS: Allowed origins for CORS
    - LOG_LEVEL: Logging verbosity
    - REDIS_URL: Redis connection (cache disabled if not set)
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    # ==========================================================================
    # Application Settings
    # ==========================================================================
    app_name: str = "VNIBB"
    app_version: str = "0.1.0"
    debug: bool = False
    environment: str = "development"  # development, staging, production
    
    # ==========================================================================
    # API Server
    # ==========================================================================
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_prefix: str = "/api/v1"
    cors_origins: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    
    # ==========================================================================
    # Database (PostgreSQL / Supabase)
    # ==========================================================================
    # Connection string format: postgresql+asyncpg://user:password@host:port/database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/vnibb"
    database_url_sync: Optional[str] = None  # For Alembic migrations (psycopg2)
    database_pool_size: int = 5
    database_max_overflow: int = 10
    database_pool_timeout: int = 30  # Seconds to wait for connection
    database_pool_recycle: int = 1800  # Recycle connections after 30 min
    database_echo: Optional[bool] = None  # Override debug for SQL logging
    database_ssl_mode: str = "prefer"  # disable, allow, prefer, require, verify-ca, verify-full
    
    # ==========================================================================
    # Supabase specific (if using Supabase hosted)
    # ==========================================================================
    supabase_url: Optional[str] = None
    supabase_anon_key: Optional[str] = None
    supabase_service_role_key: Optional[str] = None
    supabase_jwt_secret: Optional[str] = None  # For JWT validation
    
    # ==========================================================================
    # Redis Cache
    # ==========================================================================
    redis_url: Optional[str] = "redis://localhost:6379/0"
    redis_host: Optional[str] = "localhost"  # Extracted for rate limiter
    redis_port: int = 6379
    redis_password: Optional[str] = None
    redis_cache_ttl: int = 300  # Default TTL in seconds (5 minutes)
    redis_max_connections: int = 10
    redis_ssl: bool = False  # Enable SSL for production Redis
    
    # ==========================================================================
    # VNStock Provider
    # ==========================================================================
    vnstock_api_key: Optional[str] = None  # Golden Sponsor API key
    vnstock_source: str = "KBS"  # KBS (default in vnstock 3.4.0), VCI, TCBS, DNSE
    vnstock_timeout: int = 30  # Request timeout in seconds
    
    # ==========================================================================
    # LLM Configuration (AI Copilot)
    # ==========================================================================
    openai_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None
    llm_provider: str = "gemini"  # openai, gemini, anthropic, ollama
    llm_model: str = "gemini-2.0-flash"  # gpt-4o-mini, gemini-2.0-flash, claude-3-haiku
    llm_timeout: int = 30
    llm_max_tokens: int = 1024
    
    # ==========================================================================
    # Scraper Settings
    # ==========================================================================
    scraper_enabled: bool = True
    scraper_timeout: int = 60
    scraper_max_retries: int = 3
    scraper_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    
    # ==========================================================================
    # Logging Configuration
    # ==========================================================================
    log_level: str = "INFO"
    log_format: str = "text"  # "text" or "json"
    log_include_timestamp: bool = True
    log_request_body: bool = False  # Log request bodies (careful with PII)
    log_response_body: bool = False  # Log response bodies (careful with size)
    
    # ==========================================================================
    # Monitoring & Observability (Sentry)
    # ==========================================================================
    sentry_dsn: Optional[str] = None  # Sentry Data Source Name
    sentry_traces_sample_rate: float = 0.1  # Sample 10% of transactions
    sentry_profiles_sample_rate: float = 0.1  # Profile 10% of requests
    sentry_environment: Optional[str] = None  # Override environment name for Sentry
    
    # ==========================================================================
    # Validators
    # ==========================================================================
    
    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """Validate database URL format."""
        if not v:
            raise ValueError("DATABASE_URL is required")
        
        valid_prefixes = (
            "postgresql://",
            "postgresql+asyncpg://",
            "postgres://",
            "sqlite://",
            "sqlite+aiosqlite://",
        )
        if not v.startswith(valid_prefixes):
            raise ValueError(
                f"Invalid DATABASE_URL format. Must start with one of: {valid_prefixes}"
            )
        return v
    
    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Any) -> List[str]:
        """Parse CORS origins from string or list."""
        if isinstance(v, str):
            # Handle JSON array string: '["http://localhost:3000"]'
            if v.startswith("["):
                import json
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    pass
            # Handle comma-separated string: "http://localhost:3000,http://example.com"
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v or []
    
    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, v: List[str]) -> List[str]:
        """Validate CORS origin URLs."""
        validated = []
        for origin in v:
            origin = origin.strip()
            if not origin:
                continue
            # Allow wildcard
            if origin == "*":
                validated.append(origin)
                continue
            # Validate URL format
            if not origin.startswith(("http://", "https://")):
                raise ValueError(
                    f"Invalid CORS origin '{origin}'. Must start with http:// or https://"
                )
            # Remove trailing slash for consistency
            validated.append(origin.rstrip("/"))
        return validated
    
    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Validate log level."""
        valid_levels = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        v_upper = v.upper()
        if v_upper not in valid_levels:
            raise ValueError(f"Invalid LOG_LEVEL '{v}'. Must be one of: {valid_levels}")
        return v_upper
    
    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        """Validate environment name."""
        valid_envs = {"development", "staging", "production", "test"}
        v_lower = v.lower()
        if v_lower not in valid_envs:
            raise ValueError(f"Invalid ENVIRONMENT '{v}'. Must be one of: {valid_envs}")
        return v_lower
    
    @model_validator(mode="after")
    def validate_production_requirements(self) -> "Settings":
        """Validate production-specific requirements."""
        if self.environment == "production":
            errors = []
            
            # Database URL should not be localhost in production
            if "localhost" in self.database_url or "127.0.0.1" in self.database_url:
                errors.append(
                    "DATABASE_URL contains localhost - use production database URL"
                )
            
            # CORS should not allow all origins in production
            if "*" in self.cors_origins:
                logger.warning(
                    "CORS_ORIGINS contains '*' in production - consider restricting"
                )
            
            # Debug should be disabled in production
            if self.debug:
                logger.warning("DEBUG=true in production - consider disabling")
            
            # Warn if no Redis configured
            if not self.redis_url:
                logger.warning(
                    "REDIS_URL not configured - caching and rate limiting disabled"
                )
            
            if errors:
                raise ValueError(
                    f"Production configuration errors:\n" + "\n".join(f"  - {e}" for e in errors)
                )
        
        return self
    
    # ==========================================================================
    # Computed Properties
    # ==========================================================================
    
    @property
    def sync_database_url(self) -> str:
        """Get sync database URL for Alembic (replaces asyncpg with psycopg2)."""
        if self.database_url_sync:
            return self.database_url_sync
        return self.database_url.replace("+asyncpg", "")
    
    @property
    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "production"
    
    @property
    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.environment == "development"
    
    @property
    def should_echo_sql(self) -> bool:
        """Determine if SQL should be echoed to logs."""
        if self.database_echo is not None:
            return self.database_echo
        return self.debug and not self.is_production
    
    @property
    def log_format_string(self) -> str:
        """Get the logging format string based on configuration."""
        if self.log_format == "json":
            return "%(message)s"  # JSON formatter handles structure
        
        parts = []
        if self.log_include_timestamp:
            parts.append("%(asctime)s")
        parts.extend(["%(name)s", "%(levelname)s", "%(message)s"])
        return " - ".join(parts)


def _validate_startup_config(settings: Settings) -> None:
    """
    Validate critical configuration at startup.
    
    This function is called when the settings module is imported.
    It will cause the application to fail fast if critical configuration is missing.
    """
    errors = []
    warnings = []
    
    # Check database connectivity hint
    if "localhost" in settings.database_url and settings.is_production:
        errors.append("DATABASE_URL points to localhost in production")
    
    # Check for common misconfigurations
    if settings.is_production:
        if not settings.cors_origins:
            errors.append("CORS_ORIGINS is empty in production")
        
        if settings.debug:
            warnings.append("DEBUG mode is enabled in production")
        
        if not settings.redis_url:
            warnings.append("REDIS_URL not set - caching disabled")
    
    # Log warnings
    for warning in warnings:
        logger.warning(f"Configuration warning: {warning}")
    
    # Fail on errors
    if errors:
        error_msg = "Configuration validation failed:\n" + "\n".join(f"  - {e}" for e in errors)
        logger.error(error_msg)
        if settings.is_production:
            # In production, fail fast
            sys.exit(1)


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance for dependency injection."""
    return Settings()


# Global settings instance
settings = get_settings()

# Validate on import (fail fast)
_validate_startup_config(settings)
