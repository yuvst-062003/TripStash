"""Reading a plan out of a Word file, a PDF, or a web page.

A trip plan very often arrives as a document rather than a message: a .docx
someone typed, a PDF a friend sent. Both are text the extraction pipeline
already understands - they just arrive wrapped, and until now a PDF could be
uploaded, stored, and then silently produce nothing.

Word needs no dependency: a .docx is a zip with XML inside, and the standard
library opens both. PDF sits behind the optional `docs` extra, the same way
speech sits behind `asr`, so the app still starts without it and says what to
install rather than blaming the file.

HTML is here because it is what this app hands back: a plan exported from a
conversation, or saved from a browser, arrives as one self-contained page. It
needs no dependency either, but it does need the page's machinery thrown away
first - a stylesheet and a script are not the plan, and a reader that keeps
them returns several hundred lines of CSS where the first sentence should be.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from html import unescape
from io import BytesIO

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_MEDIA_TYPE = "application/pdf"
HTML_MEDIA_TYPE = "text/html"

DOCUMENT_MEDIA_TYPES = frozenset({DOCX_MEDIA_TYPE, PDF_MEDIA_TYPE, HTML_MEDIA_TYPE})

# The part of a .docx that holds the body. Everything else is styling.
_DOCX_BODY = "word/document.xml"
_TAG = re.compile(r"<[^>]+>")
_BLANK_LINES = re.compile(r"\n{3,}")

# A page's machinery, removed with its contents rather than just its tags.
_SCRIPT_OR_STYLE = re.compile(r"<(script|style)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
# Where a line ends in a page. Without this the whole plan runs together, and a
# plan read as one paragraph is a plan nothing downstream can divide up again.
_LINE_BREAK = re.compile(
    r"</(?:p|div|li|ul|ol|h[1-6]|section|article|header|footer|tr|td|th|blockquote|label|nav"
    r"|span|title|option|figcaption|dt|dd|pre|main|aside|button)\s*>|<br\s*/?>",
    re.IGNORECASE,
)


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
    if media_type == HTML_MEDIA_TYPE:
        return _read_html(data)
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


#: How many pages of a PDF plan are read. Enough for any itinerary a
#: traveller would write; small enough that a bomb of a file stays cheap.
MAX_PDF_PAGES = 80


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
        # A plan is a few pages; a thousand-page PDF is a mistake or a
        # weapon, and either way the first pages are what the extraction
        # reads. Capped so one upload cannot occupy the worker for minutes.
        pages = [
            page.extract_text() or ""
            for _, page in zip(range(MAX_PDF_PAGES), reader.pages, strict=False)
        ]
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


def _read_html(data: bytes) -> DocumentText:
    """The words out of a web page.

    No parser, for the same reason .docx needs no library: a page is text with
    markup around it, and the markup here only has to be removed rather than
    understood. What does need care is the order of operations - tags come off
    before entities are decoded, so an `&lt;script&gt;` written as text in the
    plan cannot turn itself back into a tag on the way out.
    """
    # A page declares its own encoding, but the declaration is inside the bytes
    # being decoded. UTF-8 is what browsers and this app both write, and
    # `ignore` means a stray byte costs one character rather than the file.
    markup = data.decode("utf-8", "ignore")
    markup = _SCRIPT_OR_STYLE.sub("\n", markup)
    markup = _LINE_BREAK.sub("\n", markup)
    text = _tidy(unescape(_TAG.sub("", markup)))
    if not text:
        return DocumentText(
            text="",
            engine="html",
            failure_reason=(
                "That page has no readable text in it. If it is a page that builds itself "
                "with script, save it as a PDF and try that instead."
            ),
        )
    return DocumentText(text=text, engine="html")
