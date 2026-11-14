"""Credential policy must refuse, redact and sign without disclosing values (#231)."""

import hashlib
import hmac

import pytest

from vnibb.core.exceptions import ProviderCredentialRefusedError
from vnibb.providers import credential_policy

KEY = "synthetic-key-value-not-a-real-credential"
SECRET = "synthetic-secret-value-not-a-real-credential"


def test_absent_and_present_credentials_are_reported_by_name_not_value():
    absent = credential_policy.credential_presence("dnse", {})
    present = credential_policy.credential_presence(
        "dnse", {"DNSE_API_KEY": KEY, "DNSE_API_SECRET": SECRET}
    )
    assert absent == {"DNSE_API_KEY": False, "DNSE_API_SECRET": False}
    assert present == {"DNSE_API_KEY": True, "DNSE_API_SECRET": True}


def test_fhsc_uses_documented_finhay_variable_names():
    assert credential_policy.required_variables("fhsc") == (
        "FINHAY_API_KEY", "FINHAY_API_SECRET",
    )


def test_acquisition_refuses_even_when_every_credential_is_present():
    """A credential is not a permission; presence must not enable acquisition."""
    with pytest.raises(ProviderCredentialRefusedError) as excinfo:
        credential_policy.refuse_acquisition(
            "fhsc", {"FINHAY_API_KEY": KEY, "FINHAY_API_SECRET": SECRET}
        )
    message = str(excinfo.value)
    assert credential_policy.REFUSAL_REASON in message
    assert "present" in message
    assert KEY not in message and SECRET not in message
    assert excinfo.value.capability == credential_policy.REFUSAL_REASON


def test_ssi_is_refused_as_excluded_rather_than_unknown():
    with pytest.raises(ProviderCredentialRefusedError, match="exclude this use"):
        credential_policy.refuse_acquisition("ssi", {})


def test_unknown_source_is_a_programming_error_not_a_refusal():
    with pytest.raises(ValueError, match="Unknown direct provider source"):
        credential_policy.required_variables("vci")


def test_redact_headers_masks_credential_material_only():
    redacted = credential_policy.redact_headers(
        {
            "x-api-key": KEY,
            "x-Signature": "deadbeef",
            "Date": "Thu, 14 Nov 2026 10:00:00 GMT",
            "nonce": "abc123",
            "x-client_secret": SECRET,
        }
    )
    assert redacted["x-api-key"] == credential_policy.REDACTED
    assert redacted["x-Signature"] == credential_policy.REDACTED
    assert redacted["x-client_secret"] == credential_policy.REDACTED
    assert redacted["Date"] == "Thu, 14 Nov 2026 10:00:00 GMT"
    assert redacted["nonce"] == "abc123"
    rendered = repr(redacted)
    assert KEY not in rendered and SECRET not in rendered


def test_dnse_signing_matches_hmac_over_method_path_date_nonce():
    headers = credential_policy.dnse_headers(
        "GET",
        "/price/ohlc",
        environ={"DNSE_API_KEY": KEY, "DNSE_API_SECRET": SECRET},
        date_header="Thu, 14 Nov 2026 10:00:00 GMT",
        nonce="n-1",
    )
    expected = hmac.new(
        SECRET.encode(),
        b"get /price/ohlc\nThu, 14 Nov 2026 10:00:00 GMT\nn-1",
        hashlib.sha256,
    ).hexdigest()
    assert headers["x-Signature"] == expected
    assert headers["x-api-key"] == KEY
    # The signing preview renderable for diagnostics never carries the secret.
    assert SECRET not in repr(credential_policy.redact_headers(headers))


def test_signing_refuses_when_a_credential_is_missing_and_names_it_only():
    with pytest.raises(ProviderCredentialRefusedError) as excinfo:
        credential_policy.dnse_headers(
            "GET", "/price/ohlc",
            environ={"DNSE_API_KEY": KEY},
            date_header="Thu, 14 Nov 2026 10:00:00 GMT", nonce="n-1",
        )
    message = str(excinfo.value)
    assert "DNSE_API_SECRET=absent" in message
    assert KEY not in message


def test_refusal_preview_is_diagnosable_and_secret_free():
    preview = credential_policy.refusal_preview(
        "dnse", {"DNSE_API_KEY": KEY, "DNSE_API_SECRET": SECRET}
    )
    assert preview["available"] is False
    assert preview["reason"] == credential_policy.REFUSAL_REASON
    assert preview["credentials"] == {"DNSE_API_KEY": True, "DNSE_API_SECRET": True}
    rendered = repr(preview)
    assert KEY not in rendered and SECRET not in rendered


def test_rotating_one_source_leaves_the_other_source_intact():
    environ = {
        "DNSE_API_KEY": KEY,
        "DNSE_API_SECRET": SECRET,
        "FINHAY_API_KEY": KEY,
        "FINHAY_API_SECRET": SECRET,
    }
    rotated = {**environ, "DNSE_API_SECRET": "rotated-synthetic-value"}
    assert credential_policy.credential_presence("fhsc", rotated) == {
        "FINHAY_API_KEY": True, "FINHAY_API_SECRET": True,
    }
    assert credential_policy.credential_presence("dnse", rotated)["DNSE_API_SECRET"] is True
    assert "rotated-synthetic-value" not in repr(
        credential_policy.refusal_preview("dnse", rotated)
    )
