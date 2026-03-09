"""
Vietnamese Market Sector Classification

Master data for VN market sector groups, mapping ICB industry codes
to Vietnamese sector categories for local market analysis.
"""

import re
import unicodedata
from typing import Dict, List, Optional
from pydantic import BaseModel


class SectorConfig(BaseModel):
    """Configuration for a market sector."""

    name: str  # Vietnamese name
    name_en: str  # English name
    icb_codes: List[str] = []  # ICB industry codes that belong to this sector
    keywords: List[str] = []  # Keywords to match industry names
    symbols: List[str] = []  # Manually specified symbols (e.g., for VN30)


# Vietnamese market sector classifications
VN_SECTORS: Dict[str, SectorConfig] = {
    # Index-based groups
    "vn30": SectorConfig(
        name="VN30",
        name_en="VN30 Index",
        symbols=[
            "VNM",
            "VIC",
            "VHM",
            "VCB",
            "HPG",
            "TCB",
            "CTG",
            "MBB",
            "GAS",
            "SAB",
            "MSN",
            "VRE",
            "VJC",
            "FPT",
            "PLX",
            "BID",
            "ACB",
            "POW",
            "MWG",
            "TPB",
            "STB",
            "BVH",
            "SSI",
            "VPB",
            "HDB",
            "SHB",
            "REE",
            "GMD",
            "VGC",
            "NVL",
        ],
    ),
    # Banking & Finance
    "banking": SectorConfig(
        name="Ngân hàng",
        name_en="Banking",
        icb_codes=["8300", "8355"],
        keywords=["ngân hàng", "bank"],
    ),
    "securities": SectorConfig(
        name="Chứng khoán",
        name_en="Securities",
        icb_codes=["8700", "8770", "8775"],
        keywords=["chứng khoán", "securities"],
    ),
    "insurance": SectorConfig(
        name="Bảo hiểm",
        name_en="Insurance",
        icb_codes=["8500", "8530", "8570"],
        keywords=["bảo hiểm", "insurance"],
    ),
    # Real Estate
    "real_estate": SectorConfig(
        name="Bất động sản",
        name_en="Real Estate",
        icb_codes=["8600", "8670", "8675", "8633"],
        keywords=["bất động sản", "real estate", "địa ốc"],
    ),
    "industrial_real_estate": SectorConfig(
        name="BĐS Khu công nghiệp",
        name_en="Industrial Real Estate",
        keywords=["khu công nghiệp", "kcn", "industrial park"],
        symbols=["KBC", "SZC", "IDC", "NTC", "SIP", "ITA", "PHR", "SNZ", "TIP", "GIL"],
    ),
    # Manufacturing & Industry
    "steel": SectorConfig(
        name="Thép",
        name_en="Steel",
        icb_codes=["1750", "1755"],
        keywords=["thép", "steel", "sắt", "kim loại", "metal"],
    ),
    "construction_materials": SectorConfig(
        name="VLXD",
        name_en="Construction Materials",
        icb_codes=["2300", "2350", "2353"],
        keywords=["vật liệu xây dựng", "xi măng", "cement"],
    ),
    "chemicals_fertilizer": SectorConfig(
        name="Hóa chất - Phân bón",
        name_en="Chemicals & Fertilizer",
        icb_codes=["1300", "1350", "1353", "1357"],
        keywords=["hóa chất", "phân bón", "chemicals", "fertilizer"],
    ),
    "auto_parts": SectorConfig(
        name="Ôtô - Phụ tùng",
        name_en="Auto & Parts",
        icb_codes=["3500", "3530", "3535"],
        keywords=["ô tô", "phụ tùng", "automotive", "ô tô và phụ tùng"],
    ),
    # Energy & Utilities
    "oil_gas": SectorConfig(
        name="Dầu khí",
        name_en="Oil & Gas",
        icb_codes=["0500", "0530", "0570"],
        keywords=[
            "dầu khí",
            "oil",
            "gas",
            "petro",
            "khai khoáng",
            "thiết bị, dịch vụ và phân phối dầu khí",
        ],
    ),
    "power_energy": SectorConfig(
        name="Điện - Năng lượng",
        name_en="Power & Energy",
        icb_codes=["7500", "7530", "7535"],
        keywords=["điện", "năng lượng", "electricity", "power"],
    ),
    # Consumer & Retail
    "retail": SectorConfig(
        name="Bán lẻ",
        name_en="Retail",
        icb_codes=["5300", "5330", "5337", "5370", "5371"],
        keywords=["bán lẻ", "retail"],
    ),
    "food": SectorConfig(
        name="Thực phẩm",
        name_en="Food & Beverage",
        icb_codes=["3500", "3530", "3533", "3535", "3570", "3577"],
        keywords=["thực phẩm", "đồ uống", "food", "beverage"],
    ),
    # Healthcare & Pharma
    "pharma_healthcare": SectorConfig(
        name="Dược - Y tế",
        name_en="Pharma & Healthcare",
        icb_codes=["4500", "4530", "4535", "4570"],
        keywords=["dược", "y tế", "pharma", "healthcare"],
    ),
    # Technology & Telecom
    "technology": SectorConfig(
        name="Công nghệ - Truyền thông",
        name_en="Technology & Telecom",
        icb_codes=["9500", "9530", "9535", "9570"],
        keywords=["công nghệ", "technology", "viễn thông", "telecom", "phần mềm", "software"],
    ),
    # Transportation & Logistics
    "port_logistics": SectorConfig(
        name="Cảng biển - Vận tải",
        name_en="Ports & Logistics",
        icb_codes=["2700", "2770", "2773", "2775", "2777"],
        keywords=["cảng", "vận tải", "logistics", "port", "shipping"],
    ),
    "aviation_tourism": SectorConfig(
        name="Hàng không - Du lịch",
        name_en="Aviation & Tourism",
        icb_codes=["5700", "5750", "5753", "5755"],
        keywords=["hàng không", "du lịch", "aviation", "tourism", "khách sạn"],
    ),
    # Agriculture & Resources
    "seafood": SectorConfig(
        name="Thủy sản",
        name_en="Seafood",
        icb_codes=["3570", "3577"],
        keywords=["thủy sản", "seafood", "cá", "tôm"],
    ),
    "rubber": SectorConfig(
        name="Cao su", name_en="Rubber", icb_codes=["1353"], keywords=["cao su", "rubber"]
    ),
    "sugar_wood_paper": SectorConfig(
        name="Đường - Gỗ - Giấy",
        name_en="Sugar, Wood & Paper",
        icb_codes=["3730", "1730", "1737"],
        keywords=["đường", "gỗ", "giấy", "sugar", "wood", "paper", "lâm nghiệp và giấy"],
    ),
    # Textile
    "textile": SectorConfig(
        name="Dệt may",
        name_en="Textile & Garment",
        icb_codes=["3700", "3720", "3730"],
        keywords=["dệt may", "textile", "garment", "may mặc", "sx hàng gia dụng", "hàng cá nhân"],
    ),
    # Infrastructure
    "public_investment": SectorConfig(
        name="Đầu tư công",
        name_en="Public Investment",
        keywords=["xây dựng", "construction", "hạ tầng", "infrastructure"],
        symbols=["VCG", "CTD", "HBC", "FCN", "LCG", "HHV", "C4G", "CII", "DIG", "PC1"],
    ),
    "water_plastic": SectorConfig(
        name="Nước - Nhựa",
        name_en="Water & Plastic",
        keywords=["nước", "nhựa", "water", "plastic"],
        symbols=["BWE", "DNP", "BMP", "NTP", "AAA", "TDM", "TNG"],
    ),
}

