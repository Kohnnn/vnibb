from vnibb.core.config import Settings


def test_resolved_data_backend_returns_postgres_when_configured():
    settings = Settings(data_backend="postgres")

    assert settings.resolved_data_backend == "postgres"


def test_resolved_data_backend_returns_postgres_for_default():
    settings = Settings()

    assert settings.resolved_data_backend == "postgres"
