"""The capture and extraction pipeline (spec 10.2).

Order is load-bearing:
  1. persist Source           - nothing the traveller sent is ever lost
  2. identify source type     - and whatever metadata came with it
  3. obtain text              - public text, transcript, OCR
  4. produce typed candidates - with evidence and confidence
  5. resolve through provider - place-like candidates only
  6. deduplicate              - deterministic rules before similarity
  7. ask the user             - nothing is saved without confirmation
  8. save approved records
  9. enrich in the background
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters import get_ai, get_places, get_storage
from app.adapters.base import MediaPayload, ResolvedPlace
from app.adapters.storage import fingerprint, scan_for_malware, text_fingerprint
from app.models.capture import (
    ExtractionCandidate,
    KnowledgeItem,
    Source,
    SourcePlaceEvidence,
)
from app.models.enums import (
    PLACE_LIKE_TYPES,
    CandidateStatus,
    FactKind,
    KnowledgeType,
    PlaceCategory,
    PlaceStatus,
    Provenance,
    SourceKind,
    SourceStatus,
)
from app.models.places import Place, PlaceFact, TripPlace
from app.schemas.extraction import KnowledgeCandidate
from app.services.dedupe import find_duplicate, find_duplicate_for_resolved, merge_places
from app.services.text import normalize_name

HOURS_TTL = timedelta(days=7)


class CaptureError(ValueError):
    pass


class DuplicateSourceError(CaptureError):
    def __init__(self, source: Source) -> None:
        super().__init__("This source was already imported.")
        self.source = source


# ---------------------------------------------------------------- capture


def create_source(
    session: Session,
    *,
    trip_id: str,
    kind: SourceKind,
    url: str | None = None,
    text: str | None = None,
    title: str | None = None,
    author: str | None = None,
    published_on: date | None = None,
    filename: str | None = None,
    media_type: str | None = None,
    data: bytes | None = None,
    duration_seconds: float | None = None,
    captured_at: datetime | None = None,
) -> Source:
    """Persist the source before anything else can fail (step 1).

    Re-importing identical content returns the existing record rather than
    creating a second one, so a retried batch never duplicates.
    """
    if not (url or text or data):
        raise CaptureError("A source needs a link, text or a file.")

    storage_key: str | None = None
    byte_size: int | None = None

    if data is not None:
        scan_for_malware(data, media_type)
        digest = fingerprint(data)
        byte_size = len(data)
    else:
        digest = text_fingerprint(url, text)

    existing = session.execute(
        select(Source).where(Source.trip_id == trip_id, Source.fingerprint == digest)
    ).scalar_one_or_none()
    if existing is not None:
        raise DuplicateSourceError(existing)

    source = Source(
        trip_id=trip_id,
        kind=kind,
        status=SourceStatus.QUEUED,
        url=url,
        title=title,
        author=author,
        published_on=published_on,
        raw_text=text,
        filename=filename,
        media_type=media_type,
        byte_size=byte_size,
        duration_seconds=duration_seconds,
        captured_at=captured_at,
        fingerprint=digest,
        provenance=Provenance.USER if kind in (SourceKind.NOTE, SourceKind.MANUAL)
        else Provenance.CREATOR,
    )
    session.add(source)
    session.flush()

    if data is not None:
        storage_key = f"{trip_id}/sources/{source.id}/{filename or 'upload.bin'}"
        get_storage().put(storage_key, data, media_type)
        source.storage_key = storage_key
        # Text-bearing uploads (transcripts, subtitle files, notes) are decoded
        # for extraction; binary media is handed to the AI adapter instead.
        if media_type in ("text/plain", "text/vtt") or (filename or "").lower().endswith(
            (".txt", ".vtt", ".srt", ".md")
        ):
            try:
                source.raw_text = data.decode("utf-8", errors="replace")
            except Exception:  # pragma: no cover - decode is already lenient
                source.raw_text = None
        session.flush()

    return source


# -------------------------------------------------------------- pipeline


def process_source(session: Session, source: Source) -> list[ExtractionCandidate]:
    """Steps 2-6. Produces review-ready candidates; saves nothing to Map."""
    source.status = SourceStatus.PROCESSING
    source.attempts += 1
    source.failure_reason = None
    session.flush()

    ai = get_ai()
    payload = MediaPayload(
        kind=str(source.kind),
        url=source.url,
        text=source.raw_text,
        transcript=source.transcript,
        ocr_text=source.ocr_text,
        filename=source.filename,
        media_type=source.media_type,
        duration_seconds=source.duration_seconds,
    )

    if source.storage_key and not (source.transcript or source.ocr_text):
        transcript, ocr_text = ai.transcribe(payload)
        source.transcript = transcript
        source.ocr_text = ocr_text
        payload.transcript = transcript
        payload.ocr_text = ocr_text

    result = ai.extract(payload)

    if result.failure_reason:
        # Recoverable, not lost: Inbox keeps it with a retry and manual path.
        source.status = SourceStatus.FAILED
        source.failure_reason = result.failure_reason
        source.processed_at = datetime.now(UTC)
        session.flush()
        return []

    source.title = source.title or result.title
    source.author = source.author or result.author
    source.published_on = source.published_on or result.published_on

    candidates = [
        _persist_candidate(session, source, candidate) for candidate in result.candidates
    ]
    source.status = SourceStatus.NEEDS_REVIEW if candidates else SourceStatus.COMPLETED
    if not candidates:
        source.failure_reason = (
            "Nothing extractable was found. The source is kept - attach it to a place "
            "manually or add a note explaining why it matters."
        )
    source.processed_at = datetime.now(UTC)
    session.flush()
    return candidates


def _persist_candidate(
    session: Session, source: Source, candidate: KnowledgeCandidate
) -> ExtractionCandidate:
    resolutions: list[dict] = []
    duplicate_place_id: str | None = None
    duplicate_reason: str | None = None
    is_place_candidate = candidate.type in PLACE_LIKE_TYPES and candidate.place is not None

    if is_place_candidate:
        resolved = _resolve_place(candidate)
        resolutions = [asdict(option) for option in resolved]

        probe = resolved[0] if resolved else None
        match = (
            find_duplicate_for_resolved(session, probe)
            if probe is not None
            else find_duplicate(
                session,
                name=candidate.place.name,
                lat=candidate.place.lat,
                lon=candidate.place.lon,
            )
        )
        if match is not None:
            duplicate_place_id = match.place.id
            duplicate_reason = match.describe()

    row = ExtractionCandidate(
        source_id=source.id,
        trip_id=source.trip_id,
        type=candidate.type,
        title=candidate.title,
        body=candidate.body,
        category=candidate.category,
        destination_scope=candidate.destination_scope,
        confidence=candidate.confidence,
        is_place_candidate=is_place_candidate,
        evidence_json=json.dumps([e.model_dump() for e in candidate.evidence], ensure_ascii=False),
        resolution_json=json.dumps(resolutions, ensure_ascii=False),
        duplicate_of_place_id=duplicate_place_id,
        duplicate_reason=duplicate_reason,
        happens_on=candidate.happens_on,
        ends_on=candidate.ends_on,
    )
    session.add(row)
    session.flush()
    return row


def _resolve_place(candidate: KnowledgeCandidate) -> list[ResolvedPlace]:
    place = candidate.place
    assert place is not None
    provider = get_places()

    if place.provider_place_id:
        details = provider.details(place.provider_place_id)
        if details is not None:
            return [details]
    return provider.resolve(
        place.name,
        near_lat=place.lat,
        near_lon=place.lon,
        city_hint=place.city_hint or candidate.destination_scope,
    )


# --------------------------------------------------------------- decisions


def approve_candidate(
    session: Session,
    candidate: ExtractionCandidate,
    *,
    reason_saved: str | None = None,
    provider_place_id: str | None = None,
    merge_into_place_id: str | None = None,
    override_name: str | None = None,
    override_lat: float | None = None,
    override_lon: float | None = None,
    override_category: str | None = None,
    destination_id: str | None = None,
) -> dict:
    """Step 7-8. The only path from a candidate to Saved, Map or Knowledge."""
    if candidate.status != CandidateStatus.PENDING:
        raise CaptureError("This candidate has already been decided.")

    # Routed on the flag, not the type: "we stayed at a great hostel" is advice
    # about accommodation, not a pin, and must not demand coordinates.
    if candidate.is_place_candidate or merge_into_place_id or override_lat is not None:
        trip_place = _approve_place(
            session,
            candidate,
            reason_saved=reason_saved,
            provider_place_id=provider_place_id,
            merge_into_place_id=merge_into_place_id,
            override_name=override_name,
            override_lat=override_lat,
            override_lon=override_lon,
            override_category=override_category,
            destination_id=destination_id,
        )
        candidate.status = CandidateStatus.APPROVED
        candidate.resolved_place_id = trip_place.place_id
        candidate.decided_at = datetime.now(UTC)
        _settle_source(session, candidate.source_id)
        return {"kind": "place", "trip_place_id": trip_place.id, "place_id": trip_place.place_id}

    item = _approve_knowledge(
        session, candidate, destination_id=destination_id, note=reason_saved
    )
    candidate.status = CandidateStatus.APPROVED
    candidate.decided_at = datetime.now(UTC)
    _settle_source(session, candidate.source_id)
    return {"kind": "knowledge", "knowledge_item_id": item.id}


def ignore_candidate(session: Session, candidate: ExtractionCandidate) -> None:
    candidate.status = CandidateStatus.IGNORED
    candidate.decided_at = datetime.now(UTC)
    _settle_source(session, candidate.source_id)


def _settle_source(session: Session, source_id: str) -> None:
    """A source leaves Inbox once every candidate has a decision."""
    # The session does not autoflush: without this the candidate just decided
    # still reads as pending and the source never settles.
    session.flush()
    pending = session.execute(
        select(ExtractionCandidate).where(
            ExtractionCandidate.source_id == source_id,
            ExtractionCandidate.status == CandidateStatus.PENDING,
        )
    ).first()
    source = session.get(Source, source_id)
    if source is None:
        return
    source.status = SourceStatus.NEEDS_REVIEW if pending else SourceStatus.COMPLETED


def _approve_place(
    session: Session,
    candidate: ExtractionCandidate,
    *,
    reason_saved: str | None,
    provider_place_id: str | None,
    merge_into_place_id: str | None,
    override_name: str | None,
    override_lat: float | None,
    override_lon: float | None,
    override_category: str | None,
    destination_id: str | None,
) -> TripPlace:
    options = json.loads(candidate.resolution_json or "[]")
    chosen: dict | None = None
    if provider_place_id:
        chosen = next(
            (o for o in options if o.get("provider_place_id") == provider_place_id), None
        )
        if chosen is None:
            details = get_places().details(provider_place_id)
            chosen = asdict(details) if details else None
    elif options:
        chosen = options[0]

    if merge_into_place_id:
        place = session.get(Place, merge_into_place_id)
        if place is None:
            raise CaptureError("The place to merge into no longer exists.")
    else:
        place = _upsert_place(
            session,
            chosen,
            fallback_name=override_name or candidate.title,
            override_name=override_name,
            override_lat=override_lat,
            override_lon=override_lon,
            override_category=override_category,
        )

    trip_place = session.execute(
        select(TripPlace).where(
            TripPlace.trip_id == candidate.trip_id, TripPlace.place_id == place.id
        )
    ).scalar_one_or_none()

    reason = reason_saved or candidate.body or candidate.title
    if trip_place is None:
        trip_place = TripPlace(
            trip_id=candidate.trip_id,
            place_id=place.id,
            destination_id=destination_id,
            status=PlaceStatus.SAVED,
            reason_saved=reason,
            needs_review=candidate.confidence < 0.5,
        )
        session.add(trip_place)
    else:
        # A second source for a known place adds to the reason, never replaces it.
        if reason and reason not in (trip_place.reason_saved or ""):
            trip_place.reason_saved = (
                f"{trip_place.reason_saved}\n{reason}".strip()
                if trip_place.reason_saved
                else reason
            )
        if trip_place.status == PlaceStatus.INBOX:
            trip_place.status = PlaceStatus.SAVED
    session.flush()

    _link_evidence(session, candidate, place)
    if chosen:
        _write_provider_facts(session, place, chosen)
    return trip_place


def _upsert_place(
    session: Session,
    chosen: dict | None,
    *,
    fallback_name: str,
    override_name: str | None,
    override_lat: float | None,
    override_lon: float | None,
    override_category: str | None,
) -> Place:
    name = override_name or (chosen or {}).get("name") or fallback_name
    lat = override_lat if override_lat is not None else (chosen or {}).get("lat")
    lon = override_lon if override_lon is not None else (chosen or {}).get("lon")
    if lat is None or lon is None:
        raise CaptureError(
            "This place has no coordinates yet. Pick a provider match or drop a pin manually."
        )

    match = find_duplicate(
        session,
        name=name,
        lat=lat,
        lon=lon,
        provider=(chosen or {}).get("provider"),
        provider_place_id=(chosen or {}).get("provider_place_id"),
        address=(chosen or {}).get("address"),
        phone=(chosen or {}).get("phone"),
        website=(chosen or {}).get("website"),
        aliases=list((chosen or {}).get("aliases") or []),
    )
    if match is not None and match.is_exact:
        return match.place

    category = override_category or (chosen or {}).get("category") or PlaceCategory.OTHER
    place = Place(
        name=name,
        normalized_name=normalize_name(name),
        category=str(category),
        lat=float(lat),
        lon=float(lon),
        address=(chosen or {}).get("address"),
        city=(chosen or {}).get("city"),
        country=(chosen or {}).get("country"),
        phone=(chosen or {}).get("phone"),
        website=(chosen or {}).get("website"),
        provider=(chosen or {}).get("provider"),
        provider_place_id=(chosen or {}).get("provider_place_id"),
        aliases="|".join((chosen or {}).get("aliases") or []) or None,
    )
    session.add(place)
    session.flush()

    # A weaker match is folded in only after the new canonical record exists,
    # so nothing is lost if the two really were the same place.
    if match is not None and match.rule.value in {"coordinate_and_name", "alias_or_translation"}:
        place = merge_places(session, keep=place, drop=match.place)
    return place


def _link_evidence(session: Session, candidate: ExtractionCandidate, place: Place) -> None:
    evidence = json.loads(candidate.evidence_json or "[]")
    quote = evidence[0]["quote"] if evidence else None
    timestamp = evidence[0].get("media_timestamp_seconds") if evidence else None

    existing = session.execute(
        select(SourcePlaceEvidence).where(
            SourcePlaceEvidence.source_id == candidate.source_id,
            SourcePlaceEvidence.place_id == place.id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return

    session.add(
        SourcePlaceEvidence(
            source_id=candidate.source_id,
            place_id=place.id,
            trip_id=candidate.trip_id,
            takeaway=candidate.body,
            quote=quote,
            media_timestamp_seconds=timestamp,
            confidence=candidate.confidence,
        )
    )
    session.flush()


def _write_provider_facts(session: Session, place: Place, chosen: dict) -> None:
    """Step 9. Provider-grade facts, timestamped and expiring."""
    now = datetime.now(UTC)
    pairs: list[tuple[FactKind, str | None]] = [
        (FactKind.HOURS, chosen.get("opening_hours")),
        (FactKind.PRICE, chosen.get("price_level")),
        (FactKind.PHONE, chosen.get("phone")),
        (FactKind.WEBSITE, chosen.get("website")),
        (FactKind.ADDRESS, chosen.get("address")),
    ]
    for kind, value in pairs:
        if not value:
            continue
        existing = session.execute(
            select(PlaceFact).where(
                PlaceFact.place_id == place.id,
                PlaceFact.kind == kind,
                PlaceFact.provenance == Provenance.PROVIDER,
            )
        ).scalar_one_or_none()
        if existing is not None:
            existing.value = value
            existing.checked_at = now
            existing.expires_at = now + HOURS_TTL
            continue
        session.add(
            PlaceFact(
                place_id=place.id,
                kind=kind,
                value=value,
                provenance=Provenance.PROVIDER,
                source_label=chosen.get("provider"),
                confidence=0.75,
                checked_at=now,
                expires_at=now + HOURS_TTL,
            )
        )
    session.flush()


def _approve_knowledge(
    session: Session,
    candidate: ExtractionCandidate,
    *,
    destination_id: str | None,
    note: str | None = None,
) -> KnowledgeItem:
    source = session.get(Source, candidate.source_id)
    # The traveller's own words go under the claim; nothing typed is dropped.
    note = (note or "").strip()
    body = f"{candidate.body}\n\n{note}".strip() if note else candidate.body
    item = KnowledgeItem(
        trip_id=candidate.trip_id,
        source_id=candidate.source_id,
        destination_id=destination_id,
        type=candidate.type,
        title=candidate.title,
        body=body,
        user_edited=candidate.user_edited or bool(note),
        category=candidate.category,
        destination_scope=candidate.destination_scope,
        confidence=candidate.confidence,
        provenance=source.provenance if source else Provenance.CREATOR,
        evidence_json=candidate.evidence_json,
        source_date=source.published_on if source else None,
        happens_on=candidate.happens_on,
        ends_on=candidate.ends_on,
        requires_official_verification=KnowledgeType(candidate.type) is KnowledgeType.BORDER,
    )
    session.add(item)
    session.flush()
    return item
