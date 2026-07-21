import pytest

from conftest import postgres_contract_database_url


def test_contract_database_url_requires_its_own_variable() -> None:
    with pytest.raises(RuntimeError, match="POSTGRES_CONTRACT_DATABASE_URL is required"):
        postgres_contract_database_url({"DATABASE_URL": "postgresql+asyncpg://postgres:postgres@127.0.0.1/vnibb"})


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+asyncpg://postgres:postgres@db.example.com/vnibb",
        "postgresql+asyncpg://postgres:postgres@10.0.0.8/vnibb",
        "postgresql+asyncpg://postgres:postgres@[2001:db8::1]/vnibb",
    ],
)
def test_contract_database_url_rejects_non_loopback_hosts(url: str) -> None:
    with pytest.raises(RuntimeError, match="host must be loopback"):
        postgres_contract_database_url({"POSTGRES_CONTRACT_DATABASE_URL": url})


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+asyncpg://postgres:postgres@localhost:5432/vnibb",
        "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/vnibb",
    ],
)
def test_contract_database_url_accepts_loopback_hosts(url: str) -> None:
    assert postgres_contract_database_url({"POSTGRES_CONTRACT_DATABASE_URL": url}) == url
