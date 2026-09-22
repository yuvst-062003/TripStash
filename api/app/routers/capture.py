"""Global Save: links, text, uploads, and the review queue."""

from __future__ import annotations

import json
import mimetypes

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.adapters import get_storage
from app.adapters.storage import ALLOWED_MEDIA_TYPES, SignatureError, UnsupportedMediaError
from app.config import get_settings
from app.db import get_session
from app.deps import audit, current_trip, current_user, owned_or_404
from app.models.capture import ExtractionCandidate, MediaStage, Source
from app.models.core import Trip, User
from app.models.enums import CandidateStatus, SourceKind
from app.schemas.api import (
    ApproveCandidate,
    CandidateEdit,
    CandidateResponse,
    KnownFingerprints,
    KnownFingerprintsResponse,
    LinkCapture,
    MediaStageResponse,
    SourceResponse,
)
from app.services.extraction import (
    CaptureError,
    DuplicateSourceError,
    approve_candidate,
    create_source,
    ignore_candidate,
)
from app.worker import enqueue_source_processing

router = APIRouter(tags=["capture"])

# Friendly names for the paths that can recover a caption, best first.
READER_LABELS = {
    "share-target": "share sheet",
    "browser-oembed": "browser · oEmbed",
    "manual": "typed by you",
}


def _serialise_source(session: Session, source: Source) -> SourceResponse:
    counts = session.execute(
        select(
            func.count(ExtractionCandidate.id),
            func.sum(case((ExtractionCandidate.status == CandidateStatus.PENDING, 1), else_=0)),
        ).where(ExtractionCandidate.source_id == source.id)
    ).one()
    file_url = get_storage().signed_url(source.storage_key) if source.storage_key else None
    return SourceResponse(
        id=source.id,
        kind=str(source.kind),
        status=str(source.status),
        url=source.url,
        title=source.title,
        author=source.author,
        filename=source.filename,
        media_type=source.media_type,
        byte_size=source.byte_size,
        published_on=source.published_on,
        created_at=source.created_at,
        processed_at=source.processed_at,
        failure_reason=source.failure_reason,
        attempts=source.attempts,
        candidate_count=int(counts[0] or 0),
        pending_count=int(counts[1] or 0),
        file_url=file_url,
        duration_seconds=source.duration_seconds,
        stages=[MediaStageResponse.model_validate(stage) for stage in source.stages],
        transcript_chars=len(source.transcript or ""),
        ocr_chars=len(source.ocr_text or ""),
    )


def _serialise_candidate(candidate: ExtractionCandidate) -> CandidateResponse:
    return CandidateResponse(
        id=candidate.id,
        source_id=candidate.source_id,
        type=candidate.type,
        status=str(candidate.status),
        title=candidate.title,
        body=candidate.body,
        category=candidate.category,
        destination_scope=candidate.destination_scope,
        confidence=candidate.confidence,
        is_place_candidate=candidate.is_place_candidate,
        evidence=json.loads(candidate.evidence_json or "[]"),
        resolutions=json.loads(candidate.resolution_json or "[]"),
        duplicate_of_place_id=candidate.duplicate_of_place_id,
        duplicate_reason=candidate.duplicate_reason,
    )


# --------------------------------------------------------------- capture


