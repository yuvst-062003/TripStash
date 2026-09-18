"""Export the review queue's decisions as fine-tuning data.

    python -m app.export_training > tripstash-sft.jsonl

Each line is one source and exactly the items the traveller kept, in the chat
format the common LoRA trainers expect.
"""

from __future__ import annotations

import json
import sys

from sqlalchemy import select

from app.adapters.local_llm import SYSTEM_PROMPT
from app.db import session_scope
from app.models.core import Trip
from app.services.adaptation import export_training_examples, training_readiness


def main() -> int:
    with session_scope() as session:
        trip = session.execute(
            select(Trip).where(Trip.is_active.is_(True)).order_by(Trip.created_at.desc())
        ).scalars().first()
        if trip is None:
            print("No active trip found.", file=sys.stderr)
            return 1

        records = export_training_examples(session, trip.id)
        readiness = training_readiness(records)

        for record in records:
            line = {
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"SOURCE TEXT:\n{record['input']}"},
                    {
                        "role": "assistant",
                        "content": json.dumps(record["output"], ensure_ascii=False),
                    },
                ]
            }
            print(json.dumps(line, ensure_ascii=False))

        print(
            f"\n{readiness['sources']} reviewed source(s), "
            f"{readiness['approved_items']} approved and {readiness['rejected_items']} "
            f"rejected item(s). {readiness['advice']}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