SECTOR_CLASSIFICATION_IDS: List[str] = [
    sector_id for sector_id in VN_SECTORS.keys() if sector_id not in {"vn30"}
]

INDUSTRY_TO_SECTOR_ID: dict[str, str] = {
    "ngan hang": "banking",
    "chung khoan": "securities",
    "bat dong san": "real_estate",
    "vat lieu xay dung": "construction_materials",
    "xay dung va vat lieu": "construction_materials",
    "ban le": "retail",
    "ban buon": "retail",
    "thuc pham do uong": "food",
    "san xuat thuc pham": "food",
    "bia va do uong": "food",
    "cong nghe va thong tin": "technology",
    "truyen thong": "technology",
    "vien thong co dinh": "technology",
    "vien thong di dong": "technology",
    "bao hiem": "insurance",
    "bao hiem phi nhan tho": "insurance",
    "sx nhua hoa chat": "chemicals_fertilizer",
    "hoa chat": "chemicals_fertilizer",
    "thiet bi dien": "power_energy",
    "san xuat phan phoi dien": "power_energy",
    "dien tu thiet bi dien": "power_energy",
    "sx thiet bi may moc": "power_energy",
    "tien ich": "power_energy",
    "van tai kho bai": "port_logistics",
    "van tai": "port_logistics",
    "che bien thuy san": "seafood",
    "xay dung": "public_investment",
    "tu van ho tro kinh doanh": "public_investment",
    "sx phu tro": "construction_materials",
    "khai khoang": "oil_gas",
    "thiet bi dich vu va phan phoi dau khi": "oil_gas",
    "dich vu luu tru an uong giai tri": "aviation_tourism",
    "du lich giai tri": "aviation_tourism",
    "sx hang gia dung": "textile",
    "hang ca nhan": "textile",
    "det may": "textile",
    "kim loai": "steel",
    "cong nghiep nang": "steel",
    "lam nghiep va giay": "sugar_wood_paper",
    "duong": "sugar_wood_paper",
    "go": "sugar_wood_paper",
    "o to va phu tung": "auto_parts",
    "duoc pham": "pharma_healthcare",
    "cham soc suc khoe": "pharma_healthcare",
    "thiet bi va dich vu y te": "pharma_healthcare",
    "tai chinh khac": "securities",
    "nuoc khi dot": "water_plastic",
}