@router.post("/sources", response_model=SourceResponse, status_code=status.HTTP_201_CREATED)
def capture_link(
    body: LinkCapture,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> SourceResponse:
    """Paste a link, article, message or note."""
    try:
        source = create_source(
            session,
            trip_id=trip.id,
            kind=body.kind,
            url=body.url,
            text=body.text,
            title=body.title,
            author=body.author,
            published_on=body.published_on,
        )
    except DuplicateSourceError as exc:
        # Re-importing the same thing returns the original rather than a copy.
        return _serialise_source(session, exc.source)
    except CaptureError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    # The client can read a link the server cannot: it is on the traveller's own
    # connection rather than a datacenter IP. Record which path supplied the
    # text so the status is honest about it.
    if body.reader and body.text:
        session.add(
            MediaStage(
                source_id=source.id,
                position=0,
                name="link",
                engine=READER_LABELS.get(body.reader, body.reader),
                status="ok",
                duration_ms=0,
                detail=f"caption of {len(body.text)} chars supplied by the client",
            )
        )

    session.commit()
    enqueue_source_processing(source.id, background)
    session.refresh(source)
    return _serialise_source(session, source)


@router.post(
    "/sources/upload", response_model=list[SourceResponse], status_code=status.HTTP_201_CREATED
)
async def capture_upload(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    note: str | None = Form(default=None),
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> list[SourceResponse]:
    """Batch import of screenshots, photos and downloaded videos (spec 7.5).

    Each file becomes its own Source with a content hash, so a retried batch
    never duplicates and a single bad file cannot fail the rest.
    """
    settings = get_settings()
    out: list[SourceResponse] = []

    for upload in files:
        data = await upload.read()
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"{upload.filename} is larger than the {settings.max_upload_bytes // 1048576} MB "
                "limit. Compress it or select a shorter clip.",
            )
        if upload.content_type and upload.content_type not in ALLOWED_MEDIA_TYPES:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                f"{upload.content_type} is not accepted. Supported: "
                f"{', '.join(sorted(ALLOWED_MEDIA_TYPES))}.",
            )

        kind = SourceKind.VIDEO if (upload.content_type or "").startswith("video") else (
            SourceKind.IMAGE if (upload.content_type or "").startswith("image") else SourceKind.NOTE
        )
        try:
            source = create_source(
                session,
                trip_id=trip.id,
                kind=kind,
                text=note,
                filename=upload.filename,
                media_type=upload.content_type,
                data=data,
            )
        except DuplicateSourceError as exc:
            out.append(_serialise_source(session, exc.source))
            continue
        except UnsupportedMediaError as exc:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(exc)) from exc
        except CaptureError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

        session.commit()
        enqueue_source_processing(source.id, background)
        session.refresh(source)
        out.append(_serialise_source(session, source))

    return out


