"""Local, open-weights model adapter.

Speaks the OpenAI-compatible `/v1/chat/completions` API, which every free local
runtime exposes (Ollama, llama.cpp's `llama-server`, LM Studio, vLLM). That one
code path therefore costs nothing to run and is not tied to any vendor.

Three properties matter more than raw model quality here, because this feeds a
product whose premise is that it does not invent things:

  * **Constrained decoding.** The request carries the `ExtractionResult` JSON
    schema, so a 7B model cannot drift out of the contract.
  * **One repair attempt.** A schema violation is fed back verbatim once. A
    second failure is a failure, not an endless retry.
  * **Evidence grounding.** Every candidate must quote the source verbatim, and
    any quote that is not actually present is dropped before the traveller ever
    sees it. This is the guard that makes a small model safe to use here.

If the server is unreachable or the output stays unusable, extraction falls
back to the deterministic rule-based adapter rather than losing the capture.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

import httpx
from pydantic import ValidationError

from app.adapters.ai import FakeAIAdapter
from app.adapters.base import MediaPayload
from app.schemas.extraction import ExtractionResult, KnowledgeCandidate
from app.services.text import normalize_name

logger = logging.getLogger(__name__)

# Long transcripts are trimmed rather than blowing a small model's context.
MAX_SOURCE_CHARS = 8000

SYSTEM_PROMPT = """\
You extract structured travel knowledge from something a traveller saved.

Return ONLY JSON matching the provided schema. Follow these rules exactly:

