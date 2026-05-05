from vnibb.core.vn_sectors import get_sector_by_id, resolve_sector_name


def test_resolve_sector_name_from_industry_text():
    banking = get_sector_by_id("banking")
    assert banking is not None

    assert resolve_sector_name(industry="Ngân hàng") == banking.name


def test_resolve_sector_name_from_manual_symbol_mapping():
    industrial_real_estate = get_sector_by_id("industrial_real_estate")
    assert industrial_real_estate is not None

    assert resolve_sector_name(symbol="KBC") == industrial_real_estate.name


def test_resolve_sector_name_from_english_hint_keyword():
    banking = get_sector_by_id("banking")
    assert banking is not None

    assert resolve_sector_name(sector_hint="Banking") == banking.name


def test_resolve_sector_name_returns_existing_hint_when_unmapped():
    assert resolve_sector_name(sector_hint="Custom Sector") == "Custom Sector"