@router.post("/sources/known", response_model=KnownFingerprintsResponse)
def known_fingerprints(
    body: KnownFingerprints,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> KnownFingerprintsResponse:
    """Which of these have been imported already?

    The device hashes each file locally and asks before sending anything, so
    selecting the whole album again costs a handful of kilobytes instead of
    re-uploading everything. Hashes are opaque; nothing about a file that is
    not already saved is revealed by asking.
    """
    offered = {value.strip().lower() for value in body.fingerprints if value.strip()}
    if not offered:
        return KnownFingerprintsResponse(known=[], new_count=0)

    rows = session.execute(
        select(Source.fingerprint).where(
            Source.trip_id == trip.id, Source.fingerprint.in_(offered)
        )
    ).scalars()
    known = sorted(set(rows))
    return KnownFingerprintsResponse(known=known, new_count=len(offered) - len(known))


@router.get("/sources", response_model=list[SourceResponse])
def list_sources(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[SourceResponse]:
    stmt = select(Source).where(Source.trip_id == trip.id).order_by(Source.created_at.desc())
    if status_filter:
        stmt = stmt.where(Source.status == status_filter)
    return [_serialise_source(session, s) for s in session.execute(stmt).scalars()]


@router.post("/sources/{source_id}/retry", response_model=SourceResponse)
def retry_source(
    source_id: str,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> SourceResponse:
    """The recovery path a failed extraction must always have (spec 12)."""
    source = owned_or_404(session.get(Source, source_id), trip, "Source not found.")
    session.commit()
    enqueue_source_processing(source.id, background)
    session.refresh(source)
    return _serialise_source(session, source)


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(
    source_id: str,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    user: User = Depends(current_user),
) -> None:
    """Delete the original media after extraction, if the traveller wants to."""
    source = owned_or_404(session.get(Source, source_id), trip, "Source not found.")
    if source.storage_key:
        get_storage().delete(source.storage_key)
    audit(session, user_id=user.id, action="source.delete", subject=source.id)
    session.delete(source)


# ---------------------------------------------------------------- review


@router.get("/inbox", response_model=list[CandidateResponse])
def list_inbox(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    source_id: str | None = Query(default=None),
) -> list[CandidateResponse]:
    """Everything awaiting a decision, grouped client-side by type."""
    stmt = (
        select(ExtractionCandidate)
        .where(
            ExtractionCandidate.trip_id == trip.id,
            ExtractionCandidate.status == CandidateStatus.PENDING,
        )
        .order_by(ExtractionCandidate.confidence.desc())
    )
    if source_id:
        stmt = stmt.where(ExtractionCandidate.source_id == source_id)
    return [_serialise_candidate(c) for c in session.execute(stmt).scalars()]


@router.patch("/candidates/{candidate_id}", response_model=CandidateResponse)
def edit_candidate(
    candidate_id: str,
    body: CandidateEdit,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> CandidateResponse:
    candidate = owned_or_404(
        session.get(ExtractionCandidate, candidate_id), trip, "Candidate not found."
    )
    if candidate.status != CandidateStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, "This candidate was already decided.")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(candidate, field, value)
    session.flush()
    return _serialise_candidate(candidate)


@router.post("/candidates/{candidate_id}/approve")
def approve(
    candidate_id: str,
    body: ApproveCandidate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    candidate = owned_or_404(
        session.get(ExtractionCandidate, candidate_id), trip, "Candidate not found."
    )
    try:
        return approve_candidate(
            session,
            candidate,
            reason_saved=body.reason_saved,
            provider_place_id=body.provider_place_id,
            merge_into_place_id=body.merge_into_place_id,
            override_name=body.override_name,
            override_lat=body.override_lat,
            override_lon=body.override_lon,
            override_category=str(body.override_category) if body.override_category else None,
            destination_id=body.destination_id,
        )
    except CaptureError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.post("/candidates/{candidate_id}/ignore", status_code=status.HTTP_204_NO_CONTENT)
def ignore(
    candidate_id: str,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> None:
    candidate = owned_or_404(
        session.get(ExtractionCandidate, candidate_id), trip, "Candidate not found."
    )
    ignore_candidate(session, candidate)


# ----------------------------------------------------------------- files


# Keys are generated internally from the uploaded filename, so the extension
# is the only type hint the signed URL carries. Anything unrecognised is served
# as an opaque download rather than guessed at.
def _served_media_type(key: str) -> str:
    guessed, _ = mimetypes.guess_type(key)
    return guessed if guessed in ALLOWED_MEDIA_TYPES else "application/octet-stream"


def _parse_range(header: str, size: int) -> tuple[int, int] | None:
    """A single `bytes=` range, clamped to the file. Anything else plays whole."""
    if not header.startswith("bytes=") or "," in header:
        return None
    first, _, last = header[len("bytes=") :].strip().partition("-")
    try:
        if not first:
            # A suffix range: the final N bytes.
            length = int(last)
            if length <= 0:
                return None
            return max(0, size - length), size - 1
        start = int(first)
        end = int(last) if last else size - 1
    except ValueError:
        return None
    end = min(end, size - 1)
    if start > end or start >= size:
        return None
    return start, end


@router.get("/files/{key:path}")
def get_file(
    key: str,
    request: Request,
    expires: int = Query(...),
    signature: str = Query(...),
) -> Response:
    """Short-lived signed access; the storage root is never publicly served.

    Range requests are answered because the video feed opens each clip at the
    second it was saved from, and a browser can only seek into a response that
    advertises `Accept-Ranges`.
    """
    storage = get_storage()
    try:
        storage.verify(key, expires, signature)
        size = storage.size(key)
        requested = _parse_range(request.headers.get("range", ""), size)
        data = storage.read_range(key, *requested) if requested else storage.get(key)
    except SignatureError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found.") from exc

    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600"}
    if requested is None:
        return Response(content=data, media_type=_served_media_type(key), headers=headers)
    start, end = requested
    headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return Response(
        content=data,
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type=_served_media_type(key),
        headers=headers,
    )
