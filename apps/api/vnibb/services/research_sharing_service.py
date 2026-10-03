"""Recipient-only immutable shares. Persistent owner consent ends on expiry/revocation.

Auth is checked live at the router on every operation. This store never retains tokens.
Browser provenance cannot attest provider redistribution rights: source originals are denied.
User-authored classification is a content boundary, not a legal grant or origin attestation.
"""
import copy
import json
import math
import re
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select, text

from vnibb.models.app_kv import AppKeyValue
from vnibb.schemas.research_sharing import (
    MAX_RESEARCH_BUNDLE_BYTES,
    MAX_RESEARCH_SHARES,
    MAX_SHARE_DAYS,
    ResearchBundle,
)
from vnibb.services.matrix_service import require_matrix_export_rights

PREFIX = "research-share:"
FORBIDDEN_KEY = re.compile(r"^(?:__proto__|prototype|constructor|api[-_]?key|access[-_]?token|refresh[-_]?token|authorization|auth[-_]?header|password|secret|client[-_]?secret|private[-_]?key|credentials|system[-_]?prompt|instructions|model[-_]?instructions|developer[-_]?message)$", re.I)
UNSAFE_TEXT = re.compile(r"<\s*/?\s*[a-z][^>]*>|(?:Bearer\s+[A-Za-z0-9._-]{16,})|(?:\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)|(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b)|(?:-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)|(?:\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*[:=]\s*\S+)|(?:<\|(?:im_start|system|developer)\|>)|(?:ignore (?:all |any )?(?:previous|prior) instructions)|(?:\b(?:system|developer) (?:prompt|instructions)\s*:)", re.I)


def _invalid(detail="Invalid research bundle"):
    return HTTPException(status_code=422, detail=detail)


def _uuid(value, *, hidden=False):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status_code=404 if hidden else 422, detail="Research share not found" if hidden else "Expected an authenticated account UUID") from exc


