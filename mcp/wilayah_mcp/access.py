"""Issued-key verification and rate limiting for the public MCP transport.

Issued keys are stateless: ``wid1.<payload>.<signature>`` where the signature
is HMAC-SHA256 over ``wid1.<payload>``. The web application creates them in
``src/lib/access/keys.ts``; both sides must stay in sync.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass

KEY_VERSION = "wid1"
MIN_SECRET_LENGTH = 32
_KEY_ID = re.compile(r"[0-9a-f]{16}")
_BASE64URL = re.compile(r"[A-Za-z0-9_-]+")


class AccessConfigurationError(ValueError):
    pass


def _decode_base64url(value: str) -> bytes | None:
    if not _BASE64URL.fullmatch(value):
        return None
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (binascii.Error, ValueError):
        return None


class SignedKeyVerifier:
    """Verify issued free-tier keys without a key store."""

    def __init__(
        self,
        secret: str,
        revoked_ids: frozenset[str] = frozenset(),
    ) -> None:
        if len(secret) < MIN_SECRET_LENGTH:
            raise AccessConfigurationError(
                f"The key signing secret must be at least {MIN_SECRET_LENGTH} characters."
            )
        self._secret = secret.encode("utf-8")
        self._revoked_ids = revoked_ids

    def verify(self, candidate: str, now: float) -> str | None:
        """Return the key id for a valid, unexpired, unrevoked key."""

        parts = candidate.split(".")
        if len(parts) != 3 or parts[0] != KEY_VERSION:
            return None
        _, payload, signature = parts
        signature_bytes = _decode_base64url(signature)
        payload_bytes = _decode_base64url(payload)
        if signature_bytes is None or payload_bytes is None:
            return None

        expected = hmac.new(
            self._secret,
            f"{KEY_VERSION}.{payload}".encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(signature_bytes, expected):
            return None

        try:
            claims = json.loads(payload_bytes)
        except (UnicodeDecodeError, ValueError):
            return None
        if not isinstance(claims, dict):
            return None
        key_id = claims.get("id")
        expires_at = claims.get("exp")
        if (
            not isinstance(key_id, str)
            or not _KEY_ID.fullmatch(key_id)
            or claims.get("t") != "free"
            or type(claims.get("iat")) is not int
            or type(expires_at) is not int
        ):
            return None
        if expires_at <= int(now) or key_id in self._revoked_ids:
            return None
        return key_id


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_at: float


class FixedWindowLimiter:
    """In-memory fixed-window counter for one server process."""

    def __init__(self, max_entries: int = 50_000) -> None:
        self._windows: dict[str, tuple[int, int, int]] = {}
        self._max_entries = max_entries

    def take(
        self,
        bucket: str,
        limit: int,
        window_seconds: int,
        now: float,
    ) -> RateLimitResult:
        window_start = int(now // window_seconds) * window_seconds
        reset_at = float(window_start + window_seconds)
        key = f"{window_seconds}|{bucket}"
        entry = self._windows.get(key)

        if entry is None or entry[0] != window_start:
            if entry is None and len(self._windows) >= self._max_entries:
                self._prune(now)
            entry = (window_start, window_seconds, 0)

        count = entry[2]
        if count >= limit:
            self._windows[key] = entry
            return RateLimitResult(False, limit, 0, reset_at)
        self._windows[key] = (window_start, window_seconds, count + 1)
        return RateLimitResult(True, limit, limit - count - 1, reset_at)

    def _prune(self, now: float) -> None:
        for key in [
            key
            for key, (start, seconds, _count) in self._windows.items()
            if start + seconds <= now
        ]:
            del self._windows[key]
        while len(self._windows) >= self._max_entries:
            del self._windows[next(iter(self._windows))]

    def __len__(self) -> int:
        return len(self._windows)


@dataclass(frozen=True)
class McpLimits:
    key_per_minute: int = 120
    key_artifacts_per_minute: int = 10
    owner_per_minute: int = 3_000

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "McpLimits":
        source = os.environ if env is None else env

        def positive(name: str, fallback: int) -> int:
            raw = source.get(name)
            if raw is None or raw == "":
                return fallback
            if not re.fullmatch(r"[1-9]\d{0,8}", raw):
                raise AccessConfigurationError(f"{name} must be a positive integer.")
            return int(raw)

        return cls(
            key_per_minute=positive("MCP_LIMIT_KEY_PER_MINUTE", cls.key_per_minute),
            key_artifacts_per_minute=positive(
                "MCP_LIMIT_KEY_ARTIFACTS_PER_MINUTE",
                cls.key_artifacts_per_minute,
            ),
            owner_per_minute=positive(
                "MCP_LIMIT_OWNER_PER_MINUTE", cls.owner_per_minute
            ),
        )
