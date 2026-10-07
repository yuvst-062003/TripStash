"""Reading a plan out of a document.

A trip plan is very often a Word file, a PDF someone was sent, or a page saved
out of a browser. All three are text the app can already understand; they just
arrive wrapped. Word and HTML need no dependency at all - a .docx is a zip with
XML inside, and a page is text with markup around it - and PDF sits behind an
optional extra so the app still starts without it and says so plainly.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from app.services.documents import (
    DOCX_MEDIA_TYPE,
    HTML_MEDIA_TYPE,
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
        files={
            "files": _docx_upload(
                [
                    "Antigua 4 days, Acatenango overnight hike",
                    "Cerro de la Cruz at sunset for the view",
                ]
            )
        },
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


# ------------------------------------------------------------------- web pages


PLAN_PAGE = """<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>The big trip</title>
  <style>:root{--bg:#f5f2e9}body{margin:0;font:16px/1.8 system-ui}</style>
</head>
<body>
  <h1>Mexico &amp; Guatemala</h1>
  <p>Puerto Escondido for 7&ndash;8 nights, then San Crist&oacute;bal.</p>
  <ul><li>Acatenango overnight</li><li>Lake Atitl&aacute;n</li></ul>
  <script>document.title = 'not the plan'</script>
</body></html>
"""


def _page_upload(markup: str = PLAN_PAGE) -> tuple[str, bytes, str]:
    return ("plan.html", markup.encode("utf-8"), HTML_MEDIA_TYPE)


def test_a_page_gives_up_its_words_and_not_its_machinery():
    read = read_document(PLAN_PAGE.encode("utf-8"), HTML_MEDIA_TYPE)

    assert read.engine == "html"
    assert "Puerto Escondido" in read.text
    assert "Acatenango overnight" in read.text
    # The stylesheet and the script are the page's machinery. Kept, they would
    # be most of the "plan".
    assert "--bg" not in read.text
    assert "font" not in read.text
    assert "not the plan" not in read.text


def test_a_page_keeps_its_lines_apart():
    read = read_document(PLAN_PAGE.encode("utf-8"), HTML_MEDIA_TYPE)

    # Two list items must not become one line: a plan read as one paragraph is
    # a plan nothing downstream can divide up again.
    assert "Acatenango overnight\nLake Atitlán" in read.text


def test_a_page_decodes_its_entities():
    read = read_document(PLAN_PAGE.encode("utf-8"), HTML_MEDIA_TYPE)

    assert "Mexico & Guatemala" in read.text
    assert "San Cristóbal" in read.text
    assert "&amp;" not in read.text


def test_escaped_markup_in_a_page_stays_escaped():
    """Tags come off before entities are decoded, never the other way round."""
    read = read_document(
        b"<p>Write &lt;script&gt;alert(1)&lt;/script&gt; in the plan</p>", HTML_MEDIA_TYPE
    )

    # The words survive as words; nothing became a tag on the way out.
    assert "alert(1)" in read.text
    assert "<script>" in read.text  # as text, which is all it can be now


def test_a_page_with_no_words_is_kept_and_says_why():
    read = read_document(
        b"<html><head><style>body{color:red}</style></head></html>", HTML_MEDIA_TYPE
    )

    assert read.text == ""
    assert read.failure_reason
    assert "PDF" in read.failure_reason


def test_uploading_a_plan_page_produces_reviewable_candidates(client, auth, trip):
    response = client.post("/api/v1/sources/upload", headers=auth, files={"files": _page_upload()})

    assert response.status_code == 201, response.text
    source = response.json()[0]
    assert source["failure_reason"] is None
    assert source["kind"] == "article"

    inbox = client.get("/api/v1/inbox", headers=auth).json()
    titles = " ".join(c["title"] for c in inbox)
    assert "Acatenango" in titles or "Atitlán" in titles


def test_a_stored_page_is_never_served_back_as_a_page(client, auth, trip):
    """Uploaded markup is text to read. Served as markup from the API's own
    origin, it would run its script against the host holding every trip."""
    response = client.post(
        "/api/v1/sources/upload",
        headers=auth,
        files={"files": ("plan.html", b"<p>hi<script>alert(1)</script></p>", HTML_MEDIA_TYPE)},
    )
    assert response.status_code == 201, response.text
    file_url = response.json()[0]["file_url"]
    assert file_url, "a stored page should be retrievable"

    served = client.get(file_url.replace("http://testserver", ""))
    assert served.status_code == 200, served.text
    assert served.headers["content-type"].startswith("text/plain")
    assert served.headers["x-content-type-options"] == "nosniff"
