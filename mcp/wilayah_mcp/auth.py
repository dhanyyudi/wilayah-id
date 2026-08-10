from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Awaitable, Callable, Iterable
from typing import Any


class ApiKeyConfigurationError(ValueError):
    pass


class ApiKeyVerifier:
    def __init__(self, digests: tuple[bytes, ...]) -> None:
        if not digests:
            raise ApiKeyConfigurationError("At least one API-key hash is required.")
        self._digests = digests

    @classmethod
    def from_encoded_hashes(cls, raw: str) -> "ApiKeyVerifier":
        values = [value.strip() for value in raw.split(",") if value.strip()]
        try:
            digests = tuple(bytes.fromhex(value) for value in values)
        except ValueError as exc:
            raise ApiKeyConfigurationError(
                "API-key hashes must be hexadecimal SHA-256 digests."
            ) from exc
        if any(len(value) != 32 for value in digests):
            raise ApiKeyConfigurationError(
                "API-key hashes must be hexadecimal SHA-256 digests."
            )
        return cls(digests)

    def accepts(self, candidate: str) -> bool:
        digest = hashlib.sha256(candidate.encode("utf-8")).digest()
        matches = False
        for expected in self._digests:
            matches = hmac.compare_digest(digest, expected) or matches
        return matches


def extract_single_api_key(headers: Iterable[tuple[bytes, bytes]]) -> str | None:
    values = [value for name, value in headers if name.lower() == b"x-api-key"]
    if len(values) != 1:
        return None
    try:
        candidate = values[0].decode("ascii")
    except UnicodeDecodeError:
        return None
    if not 1 <= len(candidate) <= 256:
        return None
    return candidate


class ApiKeyAuthMiddleware:
    def __init__(
        self,
        app: Callable[
            [dict[str, Any], Callable[..., Awaitable[Any]], Callable[..., Awaitable[Any]]],
            Awaitable[Any],
        ],
        verifier: ApiKeyVerifier,
        public_paths: frozenset[str] = frozenset({"/health"}),
    ) -> None:
        self.app = app
        self.verifier = verifier
        self.public_paths = public_paths

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope["path"] in self.public_paths:
            await self.app(scope, receive, send)
            return

        candidate = extract_single_api_key(scope.get("headers", []))
        if candidate is None or not self.verifier.accepts(candidate):
            body = json.dumps(
                {
                    "error": {
                        "code": "authentication_required",
                        "message": "A valid API key is required.",
                    }
                },
                separators=(",", ":"),
            ).encode("utf-8")
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"cache-control", b"private, no-store"),
                        (b"x-content-type-options", b"nosniff"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body, "more_body": False})
            return

        async def send_with_private_cache_control(message) -> None:
            if message.get("type") != "http.response.start":
                await send(message)
                return
            headers = [
                (name, value)
                for name, value in message.get("headers", [])
                if name.lower() != b"cache-control"
            ]
            headers.append((b"cache-control", b"private, no-store"))
            await send({**message, "headers": headers})

        await self.app(scope, receive, send_with_private_cache_control)
