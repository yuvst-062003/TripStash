"""The global Ask endpoint, contextual resurfacing and knowledge editing."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.deps import current_trip, owned_or_404
from app.models.capture import KnowledgeItem
from app.models.core import Trip
from app.models.ops import AgentRun, ItineraryItem
from app.models.places import TripPlace
from app.schemas.api import AskRequest, KnowledgeUpdate
from app.services.assistant import AskContext, ask
from app.services.resurfacing import resurface

router = APIRouter(tags=["assistant"])


@router.post("/ask")
def ask_endpoint(
    body: AskRequest,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    """One assistant, given the current screen's context automatically.

    Read-only: anything that would change trip state comes back under
    `proposed_actions` for the user to confirm (spec 5.5).
    """
    context = AskContext(
        surface=body.surface,
        trip_place_id=body.trip_place_id,
        place_id=body.place_id,
        source_id=body.source_id,
        destination_id=body.destination_id,
        collection_id=body.collection_id,
        lat=body.lat,
        lon=body.lon,
        on=body.on,
        saved_only=body.saved_only,
    )
    answer, latency_ms = ask(session, trip=trip, question=body.question, context=context)

    payload = answer.to_dict(context)
    session.add(
        AgentRun(
            trip_id=trip.id,
            surface=body.surface,
            question=body.question,
            context_json=json.dumps(context.to_dict()),
            tools_json=json.dumps(answer.tools_used),
            citations_json=json.dumps(answer.citations, default=str),
            output_json=json.dumps(
                {"answer": answer.text, "cards": len(answer.cards)}, default=str
            ),
            latency_ms=latency_ms,
        )
    )
    payload["latency_ms"] = latency_ms
    return payload


@router.post("/ask/confirm")
def confirm_action(
    action: dict,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    """Apply an action the assistant proposed, after the user confirmed it."""
    action_type = action.get("type")
    payload = action.get("payload") or {}

    if action_type != "add_to_today":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unsupported action '{action_type}'. Nothing was changed.",
        )

    trip_place = owned_or_404(
        session.get(TripPlace, payload.get("trip_place_id")), trip, "Place not found."
    )
    on = date.fromisoformat(payload.get("on_date") or datetime.now(UTC).date().isoformat())
    item = ItineraryItem(
        trip_id=trip.id,
        trip_place_id=trip_place.id,
        destination_id=trip_place.destination_id,
        title=trip_place.place.name,
        on_date=on,
    )
    session.add(item)
    session.flush()
    return {"applied": action_type, "itinerary_item_id": item.id, "on_date": on.isoformat()}


@router.get("/resurface")
def resurface_endpoint(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    lat: float | None = Query(default=None, ge=-90, le=90),
    lon: float | None = Query(default=None, ge=-180, le=180),
    destination_scope: str | None = Query(default=None),
    on: date | None = Query(default=None),
) -> dict:
    items = resurface(
        session,
        trip_id=trip.id,
        lat=lat,
        lon=lon,
        on=on or datetime.now(UTC).date(),
        destination_scope=destination_scope,
    )
    return {"items": [item.to_dict() for item in items]}


@router.get("/knowledge")
def list_knowledge(
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
    type_filter: list[str] | None = Query(default=None, alias="type"),
    destination_scope: str | None = Query(default=None),
    include_archived: bool = Query(default=False),
) -> list[dict]:
    stmt = select(KnowledgeItem).where(KnowledgeItem.trip_id == trip.id)
    if not include_archived:
        stmt = stmt.where(KnowledgeItem.is_archived.is_(False))
    if type_filter:
        stmt = stmt.where(KnowledgeItem.type.in_(type_filter))
    if destination_scope:
        stmt = stmt.where(KnowledgeItem.destination_scope == destination_scope)

    return [
        {
            "id": item.id,
            "type": item.type,
            "title": item.title,
            "body": item.body,
            "category": item.category,
            "destination_scope": item.destination_scope,
            "confidence": item.confidence,
            "provenance": item.provenance,
            "source_id": item.source_id,
            "source_date": item.source_date.isoformat() if item.source_date else None,
            "requires_official_verification": item.requires_official_verification,
            "user_edited": item.user_edited,
            "is_archived": item.is_archived,
            "evidence": json.loads(item.evidence_json or "[]"),
        }
        for item in session.execute(stmt.order_by(KnowledgeItem.created_at.desc())).scalars()
    ]


@router.patch("/knowledge/{item_id}")
def update_knowledge(
    item_id: str,
    body: KnowledgeUpdate,
    session: Session = Depends(get_session),
    trip: Trip = Depends(current_trip),
) -> dict:
    """Correct, reclassify or archive an item (spec 19.1)."""
    item = owned_or_404(session.get(KnowledgeItem, item_id), trip, "Knowledge item not found.")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(item, field, str(value) if field == "type" else value)
    if changes:
        # Marks the record as the traveller's, so enrichment leaves it alone.
        item.user_edited = True
    session.flush()
    return {"id": item.id, "user_edited": item.user_edited, "is_archived": item.is_archived}
