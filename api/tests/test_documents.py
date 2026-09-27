"""Reading a plan out of a document.

A trip plan is very often a Word file or a PDF someone was sent. Both are text
the app can already understand; they just arrive wrapped. Word needs no
dependency at all - a .docx is a zip with XML inside - and PDF sits behind an
optional extra so the app still starts without it and says so plainly.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from app.services.documents import (
    DOCX_MEDIA_TYPE,
    PDF_MEDIA_TYPE,
    is_document,
    read_document,
)

PARAGRAPHS = [
    "Central America plan",
    "Antigua 4 days, Acatenango overnight",
    "סן פדרו / אגם אטיטלן 5 ימים",
]


def _docx(paragraphs: list[str]) -> bytes:
    """A .docx holding these paragraphs, built the way Word builds one."""
    body = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in paragraphs)
    document = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()


def test_a_word_file_gives_up_its_paragraphs():
    read = read_document(_docx(PARAGRAPHS), DOCX_MEDIA_TYPE)

    assert read.engine == "docx"
    assert read.failure_reason is None
    for paragraph in PARAGRAPHS:
        assert paragraph in read.text
    # One line per paragraph, so a plan's shape survives the read.
    assert read.text.count("\n") >= len(PARAGRAPHS) - 1


def test_hebrew_survives_the_read_unchanged():
    """The plan this is built for is written in Hebrew."""
    read = read_document(_docx(PARAGRAPHS), DOCX_MEDIA_TYPE)

    hebrew = PARAGRAPHS[-1]
    assert hebrew in read.text


def test_word_markup_never_reaches_the_text():
    read = read_document(_docx(["Antigua <w:tab/> 4 days"]), DOCX_MEDIA_TYPE)

    assert "<w:" not in read.text
    assert "Antigua" in read.text


def test_a_file_that_is_not_a_zip_fails_recoverably():
    read = read_document(b"this is not a docx at all", DOCX_MEDIA_TYPE)

    assert read.text == ""
    assert read.failure_reason
    assert "word" in read.failure_reason.lower() or "read" in read.failure_reason.lower()


def test_a_zip_without_a_document_part_fails_recoverably():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("notes.txt", "nothing useful")

    read = read_document(buffer.getvalue(), DOCX_MEDIA_TYPE)

    assert read.text == ""
    assert read.failure_reason


def test_an_empty_document_is_not_an_error_but_says_so():
    read = read_document(_docx([]), DOCX_MEDIA_TYPE)

    assert read.text == ""
    assert read.failure_reason, "an empty plan should say it was empty, not look like success"


def test_the_media_types_the_app_will_read():
    assert is_document(DOCX_MEDIA_TYPE)
    assert is_document(PDF_MEDIA_TYPE)
    assert not is_document("video/mp4")
    assert not is_document("image/png")
    assert not is_document(None)


def test_a_pdf_without_the_extra_installed_says_what_to_install():
    pytest.importorskip  # noqa: B018 - documents intent; the check is below
    try:
        import pypdf  # noqa: F401
    except ImportError:
        read = read_document(b"%PDF-1.4 whatever", PDF_MEDIA_TYPE)
        assert read.text == ""
        assert read.failure_reason
        # A recoverable failure names its remedy rather than blaming the file.
        assert "docs" in read.failure_reason
    else:
        read = read_document(b"not really a pdf", PDF_MEDIA_TYPE)
        assert read.failure_reason


# ------------------------------------------------- end to end, through capture


def _docx_upload(paragraphs: list[str]) -> tuple[str, bytes, str]:
    return ("plan.docx", _docx(paragraphs), DOCX_MEDIA_TYPE)


def test_uploading_a_word_plan_produces_reviewable_candidates(client, auth, trip):
    """The whole point: a plan in a Word file becomes things to review."""
    response = client.post(
        "/api/v1/sources/upload",
        headers=auth,
        files={"files": _docx_upload([
            "Antigua 4 days, Acatenango overnight hike",
            "Cerro de la Cruz at sunset for the view",
        ])},
    )
    assert response.status_code == 201, response.text
    source = response.json()[0]
    assert source["failure_reason"] is None

    inbox = client.get("/api/v1/inbox", headers=auth).json()
    titles = " ".join(c["title"] for c in inbox)
    assert "Acatenango" in titles or "Cerro de la Cruz" in titles


def test_an_unreadable_document_is_kept_and_says_why(client, auth, trip):
    response = client.post(
        "/api/v1/sources/upload",
        headers=auth,
        files={"files": ("broken.docx", b"not a zip", DOCX_MEDIA_TYPE)},
    )
    assert response.status_code == 201, response.text
    source = response.json()[0]
    # Kept, not rejected - and honest about what happened.
    assert source["failure_reason"]
    assert "Word" in source["failure_reason"]
