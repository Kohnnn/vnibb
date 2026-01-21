"""
Vietnamese Market Sector Classification

Master data for VN market sector groups, mapping ICB industry codes
to Vietnamese sector categories for local market analysis.
"""

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
        symbols=["VNM", "VIC", "VHM", "VCB", "HPG", "TCB", "CTG", "MBB", "GAS", "SAB",
                 "MSN", "VRE", "VJC", "FPT", "PLX", "BID", "ACB", "POW", "MWG", "TPB",
                 "STB", "BVH", "SSI", "VPB", "HDB", "SHB", "REE", "GMD", "VGC", "NVL"]
    ),
    
    # Banking & Finance
    "banking": SectorConfig(
        name="Ngân hàng",
        name_en="Banking",
        icb_codes=["8300", "8355"],
        keywords=["ngân hàng", "bank"]
    ),
    "securities": SectorConfig(
        name="Chứng khoán",
        name_en="Securities",
        icb_codes=["8700", "8770", "8775"],
        keywords=["chứng khoán", "securities"]
    ),
    "insurance": SectorConfig(
        name="Bảo hiểm",
        name_en="Insurance",
        icb_codes=["8500", "8530", "8570"],
        keywords=["bảo hiểm", "insurance"]
    ),
    
    # Real Estate
    "real_estate": SectorConfig(
        name="Bất động sản",
        name_en="Real Estate",
        icb_codes=["8600", "8670", "8675", "8633"],
        keywords=["bất động sản", "real estate", "địa ốc"]
    ),
    "industrial_real_estate": SectorConfig(
        name="BĐS Khu công nghiệp",
        name_en="Industrial Real Estate",
        keywords=["khu công nghiệp", "kcn", "industrial park"],
        symbols=["KBC", "SZC", "IDC", "NTC", "SIP", "ITA", "PHR", "SNZ", "TIP", "GIL"]
    ),
    
    # Manufacturing & Industry
    "steel": SectorConfig(
        name="Thép",
        name_en="Steel",
        icb_codes=["1750", "1755"],
        keywords=["thép", "steel", "sắt"]
    ),
    "construction_materials": SectorConfig(
        name="VLXD",
        name_en="Construction Materials",
        icb_codes=["2300", "2350", "2353"],
        keywords=["vật liệu xây dựng", "xi măng", "cement"]
    ),
    "chemicals_fertilizer": SectorConfig(
        name="Hóa chất - Phân bón",
        name_en="Chemicals & Fertilizer",
        icb_codes=["1300", "1350", "1353", "1357"],
        keywords=["hóa chất", "phân bón", "chemicals", "fertilizer"]
    ),
    "auto_parts": SectorConfig(
        name="Ôtô - Phụ tùng",
        name_en="Auto & Parts",
        icb_codes=["3500", "3530", "3535"],
        keywords=["ô tô", "phụ tùng", "automotive"]
    ),
    
    # Energy & Utilities
    "oil_gas": SectorConfig(
        name="Dầu khí",
        name_en="Oil & Gas",
        icb_codes=["0500", "0530", "0570"],
        keywords=["dầu khí", "oil", "gas", "petro"]
    ),
    "power_energy": SectorConfig(
        name="Điện - Năng lượng",
        name_en="Power & Energy",
        icb_codes=["7500", "7530", "7535"],
        keywords=["điện", "năng lượng", "electricity", "power"]
    ),
    
    # Consumer & Retail
    "retail": SectorConfig(
        name="Bán lẻ",
        name_en="Retail",
        icb_codes=["5300", "5330", "5337", "5370", "5371"],
        keywords=["bán lẻ", "retail"]
    ),
    "food": SectorConfig(
        name="Thực phẩm",
        name_en="Food & Beverage",
        icb_codes=["3500", "3530", "3533", "3535", "3570", "3577"],
        keywords=["thực phẩm", "đồ uống", "food", "beverage"]
    ),
    
    # Healthcare & Pharma
    "pharma_healthcare": SectorConfig(
        name="Dược - Y tế",
        name_en="Pharma & Healthcare",
        icb_codes=["4500", "4530", "4535", "4570"],
        keywords=["dược", "y tế", "pharma", "healthcare"]
    ),
    
    # Technology & Telecom
    "technology": SectorConfig(
        name="Công nghệ - Truyền thông",
        name_en="Technology & Telecom",
        icb_codes=["9500", "9530", "9535", "9570"],
        keywords=["công nghệ", "technology", "viễn thông", "telecom", "phần mềm", "software"]
    ),
    
    # Transportation & Logistics
    "port_logistics": SectorConfig(
        name="Cảng biển - Vận tải",
        name_en="Ports & Logistics",
        icb_codes=["2700", "2770", "2773", "2775", "2777"],
        keywords=["cảng", "vận tải", "logistics", "port", "shipping"]
    ),
    "aviation_tourism": SectorConfig(
        name="Hàng không - Du lịch",
        name_en="Aviation & Tourism",
        icb_codes=["5700", "5750", "5753", "5755"],
        keywords=["hàng không", "du lịch", "aviation", "tourism", "khách sạn"]
    ),
    
    # Agriculture & Resources
    "seafood": SectorConfig(
        name="Thủy sản",
        name_en="Seafood",
        icb_codes=["3570", "3577"],
        keywords=["thủy sản", "seafood", "cá", "tôm"]
    ),
    "rubber": SectorConfig(
        name="Cao su",
        name_en="Rubber",
        icb_codes=["1353"],
        keywords=["cao su", "rubber"]
    ),
    "sugar_wood_paper": SectorConfig(
        name="Đường - Gỗ - Giấy",
        name_en="Sugar, Wood & Paper",
        icb_codes=["3730", "1730", "1737"],
        keywords=["đường", "gỗ", "giấy", "sugar", "wood", "paper"]
    ),
    
    # Textile
    "textile": SectorConfig(
        name="Dệt may",
        name_en="Textile & Garment",
        icb_codes=["3700", "3720", "3730"],
        keywords=["dệt may", "textile", "garment", "may mặc"]
    ),
    
    # Infrastructure
    "public_investment": SectorConfig(
        name="Đầu tư công",
        name_en="Public Investment",
        keywords=["xây dựng", "construction", "hạ tầng", "infrastructure"],
        symbols=["VCG", "CTD", "HBC", "FCN", "LCG", "HHV", "C4G", "CII", "DIG", "PC1"]
    ),
    "water_plastic": SectorConfig(
        name="Nước - Nhựa",
        name_en="Water & Plastic",
        keywords=["nước", "nhựa", "water", "plastic"],
        symbols=["BWE", "DNP", "BMP", "NTP", "AAA", "TDM", "TNG"]
    ),
}


def get_all_sectors() -> Dict[str, SectorConfig]:
    """Get all sector configurations."""
    return VN_SECTORS


def get_sector_names() -> Dict[str, str]:
    """Get mapping of sector_id to Vietnamese name."""
    return {k: v.name for k, v in VN_SECTORS.items()}


def get_sector_by_id(sector_id: str) -> Optional[SectorConfig]:
    """Get sector configuration by ID."""
    return VN_SECTORS.get(sector_id)
