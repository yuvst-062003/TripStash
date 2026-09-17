"""Adapting extraction to one traveller, without training anything.

Every approve, edit and ignore in the review queue is a labelled example. Two
uses follow from that, and they arrive in this order:

  1. **Now, for free.** A handful of the traveller's own approved items travel
     with each extraction request as few-shot examples, along with their route.
     This costs nothing, needs no GPU, and improves results from the first
     correction onwards.
  2. **Later, if it is worth it.** The same decisions export as a supervised
     fine-tuning set. A LoRA becomes reasonable once there are enough real
     corrections - not before, because fine-tuning on a handful of examples
     mostly teaches a model to overfit them.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.local_llm import ExtractionHints
from app.models.capture import ExtractionCandidate, Source
from app.models.core import Destination
from app.models.enums import CandidateStatus
from app.models.places import Place, TripPlace

# Enough to steer labelling, few enough to leave a small model's context free.
MAX_EXAMPLES = 4

# Below this, a fine-tune learns the examples rather than the task.
FINE_TUNE_THRESHOLD = 50


def build_hints(session: Session, trip_id: str) -> ExtractionHints:
    """The traveller's route and their own recent labelling decisions."""
    destinations = [
        name
        for (name,) in session.execute(
            select(Destination.name).where(Destination.trip_id == trip_id)
        ).all()
        if name
    ]
    cities = [
        city
        for (city,) in session.execute(
            select(Place.city)
            .join(TripPlace, TripPlace.place_id == Place.id)
            .where(TripPlace.trip_id == trip_id)
            .distinct()
        ).all()
        if city
    ]

    # Corrected items are worth more than untouched ones: they are the cases
    # where the model and this traveller disagreed.
    approved = list(
        session.execute(
            select(ExtractionCandidate)
            .where(
                ExtractionCandidate.trip_id == trip_id,
                ExtractionCandidate.status == CandidateStatus.APPROVED,
            )
            .order_by(ExtractionCandidate.decided_at.desc())
            .limit(MAX_EXAMPLES * 3)
        ).scalars()
    )

    examples: list[dict] = []
    seen_types: set[str] = set()
    for candidate in approved:
        evidence = json.loads(candidate.evidence_json or "[]")
        if not evidence:
            continue
        # Spread the examples across types rather than showing four places.
        if candidate.type in seen_types and len(examples) >= 2:
            continue
        seen_types.add(str(candidate.type))
        examples.append(
            {
                "quote": evidence[0].get("quote"),
                "item": {
                    "type": str(candidate.type),
                    "title": candidate.title,
                    "category": candidate.category,
                    "destination_scope": candidate.destination_scope,
                },
            }
        )
        if len(examples) >= MAX_EXAMPLES:
            break

    return ExtractionHints(
        destinations=list(dict.fromkeys([*destinations, *cities])),
        examples=examples,
    )


def export_training_examples(session: Session, trip_id: str) -> list[dict]:
    """The review queue's decisions as a supervised fine-tuning set.

    One record per source: the text that went in, and exactly the items the
    traveller kept. A source where everything was ignored is a valid record
    with an empty list - that is how a model learns restraint.
    """
    sources = list(
        session.execute(select(Source).where(Source.trip_id == trip_id)).scalars()
    )
    records: list[dict] = []

    for source in sources:
        decided = list(
            session.execute(
                select(ExtractionCandidate).where(
                    ExtractionCandidate.source_id == source.id,
                    ExtractionCandidate.status.in_(
                        [CandidateStatus.APPROVED, CandidateStatus.IGNORED, CandidateStatus.MERGED]
                    ),
                )
            ).scalars()
        )
        if not decided:
            continue

        text = "\n\n".join(
            part for part in (source.raw_text, source.transcript, source.ocr_text) if part
        )
        if not text.strip():
            continue

        kept = [
            {
                "type": str(candidate.type),
                "title": candidate.title,
                "body": candidate.body,
                "category": candidate.category,
                "destination_scope": candidate.destination_scope,
                "confidence": candidate.confidence,
                "evidence": json.loads(candidate.evidence_json or "[]"),
            }
            for candidate in decided
            if candidate.status == CandidateStatus.APPROVED
        ]

        records.append(
            {
                "source_id": source.id,
                "input": text,
                "output": {"candidates": kept},
                "rejected": sum(
                    1 for c in decided if c.status == CandidateStatus.IGNORED
                ),
            }
        )

    return records


def training_readiness(records: list[dict]) -> dict:
    """Whether there is enough signal to justify fine-tuning at all."""
    approved = sum(len(record["output"]["candidates"]) for record in records)
    rejected = sum(record["rejected"] for record in records)
    return {
        "sources": len(records),
        "approved_items": approved,
        "rejected_items": rejected,
        "threshold": FINE_TUNE_THRESHOLD,
        "ready": len(records) >= FINE_TUNE_THRESHOLD,
        "advice": (
            "Enough decisions to try a LoRA fine-tune."
            if len(records) >= FINE_TUNE_THRESHOLD
            else (
                f"Keep reviewing. Few-shot adaptation is already active; a fine-tune "
                f"needs about {FINE_TUNE_THRESHOLD} reviewed sources to beat it."
            )
        ),
    }
