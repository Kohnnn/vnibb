"""Source identities admitted by SQL financial readers.

Issuer reports remain withheld until field-bound evidence and ownership-safe
persistence are implemented and reviewed. Four nonempty evidence fields do
not establish a row's fiscal identity, basis, units, or reported values.
"""

from __future__ import annotations

PRIMARY_FINANCIAL_SOURCES: tuple[str, ...] = ("vietcap",)
SECONDARY_FINANCIAL_SOURCES: tuple[str, ...] = ("VCI",)
# ponytail: add issuer sources only with field-bound admission and ownership-safe writes.

# Order matters: readers pick the first source that has rows.
ADMITTED_FINANCIAL_SOURCES: tuple[str, ...] = (
    *PRIMARY_FINANCIAL_SOURCES,
    *SECONDARY_FINANCIAL_SOURCES,
)