1. Extract only what the text states. Never add a place, price, rule or warning \
that is not there. An empty candidate list is a correct answer.
2. Every candidate MUST include at least one evidence quote copied VERBATIM from \
the source text - the same characters, not a paraphrase. Quotes that are not \
present word for word are discarded.
3. Use the narrowest correct type: place, accommodation, safety, border, \
transport, route, price, packing, general.
4. `title` is a short label, at most about eight words. Put the full sentence in \
`body`. Do not repeat the sentence as the title.
5. Set `place` only when the text names a specific, findable location. A general \
tip about hostels is `accommodation` knowledge with no `place`.
6. `confidence` is your own calibrated estimate from 0 to 1. Use below 0.5 when \
the text is vague or the name is uncertain.
7. Set `requires_official_verification` to true for any visa, border, entry or \
exit-fee claim. Those are never settled by a creator.
8. Prices and durations stated by a creator are estimates. Record them as given; \
do not convert, round or update them.
"""


@dataclass(slots=True)
class ExtractionHints:
    """The traveller's own context, used to steer the model without training.

    Destinations narrow place resolution; the examples are items this traveller
    already approved or corrected, which is the cheapest and most immediate form
    of adaptation to their data.
    """

    destinations: list[str]
    examples: list[dict]


def _build_source_text(payload: MediaPayload) -> str:
    parts: list[str] = []
    if payload.text:
        parts.append(f"[{'caption' if payload.url else 'text'}]\n{payload.text}")
    if payload.transcript:
        parts.append(f"[transcript]\n{payload.transcript}")
    if payload.ocr_text:
        parts.append(f"[ocr]\n{payload.ocr_text}")
    joined = "\n\n".join(parts)
    if len(joined) > MAX_SOURCE_CHARS:
        joined = joined[:MAX_SOURCE_CHARS] + "\n[truncated]"
    return joined


def _build_user_prompt(source_text: str, hints: ExtractionHints | None) -> str:
    blocks: list[str] = []

    if hints and hints.destinations:
        blocks.append(
            "This traveller's route includes: " + ", ".join(hints.destinations[:12]) + "."
        )

    if hints and hints.examples:
        rendered = json.dumps(hints.examples[:4], ensure_ascii=False, indent=2)
        blocks.append(
            "Items this traveller has already approved or corrected, as a guide to "
            f"their labelling:\n{rendered}"
        )

    blocks.append(f"SOURCE TEXT:\n{source_text}")
    return "\n\n".join(blocks)


def _quote_is_present(quote: str, source_text: str) -> bool:
    """Verbatim check, tolerant of whitespace, case and accents only.

    A model that paraphrases has invented something, which is exactly what must
    not reach the review screen.
    """
    needle = normalize_name(quote)
    if len(needle) < 8:
        return False
    return needle in normalize_name(source_text)


def ground_candidates(
    candidates: list[KnowledgeCandidate], source_text: str
) -> tuple[list[KnowledgeCandidate], int]:
    """Keep only candidates whose evidence really appears in the source."""
    kept: list[KnowledgeCandidate] = []
    dropped = 0
    for candidate in candidates:
        supported = [e for e in candidate.evidence if _quote_is_present(e.quote, source_text)]
        if not supported:
            dropped += 1
            continue
        candidate.evidence = supported
        kept.append(candidate)
    return kept, dropped


class LocalLLMAdapter:
    """Structured extraction against a locally served open-weights model."""

    name = "local"

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        timeout_seconds: float = 120.0,
        api_key: str | None = None,
        temperature: float = 0.0,
        fallback: FakeAIAdapter | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.api_key = api_key
        self.temperature = temperature
        # Rules keep the pipeline working when the model server is not running.
        self.fallback = fallback or FakeAIAdapter()

    # -- media -----------------------------------------------------------

    def transcribe(self, payload: MediaPayload) -> tuple[str | None, str | None]:
        """Text-bearing uploads only; no speech-to-text is wired up yet.

        Returning nothing sends the source down the recoverable-failure path
        instead of fabricating a transcript.
        """
        return self.fallback.transcribe(payload)

    # -- extraction ------------------------------------------------------

    def extract(
        self, payload: MediaPayload, hints: ExtractionHints | None = None
    ) -> ExtractionResult:
        source_text = _build_source_text(payload)
        if not source_text.strip():
            return ExtractionResult(
                failure_reason=(
                    "No readable text, transcript or OCR output was available for this "
                    "source. It stays in Inbox - add a caption, screenshot or note, or "
                    "enter the place manually."
                )
            )

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(source_text, hints)},
        ]

        try:
            result = self._complete(messages)
        except httpx.HTTPError as exc:
            logger.warning("local model unreachable (%s); using rule-based extraction", exc)
            return self._fallback(payload, "the model server could not be reached")

        if result is None:
            return self._fallback(payload, "the model did not return usable JSON")

        kept, dropped = ground_candidates(result.candidates, source_text)
        if dropped:
            logger.info("dropped %s candidate(s) whose evidence was not in the source", dropped)
        result.candidates = kept
        return result

    def _complete(self, messages: list[dict]) -> ExtractionResult | None:
        schema = ExtractionResult.model_json_schema()

        raw = self._chat(messages, schema)
        parsed = self._parse(raw)
        if parsed is not None:
            return parsed

        # One repair attempt, with the failure handed back verbatim.
        repair = [
            *messages,
            {"role": "assistant", "content": raw[:2000]},
            {
                "role": "user",
                "content": (
                    "That was not valid against the schema. Return ONLY a JSON object "
                    "matching the schema, with no commentary and no code fences."
                ),
            },
        ]
        return self._parse(self._chat(repair, schema))

    def _chat(self, messages: list[dict], schema: dict) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        body = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "stream": False,
            # OpenAI-compatible constrained decoding. Servers that do not
            # support it ignore the field and the schema still travels in the
            # prompt, so the repair attempt can recover.
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "extraction_result", "schema": schema},
            },
            # Ollama reads its own `format` field for the same purpose.
            "format": schema,
        }

        with httpx.Client(timeout=self.timeout_seconds) as client:
            response = client.post(f"{self.base_url}/chat/completions", json=body, headers=headers)
            response.raise_for_status()
            payload = response.json()

        try:
            return payload["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            logger.warning("unexpected completion shape: %s", str(payload)[:400])
            return ""

    @staticmethod
    def _parse(raw: str) -> ExtractionResult | None:
        if not raw.strip():
            return None
        text = raw.strip()
        # Small models still wrap JSON in fences now and then.
        fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
        if fence:
            text = fence.group(1)
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            return None
        try:
            return ExtractionResult.model_validate_json(text[start : end + 1])
        except ValidationError as exc:
            logger.info("schema validation failed: %s", str(exc)[:300])
            return None
        except ValueError:
            return None

    def _fallback(self, payload: MediaPayload, why: str) -> ExtractionResult:
        result = self.fallback.extract(payload)
        if result.candidates:
            result.summary = (
                f"Extracted with the offline rule-based reader because {why}."
                + (f" {result.summary}" if result.summary else "")
            )
        elif not result.failure_reason:
            result.failure_reason = (
                f"Nothing could be extracted: {why}, and the offline reader found nothing. "
                "The source is kept - retry, or add the place manually."
            )
        return result
