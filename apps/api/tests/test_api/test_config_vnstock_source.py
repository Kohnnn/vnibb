from vnibb.core.config import Settings


def test_vnstock_source_tcbs_is_migrated_to_kbs() -> None:
    # TCBS was removed in vnstock 3.5+; map the legacy value to a working source.
    settings = Settings(vnstock_source="TCBS")
    assert settings.vnstock_source == "KBS"


def test_vnstock_source_dnse_is_migrated_to_kbs() -> None:
    # DNSE was removed in vnstock 4.x (valid: KBS, VCI, MSN, FMP).
    settings = Settings(vnstock_source="DNSE")
    assert settings.vnstock_source == "KBS"


def test_vnstock_source_invalid_value_falls_back_to_kbs() -> None:
    settings = Settings(vnstock_source="INVALID")
    assert settings.vnstock_source == "KBS"


def test_vnstock_source_valid_value_is_normalized() -> None:
    settings = Settings(vnstock_source="vci")
    assert settings.vnstock_source == "VCI"


def test_vnstock_source_msn_and_fmp_are_valid() -> None:
    assert Settings(vnstock_source="msn").vnstock_source == "MSN"
    assert Settings(vnstock_source="FMP").vnstock_source == "FMP"
