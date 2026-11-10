"""DNSE provider contract: signing, unit handling, additive import, no credential echo."""

import logging
from datetime import date

import httpx
import pytest

from vnibb.core.config import settings
from vnibb.core.exceptions import ProviderError
from vnibb.providers import dnse

KEY = "DNSE-KEY-SENTINEL-7f3a"
SECRET = "DNSE-SECRET-SENTINEL-91c2"
BODY_SENTINEL = "BODY-SENTINEL-4e8d"


def test_signature_matches_documented_signing_string():
    headers_list, signature = dnse.build_signature(
        "test-secret", "get", "/price/ohlc",
        "Fri, 15 May 2026 07:11:30 +0000", "26c4b530cf12427d95bf691e39aa8d74",
    )
    assert headers_list == "(request-target) date"
    # base64 of HMAC-SHA256 over the documented signing string, URL-encoded.
    assert signature == "2AX5%2B9OR15av8Qwn876MfqYQQxjPeSLkrkcyqC1Rfaw%3D"


def test_parse_ohlc_maps_epoch_seconds_to_session_dates():
    rows = dnse.parse_ohlc(
        {"t": [1790820000, 1790906400], "o": [59.4, 59.0], "h": [59.6, 59.0],
         "l": [58.5, 57.3], "c": [58.6, 57.3], "v": [3690200, 3579300]},
        price_unit="THOUSAND_VND",
    )
    assert [row["time"] for row in rows] == [date(2026, 10, 1), date(2026, 10, 2)]
    assert rows[0]["close"] == 58.6
    assert rows[0]["volume"] == 3690200
    assert rows[0]["price_unit"] == "THOUSAND_VND"


def test_parse_ohlc_rejects_non_object_payload():
    with pytest.raises(dnse.ProviderError):
        dnse.parse_ohlc([], price_unit="THOUSAND_VND")


@pytest.mark.parametrize(
    "payload",
    [
        {"t": [1790820000, 1790906400], "o": [59.4], "h": [59.6, 59.0],
         "l": [58.5, 57.3], "c": [58.6, 57.3], "v": [1, 2]},
        {"t": [1790820000], "o": [59.4], "h": [59.6], "l": [58.5], "c": [58.6]},
        {"t": [1790820000], "o": 59.4, "h": [59.6], "l": [58.5], "c": [58.6], "v": [1]},
        {"t": ["not-a-date"], "o": [1], "h": [1], "l": [1], "c": [1], "v": [1]},
    ],
)
def test_parse_ohlc_reports_malformed_columns_as_provider_errors(payload):
    with pytest.raises(ProviderError):
        dnse.parse_ohlc(payload, price_unit="THOUSAND_VND")


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(settings, "dnse_enabled", True)
    monkeypatch.setattr(settings, "dnse_api_key", KEY)
    monkeypatch.setattr(settings, "dnse_api_secret", SECRET)


def _transport(response: httpx.Response, seen: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return response

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_error_body_is_never_rendered_into_the_exception(enabled, monkeypatch, caplog):
    """#231: a body that echoes a key/secret must not survive into the error path."""
    body = {"code": "OA-401", "message": f"bad signature for {KEY} / {SECRET} / {BODY_SENTINEL}"}
    seen: list[httpx.Request] = []
    real_client = httpx.AsyncClient

    def client_factory(**kwargs):
        return real_client(transport=_transport(
            httpx.Response(401, json=body), seen
        ), **kwargs)

    monkeypatch.setattr(dnse.httpx, "AsyncClient", client_factory)
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(ProviderError) as caught:
            await dnse.dnse_get("/price/ohlc", {"symbol": "VNM"})

    message = str(caught.value)
    rendered = message + repr(caught.value) + caplog.text
    for sentinel in (KEY, SECRET, BODY_SENTINEL):
        assert sentinel not in rendered
    assert "401" in message and "OA-401" in message
    # The request itself still carried real credentials; only the output is clean.
    assert seen and seen[0].headers["x-api-key"] == KEY


@pytest.mark.asyncio
async def test_signature_header_is_not_logged(enabled, monkeypatch, caplog):
    seen: list[httpx.Request] = []
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        dnse.httpx, "AsyncClient",
        lambda **kwargs: real_client(transport=_transport(httpx.Response(200, json={}), seen), **kwargs),
    )
    with caplog.at_level(logging.DEBUG, logger="vnibb.providers.dnse"):
        await dnse.dnse_get("/price/ohlc")

    signature = seen[0].headers["x-signature"].split('signature="', 1)[1].split('"', 1)[0]
    assert signature and signature not in caplog.text
    assert SECRET not in caplog.text


@pytest.mark.parametrize("failure", ["http_error", "status_401", "status_500"])
@pytest.mark.asyncio
async def test_signature_and_secret_survive_no_failure_path(enabled, monkeypatch, caplog, failure):
    """#231: every failure path is silent about the secret *and* the signature.

    The signature header is credential-equivalent (it authenticates the request
    alongside the key), so a raised httpx error or a non-200 response must not
    surface it in a log record, the exception message, or ``repr(exc)`` — the
    last two because the service copies ``str(exc)`` into a durable receipt.
    """
    seen: list[httpx.Request] = []
    real_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if failure == "http_error":
            raise httpx.ConnectError(f"boom while signing with {SECRET}", request=request)
        return httpx.Response(401 if failure == "status_401" else 500,
                              json={"code": "OA-401", "message": f"echo {SECRET}"})

    monkeypatch.setattr(
        dnse.httpx, "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )
    with caplog.at_level(logging.DEBUG, logger="vnibb.providers.dnse"):
        with pytest.raises(ProviderError) as caught:
            await dnse.dnse_get("/price/ohlc", {"symbol": "VNM"})

    signature = seen[0].headers["x-signature"].split('signature="', 1)[1].split('"', 1)[0]
    assert signature and "%3D" in signature  # a real, encoded signature was produced
    rendered = "\n".join((str(caught.value), repr(caught.value), caplog.text,
                          caught.value.args[0] if caught.value.args else ""))
    for sentinel in (SECRET, KEY, f"signature={signature}", signature):
        assert sentinel not in rendered
    # The header itself was well-formed on the wire; only our output is clean.
    assert seen[0].headers["x-api-key"] == KEY


@pytest.mark.asyncio
async def test_credentials_refused_when_dnse_disabled(monkeypatch):
    monkeypatch.setattr(settings, "dnse_enabled", False)
    monkeypatch.setattr(settings, "dnse_api_key", "key")
    monkeypatch.setattr(settings, "dnse_api_secret", "secret")
    with pytest.raises(dnse.DNSEConfigError):
        await dnse.dnse_get("/price/ohlc")


@pytest.mark.asyncio
async def test_credentials_refused_when_incomplete(monkeypatch):
    monkeypatch.setattr(settings, "dnse_enabled", True)
    monkeypatch.setattr(settings, "dnse_api_key", "key")
    monkeypatch.setattr(settings, "dnse_api_secret", "")
    with pytest.raises(dnse.DNSEConfigError):
        await dnse.dnse_get("/price/ohlc")


def test_settings_never_render_dnse_credentials():
    configured = type(settings)(dnse_enabled=True, dnse_api_key=KEY, dnse_api_secret=SECRET)
    assert KEY not in repr(configured) and SECRET not in repr(configured)
    assert KEY not in str(configured) and SECRET not in str(configured)
    dumped = configured.model_dump()
    assert "dnse_api_key" not in dumped and "dnse_api_secret" not in dumped
    # The declared default stays off regardless of what the environment sets.
    assert type(settings).model_fields["dnse_enabled"].default is False
