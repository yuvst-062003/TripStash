"""Reading a plan out of a Word file or a PDF.

A trip plan very often arrives as a document rather than a message: a .docx
someone typed, a PDF a friend sent. Both are text the extraction pipeline
already understands - they just arrive wrapped, and until now a PDF could be
uploaded, stored, and then silently produce nothing.

Word needs no dependency: a .docx is a zip with XML inside, and the standard
library opens both. PDF sits behind the optional `docs` extra, the same way
speech sits behind `asr`, so the app still starts without it and says what to
install rather than blaming the file.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from io import BytesIO

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_MEDIA_TYPE = "application/pdf"

DOCUMENT_MEDIA_TYPES = frozenset({DOCX_MEDIA_TYPE, PDF_MEDIA_TYPE})

# The part of a .docx that holds the body. Everything else is styling.
_DOCX_BODY = "word/document.xml"
_TAG = re.compile(r"<[^>]+>")
_BLANK_LINES = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class DocumentText:
    """What a document gave up, and why it gave up nothing when it did."""

    text: str
    engine: str
    # Set when there is no usable text. A recoverable failure, never an
    # exception: the file is kept and the traveller is told what happened.
    failure_reason: str | None = None


def is_document(media_type: str | None) -> bool:
    return bool(media_type) and media_type in DOCUMENT_MEDIA_TYPES


def read_document(data: bytes, media_type: str | None) -> DocumentText:
    """Pull the readable text out of a document.

    Never raises. A file that cannot be read comes back with empty text and a
    reason a person can act on, because the source is kept either way.
    """
    if media_type == DOCX_MEDIA_TYPE:
        return _read_docx(data)
    if media_type == PDF_MEDIA_TYPE:
        return _read_pdf(data)
    return DocumentText(
        text="",
        engine="none",
        failure_reason="That is not a document this app reads.",
    )


def _tidy(text: str) -> str:
    lines = [line.strip() for line in text.splitlines()]
    joined = "\n".join(line for line in lines if line)
    return _BLANK_LINES.sub("\n\n", joined).strip()


def _read_docx(data: bytes) -> DocumentText:
    try:
        with zipfile.ZipFile(BytesIO(data)) as archive:
            xml = archive.read(_DOCX_BODY).decode("utf-8", "ignore")
    except (zipfile.BadZipFile, KeyError, OSError):
        return DocumentText(
            text="",
            engine="docx",
            failure_reason=(
                "That file could not be read as a Word document. If it is an older .doc, "
                "save it as .docx and try again."
            ),
        )

    # A paragraph is the unit a plan is written in, so each one becomes a line
    # before the markup is stripped. Without this the whole plan runs together.
    xml = xml.replace("</w:p>", "\n")
    text = _tidy(_TAG.sub("", xml))
    if not text:
        return DocumentText(
            text="",
            engine="docx",
            failure_reason="That Word document has no text in it.",
        )
    return DocumentText(text=text, engine="docx")


def _read_pdf(data: bytes) -> DocumentText:
    try:
        from pypdf import PdfReader
    except ImportError:
        return DocumentText(
            text="",
            engine="pdf",
            failure_reason=(
                "Reading PDFs needs the optional docs extra. Install it with "
                'pip install -e ".[docs]" and try this file again.'
            ),
        )

    try:
        reader = PdfReader(BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception:  # noqa: BLE001 - any malformed PDF is a recoverable failure
        return DocumentText(
            text="",
            engine="pdf",
            failure_reason="That PDF could not be opened. It may be damaged or password protected.",
        )

    text = _tidy("\n".join(pages))
    if not text:
        return DocumentText(
            text="",
            engine="pdf",
            failure_reason=(
                "That PDF holds no selectable text. It is probably a scan, so a screenshot "
                "of the page will read better."
            ),
        )
    return DocumentText(text=text, engine="pdf")