def _date(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Timezone required")
        return parsed.astimezone(UTC)
    except (ValueError, TypeError, AttributeError) as exc:
        raise _invalid("Expected a valid timestamp with timezone") from exc


def _safe(value, depth=0):
    if depth > 20:
        raise _invalid("Research bundle exceeds nesting limit")
    if isinstance(value, str):
        if UNSAFE_TEXT.search(value):
            raise _invalid("Research shares cannot contain credentials, executable HTML or model instructions")
    elif isinstance(value, dict):
        for key, item in value.items():
            if FORBIDDEN_KEY.fullmatch(key):
                raise _invalid("Research bundle contains unsafe fields")
            _safe(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _safe(item, depth + 1)
    elif isinstance(value, float) and not math.isfinite(value):
        raise _invalid("Research bundle contains non-finite data")


def _require_rights(bundle):
    provider_content = any(
        item["kind"] != "note" or item.get("sources") or item.get("agent") is not None
        or item.get("artifact") is not None or item.get("provenance") is not None
        for item in bundle["items"]
    ) or any(entry["thesis"].get("citations") for entry in bundle["theses"])
    if provider_content:
        # Exact Matrix predicate; an unverified browser source never becomes approved
        # by merely claiming an allowlisted supplier or synthetic provenance.
        require_matrix_export_rights({"evidence": [{
            "evidence_id": "unverified-browser-original", "source": "unknown",
            "provenance": "unverified",
        }]})


def validate_bundle(value):
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, TypeError, RecursionError) as exc:
        raise _invalid() from exc
    if len(encoded) > MAX_RESEARCH_BUNDLE_BYTES:
        raise HTTPException(status_code=413, detail="Research snapshot exceeds the 5 MB limit")
    _safe(value)
    if not isinstance(value, dict) or type(value.get("version")) is not int:
        raise _invalid("Unsupported research bundle format or version")
    try:
        bundle = ResearchBundle.model_validate(value).model_dump(mode="json", exclude_none=True)
    except ValidationError as exc:
        raise _invalid() from exc
    _date(bundle["createdAt"])
    item_ids = [item["id"] for item in bundle["items"]]
    if len(item_ids) != len(set(item_ids)):
        raise _invalid("Duplicate notebook IDs")
    for item in bundle["items"]:
        _date(item["createdAt"])
    for entry in bundle["theses"]:
        thesis = entry["thesis"]
        ids = thesis.get("notebookItemIds", [])
        if any(not re.fullmatch(r"nb:[^\s]{1,200}", identifier) for identifier in ids) or len(set(ids)) != len(ids):
            raise _invalid("Invalid notebook references")
        citations = thesis.get("citations", [])
        cited = [citation["itemId"] for citation in citations]
        if len(set(cited)) != len(cited) or any(identifier not in ids for identifier in cited):
            raise _invalid("Invalid thesis citations")
        for citation in citations:
            _date(citation["capturedAt"])
    _require_rights(bundle)
    return bundle


def _summary(value):
    return {key: copy.deepcopy(value[key]) for key in (
        "share_id", "owner_id", "recipient_ids", "created_at", "expires_at", "revoked_at", "thesis_count", "evidence_count",
    )}


async def create_share(db, user_id, request):
    owner = _uuid(user_id)
    recipients = [_uuid(identifier) for identifier in request["recipient_ids"]]
    if not 1 <= len(recipients) <= 20 or len(set(recipients)) != len(recipients) or owner in recipients:
        raise _invalid("Enter 1–20 unique recipient UUIDs other than your own")
    now = datetime.now(UTC)
    expiry = _date(request["expires_at"])
    if not now < expiry <= now + timedelta(days=MAX_SHARE_DAYS):
        raise _invalid("Share expiry must be in the future and within 30 days")
    bundle = validate_bundle(request["bundle"])
    if db.get_bind().dialect.name == "postgresql":
        lock_id = UUID(owner).int % (2**63)
        await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_id})
    count = (await db.execute(select(func.count()).select_from(AppKeyValue).where(
        AppKeyValue.key.startswith(PREFIX), AppKeyValue.value["owner_id"].as_string() == owner,
    ))).scalar_one()
    if count >= MAX_RESEARCH_SHARES:
        raise HTTPException(status_code=409, detail="Research snapshot limit reached (100 per owner)")
    share_id = str(uuid4())
    value = {
        "share_id": share_id, "owner_id": owner, "recipient_ids": recipients,
        "created_at": now.isoformat(), "expires_at": expiry.isoformat(), "revoked_at": None,
        "thesis_count": len(bundle["theses"]), "evidence_count": len(bundle["items"]),
        "bundle": copy.deepcopy(bundle),
    }
    db.add(AppKeyValue(key=f"{PREFIX}{share_id}", value=value))
    await db.commit()
    return _summary(value)


async def list_shares(db, user_id):
    owner = _uuid(user_id)
    rows = (await db.execute(select(AppKeyValue).where(
        AppKeyValue.key.startswith(PREFIX), AppKeyValue.value["owner_id"].as_string() == owner,
    ).order_by(AppKeyValue.updated_at.desc(), AppKeyValue.key).limit(MAX_RESEARCH_SHARES))).scalars().all()
    return [_summary(row.value) for row in rows]


async def _record(db, share_id, *, lock=False):
    key = f"{PREFIX}{_uuid(share_id, hidden=True)}"
    query = select(AppKeyValue).where(AppKeyValue.key == key)
    if lock:
        query = query.with_for_update()
    record = (await db.execute(query)).scalar_one_or_none()
    if not record or not record.value:
        raise HTTPException(status_code=404, detail="Research share not found")
    return record


async def read_share(db, user_id, share_id):
    viewer = _uuid(user_id)
    record = await _record(db, share_id)
    value = record.value
    if (viewer not in [value["owner_id"], *value["recipient_ids"]]
            or value["revoked_at"] or _date(value["expires_at"]) <= datetime.now(UTC)):
        raise HTTPException(status_code=404, detail="Research share not found")
    bundle = validate_bundle(value["bundle"])
    return {**_summary(value), "bundle": copy.deepcopy(bundle)}


async def revoke_share(db, user_id, share_id):
    owner = _uuid(user_id)
    record = await _record(db, share_id, lock=True)
    if record.value["owner_id"] != owner:
        raise HTTPException(status_code=404, detail="Research share not found")
    value = copy.deepcopy(record.value)
    value["revoked_at"] = value["revoked_at"] or datetime.now(UTC).isoformat()
    record.value = value
    await db.commit()
    return {"revoked": True}
