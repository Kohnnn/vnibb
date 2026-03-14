from vnibb.core.config import Settings


def test_vnstock_source_tcbs_is_migrated_to_vci() -> None:
    settings = Settings(vnstock_source="TCBS")
    assert settings.vnstock_source == "VCI"


def test_vnstock_source_invalid_value_falls_back_to_kbs() -> None:
    settings = Settings(vnstock_source="INVALID")
    assert settings.vnstock_source == "KBS"


def test_vnstock_source_valid_value_is_normalized() -> None:
    settings = Settings(vnstock_source="dnse")
    assert settings.vnstock_source == "DNSE"
