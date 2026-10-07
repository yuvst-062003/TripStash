"""The schema handed to the model, which is stricter than the app's own.

A local model follows a JSON schema far more reliably than it follows an
instruction in prose. The app's own `evidence` field is optional - candidates
arrive from other places without it - but a candidate the MODEL invents must
carry a verbatim quote or the grounding guard drops it on arrival.

gemma3:12b demonstrated exactly that: asked in prose for quotes it returned
four well-typed candidates with no evidence at all, and every one was
discarded. Saying it in the schema instead is what makes it happen.
"""

from app.adapters.local_llm import extraction_schema


def _candidate_schema(schema: dict) -> dict:
    return schema["$defs"]["KnowledgeCandidate"]


def test_the_model_is_required_to_supply_evidence():
    candidate = _candidate_schema(extraction_schema())
    assert "evidence" in candidate.get("required", [])


def test_one_quote_is_not_enough_to_be_optional():
    candidate = _candidate_schema(extraction_schema())
    assert candidate["properties"]["evidence"].get("minItems") == 1


def test_the_apps_own_model_stays_permissive():
    """Only the prompt tightens. Candidates arrive from elsewhere without
    evidence - a traveller typing a note by hand, for one - and those must
    still validate.
    """
    from app.schemas.extraction import KnowledgeCandidate

    assert KnowledgeCandidate(type="general", title="Typed by hand").evidence == []


def test_the_strict_schema_is_still_the_same_shape_otherwise():
    schema = extraction_schema()
    assert "candidates" in schema["properties"]
    assert _candidate_schema(schema)["properties"]["title"]
