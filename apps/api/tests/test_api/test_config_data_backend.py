from vnibb.core.config import Settings


def test_resolved_data_backend_returns_hybrid_when_appwrite_is_configured():
    settings = Settings(
        data_backend="hybrid",
        appwrite_endpoint="https://cloud.appwrite.io/v1",
        appwrite_project_id="project-id",
        appwrite_api_key="api-key",
        appwrite_database_id="database-id",
    )

    assert settings.resolved_data_backend == "hybrid"


def test_resolved_data_backend_falls_back_to_postgres_when_hybrid_has_no_appwrite_config():
    settings = Settings(data_backend="hybrid")

    assert settings.resolved_data_backend == "postgres"