def normalize_sector_lookup_text(value: str | None) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""

    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def map_industry_to_sector_id(value: str | None) -> Optional[str]:
    normalized = normalize_sector_lookup_text(value)
    if not normalized:
        return None

    direct = INDUSTRY_TO_SECTOR_ID.get(normalized)
    if direct:
        return direct

    for industry_key, sector_id in INDUSTRY_TO_SECTOR_ID.items():
        if industry_key in normalized or normalized in industry_key:
            return sector_id

    return None


def resolve_sector_name(
    symbol: str | None = None,
    industry: str | None = None,
    sector_hint: str | None = None,
    prefer_english: bool = False,
) -> Optional[str]:
    for candidate in (sector_hint, industry):
        sector_id = map_industry_to_sector_id(candidate)
        if sector_id is None:
            continue
        sector = VN_SECTORS.get(sector_id)
        if sector:
            return sector.name_en if prefer_english else sector.name

    symbol_upper = str(symbol or "").strip().upper()
    if symbol_upper:
        for sector_id in SECTOR_CLASSIFICATION_IDS:
            sector = VN_SECTORS.get(sector_id)
            if not sector:
                continue
            manual_symbols = {item.upper() for item in sector.symbols if item}
            if symbol_upper in manual_symbols:
                return sector.name_en if prefer_english else sector.name

    for candidate in (industry, sector_hint):
        normalized_candidate = normalize_sector_lookup_text(candidate)
        if not normalized_candidate:
            continue
        candidate_words = normalized_candidate.split()
        for sector_id in SECTOR_CLASSIFICATION_IDS:
            sector = VN_SECTORS.get(sector_id)
            if not sector:
                continue
            for keyword in sector.keywords:
                normalized_keyword = normalize_sector_lookup_text(keyword)
                if not normalized_keyword:
                    continue
                keyword_words = normalized_keyword.split()
                if len(keyword_words) == 1:
                    keyword_match = any(
                        word == normalized_keyword or word.startswith(normalized_keyword)
                        for word in candidate_words
                    )
                else:
                    keyword_match = normalized_keyword in normalized_candidate
                if keyword_match:
                    return sector.name_en if prefer_english else sector.name

    cleaned_hint = str(sector_hint or "").strip()
    return cleaned_hint or None


def get_all_sectors() -> Dict[str, SectorConfig]:
    """Get all sector configurations."""
    return VN_SECTORS


def get_sector_names() -> Dict[str, str]:
    """Get mapping of sector_id to Vietnamese name."""
    return {k: v.name for k, v in VN_SECTORS.items()}


def get_sector_by_id(sector_id: str) -> Optional[SectorConfig]:
    """Get sector configuration by ID."""
    return VN_SECTORS.get(sector_id)
