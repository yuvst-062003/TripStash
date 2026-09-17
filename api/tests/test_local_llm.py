"""The local open-weights adapter.

No model runs in CI, so a stub OpenAI-compatible server stands in for one. What
is being tested is the part that protects the traveller: the schema contract,
the repair attempt, the evidence-grounding guard, and the fallback.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.adapters.base import MediaPayload
from app.adapters.local_llm import ExtractionHints, LocalLLMAdapter

TRANSCRIPT = (
    "Antigua completely got me. Go to Cerro de la Cruz just before sunset. "
    "Careful with the taxi scam at the bus terminal, they quote four times the normal price."
)


def completion(content: str) -> dict:
    return {"choices": [{"message": {"role": "assistant", "content": content}}]}


def result_json(candidates: list[dict]) -> str:
    return json.dumps({"candidates": candidates})


class _Stub(BaseHTTPRequestHandler):
    responses: list[dict] = []
    requests: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        length = int(self.headers.get("Content-Length", 0))
        _Stub.requests.append(json.loads(self.rfile.read(length) or b"{}"))
        body = _Stub.responses.pop(0) if _Stub.responses else completion("")
        encoded = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *args) -> None:  # noqa: D102 - silence test output
        return


@pytest.fixture
def stub_server():
    _Stub.responses = []
    _Stub.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Stub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    yield f"http://{host}:{port}/v1", _Stub
    server.shutdown()
    server.server_close()


@pytest.fixture
def adapter(stub_server):
    base_url, stub = stub_server
    return LocalLLMAdapter(base_url, "test-model", timeout_seconds=5), stub


def test_valid_response_becomes_typed_candidates(adapter):
    llm, stub = adapter
    stub.responses.append(
        completion(
            result_json(
                [
                    {
                        "type": "place",
                        "title": "Cerro de la Cruz at sunset",
                        "body": "Go to Cerro de la Cruz just before sunset.",
                        "confidence": 0.8,
                        "evidence": [{"quote": "Go to Cerro de la Cruz just before sunset"}],
                        "place": {"name": "Cerro de la Cruz"},
                    },
                    {
                        "type": "safety",
                        "title": "Taxi scam at the bus terminal",
                        "body": "They quote four times the normal price.",
                        "confidence": 0.7,
                        "evidence": [{"quote": "Careful with the taxi scam at the bus terminal"}],
                    },
                ]
            )
        )
    )

    result = llm.extract(MediaPayload(kind="link", text=TRANSCRIPT))

    assert [c.type for c in result.candidates] == ["place", "safety"]
    assert result.candidates[0].place is not None
    assert result.failure_reason is None


def test_the_request_carries_the_schema_and_the_travellers_own_context(adapter):
    llm, stub = adapter
    stub.responses.append(completion(result_json([])))

    llm.extract(
        MediaPayload(kind="link", text=TRANSCRIPT),
        ExtractionHints(
            destinations=["Antigua", "Lake Atitlán"],
            examples=[
                {"quote": "cheap breakfast", "item": {"type": "general", "title": "Cheap"}}
            ],
        ),
    )

    sent = stub.requests[0]
    # Constrained decoding, in both the OpenAI and the Ollama spelling.
    assert sent["response_format"]["json_schema"]["schema"]["title"] == "ExtractionResult"
    assert sent["format"]["title"] == "ExtractionResult"
    # Deterministic by default: the same source should extract the same way twice.
    assert sent["temperature"] == 0.0

    prompt = sent["messages"][-1]["content"]
    assert "Antigua" in prompt and "Lake Atitlán" in prompt
    assert "cheap breakfast" in prompt


def test_a_quote_the_source_never_contained_is_dropped(adapter):
    """The guard that makes a small model safe here: no quote, no claim."""
    llm, stub = adapter
    stub.responses.append(
        completion(
            result_json(
                [
                    {
                        "type": "safety",
                        "title": "Real warning",
                        "confidence": 0.7,
                        "evidence": [{"quote": "Careful with the taxi scam at the bus terminal"}],
                    },
                    {
                        "type": "price",
                        "title": "Invented price",
                        "confidence": 0.9,
                        "evidence": [{"quote": "The entrance fee is 200 quetzales per person"}],
                    },
                ]
            )
        )
    )

    result = llm.extract(MediaPayload(kind="link", text=TRANSCRIPT))

    assert [c.title for c in result.candidates] == ["Real warning"]


def test_malformed_output_is_repaired_once(adapter):
    llm, stub = adapter
    stub.responses.append(completion("Sure! Here you go: {not json at all"))
    stub.responses.append(
        completion(
            "```json\n"
            + result_json(
                [
                    {
                        "type": "safety",
                        "title": "Taxi scam",
                        "confidence": 0.6,
                        "evidence": [{"quote": "Careful with the taxi scam at the bus terminal"}],
                    }
                ]
            )
            + "\n```"
        )
    )

    result = llm.extract(MediaPayload(kind="link", text=TRANSCRIPT))

    assert len(stub.requests) == 2, "expected exactly one repair attempt"
    assert [c.title for c in result.candidates] == ["Taxi scam"]


def test_a_model_that_cannot_be_repaired_falls_back_to_the_rules(adapter):
    llm, stub = adapter
    stub.responses.append(completion("nonsense"))
    stub.responses.append(completion("still nonsense"))

    result = llm.extract(MediaPayload(kind="link", text=TRANSCRIPT))

    # The capture is not lost: the deterministic reader still finds the warning.
    assert any(c.type == "safety" for c in result.candidates)
    assert "rule-based" in (result.summary or "")


def test_an_unreachable_model_server_does_not_lose_the_capture():
    llm = LocalLLMAdapter("http://127.0.0.1:9/v1", "test-model", timeout_seconds=2)

    result = llm.extract(MediaPayload(kind="link", text=TRANSCRIPT))

    assert any(c.type == "safety" for c in result.candidates)
    assert "could not be reached" in (result.summary or "")


def test_media_with_no_text_still_fails_recoverably(adapter):
    llm, _ = adapter
    result = llm.extract(MediaPayload(kind="video", filename="clip.mp4"))
    assert result.candidates == []
    assert result.failure_reason
