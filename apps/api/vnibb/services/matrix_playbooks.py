from __future__ import annotations

import re
import unicodedata

DEFINITION_REVISION = "matrix-playbooks-1"


def _dimension(key: str, label: str, question: str, kind: str = "table") -> dict:
    return {
        "dimension_id": key,
        "label": label,
        "question": question,
        "output_type": kind,
        "source_scope": "Retained SQL serving observations; not original issuer documents",
        "definition_revision": DEFINITION_REVISION,
    }


_COMMON = [
    _dimension("classification", "Sector classification", "What stored classification supports eligibility?", "classification"),
    _dimension("basis", "Comparison basis", "Which accounting and source limitations apply?", "text"),
    _dimension("sources", "Source inventory", "Which stored datasets are present? Inventory is not evidence.", "source_set"),
    _dimension("artifact", "Issuer artifact", "Is a retained issuer document available?", "artifact"),
]

PLAYBOOKS = [
    {
        "playbook_id": "nonfinancial",
        "label": "Nonfinancial companies",
        "description": "Accounting growth, profitability, cash conversion, leverage and valuation; unknown units or accounting scope prevent derived comparisons.",
        "definition_revision": DEFINITION_REVISION,
        "dimensions": [
            _dimension("growth", "Revenue and growth", "What are revenue and same-period prior-year growth?"),
            _dimension("profitability", "Profitability", "What are net profit and net margin?"),
            _dimension("cash", "Cash conversion", "What are operating cash flow and cash-to-profit conversion?"),
            _dimension("leverage", "Debt and equity", "What are debt, equity and debt/equity?"),
            _dimension("valuation", "Valuation", "What stored period-specific PE and PB observations exist?"),
            *_COMMON,
        ],
    },
    {
        "playbook_id": "bank",
        "label": "Banks",
        "description": "Accounting profit, equity and assets. Accounting loan/deposit and equity/assets are NOT regulatory LDR or CAR. NIM and NPL require explicit named observations.",
        "definition_revision": DEFINITION_REVISION,
        "dimensions": [
            _dimension("profitability", "Profit and return", "What are net profit and explicitly stored ROE?"),
            _dimension("funding", "Accounting funding", "What are explicitly identified loans/deposits and their accounting ratio (not regulatory LDR)?"),
            _dimension("capital", "Accounting capital", "What are equity/assets (not CAR)?"),
            _dimension("credit", "Margin and credit quality", "Are explicitly defined NIM and NPL observations retained, without proxy substitution?"),
            _dimension("valuation", "Book valuation", "What period-specific PB is retained?"),
            *_COMMON,
        ],
    },
    {
        "playbook_id": "insurer",
        "label": "Insurers",
        "description": "Subtype-aware profit and book valuation. Generic revenue is never premiums; underwriting and solvency require dedicated definitions and source fields.",
        "definition_revision": DEFINITION_REVISION,
        "dimensions": [
            _dimension("profitability", "Profit and book", "What are net profit and book equity?"),
            _dimension("insurance", "Insurance operations", "Are explicit premiums, claims and investment-income observations available?"),
            _dimension("underwriting", "Underwriting and solvency", "Are defined underwriting and regulatory solvency observations retained?"),
            _dimension("valuation", "Book valuation", "What period-specific PB is retained?"),
            *_COMMON,
        ],
    },
    {
        "playbook_id": "securities",
        "label": "Securities companies",
        "description": "Profit and book valuation with explicit brokerage, margin-loan and investment-income observations only. No regulatory capital proxy.",
        "definition_revision": DEFINITION_REVISION,
        "dimensions": [
            _dimension("profitability", "Profit and book", "What are net profit and book equity?"),
            _dimension("securities", "Securities operations", "Are explicit brokerage, margin-loan and investment-income observations retained?"),
            _dimension("capital", "Regulatory capital", "Is a defined securities regulatory-capital observation retained?"),
            _dimension("valuation", "Book valuation", "What period-specific PB is retained?"),
            *_COMMON,
        ],
    },
]


def normalized_classification(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "").replace("đ", "d").replace("Đ", "D")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", "".join(c for c in text if not unicodedata.combining(c)).lower()).split())


def classify_sector(*values: str | None) -> tuple[str | None, str | None]:
    text = " ".join(normalized_classification(value) for value in values if value)
    if not text:
        return None, None
    if any(token in text for token in ("insurance", "bao hiem", "reinsurance", "tai bao hiem")):
        subtype = "unspecified"
        if "reinsurance" in text or "tai bao hiem" in text:
            subtype = "reinsurance"
        elif "non life" in text or "phi nhan tho" in text:
            subtype = "non-life"
        elif "life insurance" in text or "nhan tho" in text:
            subtype = "life"
        return "insurer", subtype
    if any(token in text for token in ("securities", "chung khoan", "investment banking", "brokerage")):
        return "securities", None
    if any(token in text for token in ("bank", "ngan hang")):
        return "bank", None
    if any(token in text for token in ("financial", "tai chinh", "unknown", "unclassified", "other", "khac")):
        return None, None
    nonfinancial = (
        "technology", "cong nghe", "software", "phan mem", "industrial", "cong nghiep",
        "manufactur", "san xuat", "consumer", "tieu dung", "retail", "ban le", "energy",
        "nang luong", "oil", "dau khi", "utility", "utilities", "dien", "water", "nuoc",
        "material", "vat lieu", "steel", "thep", "real estate", "bat dong san", "property",
        "health", "y te", "pharma", "duoc", "telecom", "vien thong", "transport", "van tai",
        "logistics", "agricultur", "nong nghiep", "food", "thuc pham", "chemical", "hoa chat",
        "construction", "xay dung", "textile", "det may", "tourism", "du lich", "mining", "khai khoang",
    )
    return ("nonfinancial", None) if any(token in text for token in nonfinancial) else (None, None)
