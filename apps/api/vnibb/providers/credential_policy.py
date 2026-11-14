"""Fail-closed credential policy for direct provider APIs.

A credential is not a permission. No direct provider source (FHSC, DNSE, SSI)
has a storage/public-serving grant on record, so every acquisition path that
would use these keys refuses in every environment, including production, and no
environment variable can enable one. Nothing here reads a key value into a log,
error message or preview: presence is reported as a boolean, and rendered values
are replaced by a fixed redaction string.

Rotating one source's secret must not require touching another's, so custody and
redaction are always scoped to one ``source`` at a time.
"""

from __future__ import annotations

import hashlib
import hmac
from collections.abc import Mapping
from typing import Any, NoReturn

from vnibb.core.exceptions import ProviderCredentialRefusedError

REDACTED = "<redacted>"

#: Documented variable names per direct source. Values never leave the process.
SOURCE_VARIABLES: dict[str, tuple[str, str]] = {
    "fhsc": ("FINHAY_API_KEY", "FINHAY_API_SECRET"),
    "dnse": ("DNSE_API_KEY", "DNSE_API_SECRET"),
}

#: Sources whose own terms exclude this use outright (#232): never pursue.
EXCLUDED_SOURCES: dict[str, str] = {
    "ssi": "ssi_terms_section_3_prohibits_third_party_and_processed_redisplay",
}

REFUSAL_REASON = "provider_source_authorization_missing"


def _source(source: str) -> str:
    normalized = str(source or "").strip().lower()
    if normalized in EXCLUDED_SOURCES:
        raise ProviderCredentialRefusedError(
            f"Refusing {normalized} acquisition: its own terms exclude this use "
            f"({EXCLUDED_SOURCES[normalized]}).",
            provider=normalized,
            capability=REFUSAL_REASON,
        )
    if normalized not in SOURCE_VARIABLES:
        raise ValueError(f"Unknown direct provider source: {source!r}")
    return normalized


def required_variables(source: str) -> tuple[str, str]:
    """Return the two documented variable names for ``source``."""
    return SOURCE_VARIABLES[_source(source)]


def credential_presence(source: str, environ: Mapping[str, str] | None = None) -> dict[str, bool]:
    """Report whether each named variable is set, without disclosing values."""
    import os

    env = os.environ if environ is None else environ
    return {name: bool(str(env.get(name) or "").strip()) for name in required_variables(source)}


def refuse_acquisition(source: str, environ: Mapping[str, str] | None = None) -> NoReturn:
    """Refuse acquisition for ``source`` regardless of credentials or flags.

    Presence is reported so an operator can tell a missing key apart from an
    ungranted source without either value reaching the message.
    """
    normalized = _source(source)
    present = credential_presence(normalized, environ)
    state = ", ".join(f"{name}={'present' if ok else 'absent'}" for name, ok in present.items())
    raise ProviderCredentialRefusedError(
        f"Direct {normalized} acquisition is unavailable: {REFUSAL_REASON}. "
        f"Credentials ({state}) do not establish storage or public-serving rights.",
        provider=normalized,
        capability=REFUSAL_REASON,
    )


def redact_headers(headers: Mapping[str, Any]) -> dict[str, str]:
    """Render request headers for diagnostics with credential material masked."""
    masked: dict[str, str] = {}
    for name, value in headers.items():
        lowered = str(name).lower()
        if lowered in {"x-api-key", "authorization", "x-signature"} or lowered.endswith("_secret"):
            masked[str(name)] = REDACTED
        else:
            masked[str(name)] = str(value)
    return masked


def dnse_headers(
    method: str,
    path: str,
    *,
    environ: Mapping[str, str] | None = None,
    date_header: str,
    nonce: str,
) -> dict[str, str]:
    """Compute DNSE HMAC-SHA256 headers without retaining the secret or signature.

    The signature is returned for the caller to place on the wire; it must never
    be logged. Use :func:`redact_headers` for anything that is rendered.
    """
    import os

    env = os.environ if environ is None else environ
    key_name, secret_name = required_variables("dnse")
    key = str(env.get(key_name) or "").strip()
    secret = str(env.get(secret_name) or "").strip()
    if not key or not secret:
        raise ProviderCredentialRefusedError(
            f"Direct dnse request is unavailable: {REFUSAL_REASON}. "
            f"Credentials ({key_name}={'present' if key else 'absent'}, "
            f"{secret_name}={'present' if secret else 'absent'}) are not an authorization.",
            provider="dnse",
            capability=REFUSAL_REASON,
        )
    target = f"{str(method).lower()} {path}"
    signing = "\n".join((target, str(date_header), str(nonce))).encode()
    signature = hmac.new(secret.encode(), signing, hashlib.sha256).hexdigest()
    return {
        "x-api-key": key,
        "x-Signature": signature,
        "Date": str(date_header),
        "nonce": str(nonce),
    }


def refusal_preview(source: str, environ: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Build a diagnosable refusal payload that contains no credential material."""
    try:
        refuse_acquisition(source, environ)
    except ProviderCredentialRefusedError as exc:
        return {
            "available": False,
            "reason": REFUSAL_REASON,
            "source": str(source).strip().lower(),
            "message": str(exc),
            "credentials": credential_presence(source, environ)
            if str(source).strip().lower() in SOURCE_VARIABLES
            else {},
        }
    raise AssertionError("unreachable")  # pragma: no cover - refuse_acquisition never returns
