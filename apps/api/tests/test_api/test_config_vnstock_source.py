import pytest
from pydantic import ValidationError
from vnibb.core.config import Settings


@pytest.mark.parametrize("source", ["TCBS", "DNSE", "KBS", "MSN", "FMP", "INVALID"])
def test_vnstock_source_rejects_alternates_without_migration(source: str) -> None:
    with pytest.raises(ValidationError, match="VNSTOCK_SOURCE must be 'VCI'"):
        Settings(vnstock_source=source)


@pytest.mark.parametrize("source", ["VCI", "vci", " vci "])
def test_vnstock_source_vci_is_normalized(source: str) -> None:
    assert Settings(vnstock_source=source).vnstock_source == "VCI"
