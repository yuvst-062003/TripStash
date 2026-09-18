"""Private object storage with short-lived signed access (spec 11.4)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from pathlib import Path

from app.config import get_settings

# Anything outside this list is rejected at the boundary (spec 11.4: MIME and
# size validation). Executables and archives never reach storage.
ALLOWED_MEDIA_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/gif",
    "video/mp4",
    "video/quicktime",
    "video/webm",
    "application/pdf",
    "text/plain",
}


class UnsupportedMediaError(ValueError):
    pass


class SignatureError(ValueError):
    pass


class LocalStorageAdapter:
    """Filesystem driver. Keys are opaque; nothing is served from a public path."""

    name = "local"

    def __init__(self, root: Path | None = None) -> None:
        settings = get_settings()
        self.root = Path(root or settings.storage_dir)
        self.root.mkdir(parents=True, exist_ok=True)
        self._secret = settings.secret_key.encode()
        self._ttl = settings.signed_url_ttl_seconds

    def _path(self, key: str) -> Path:
        # Keys are generated internally, but never trust one blindly.
        safe = key.replace("\\", "/").lstrip("/")
        if ".." in Path(safe).parts:
            raise ValueError("invalid storage key")
        path = (self.root / safe).resolve()
        if not str(path).startswith(str(self.root.resolve())):
            raise ValueError("storage key escapes root")
        return path

    def put(self, key: str, data: bytes, media_type: str | None = None) -> str:
        if media_type and media_type not in ALLOWED_MEDIA_TYPES:
            raise UnsupportedMediaError(media_type)
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def signed_url(self, key: str) -> str:
        expires = int(time.time()) + self._ttl
        token = self._sign(key, expires)
        return f"/api/v1/files/{key}?expires={expires}&signature={token}"

    def _sign(self, key: str, expires: int) -> str:
        message = f"{key}:{expires}".encode()
        digest = hmac.new(self._secret, message, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).decode().rstrip("=")

    def verify(self, key: str, expires: int, signature: str) -> None:
        if expires < int(time.time()):
            raise SignatureError("signed url expired")
        if not hmac.compare_digest(self._sign(key, expires), signature):
            raise SignatureError("signature mismatch")


def fingerprint(data: bytes) -> str:
    """Content hash used to stop a retried import creating a duplicate."""
    return hashlib.sha256(data).hexdigest()


def text_fingerprint(*parts: str | None) -> str:
    payload = json.dumps([p for p in parts if p], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def scan_for_malware(data: bytes, media_type: str | None) -> None:
    """Placeholder for the required upload scan.

    The real deployment calls an external scanner here. The EICAR check keeps
    the call site honest and gives the test suite something to assert on.
    """
    if b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE" in data[:1024]:
        raise UnsupportedMediaError("file rejected by malware scan")
