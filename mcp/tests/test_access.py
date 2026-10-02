"""Issued-key verification, rate limiting, and their middleware integration."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import unittest

from wilayah_mcp.access import (
    AccessConfigurationError,
    FixedWindowLimiter,
    McpLimits,
    SignedKeyVerifier,
)
from wilayah_mcp.auth import ApiKeyAuthMiddleware, ApiKeyVerifier
from wilayah_mcp.http_runtime import build_authenticated_http_app

# Shared with src/lib/access/keys.test.ts: both sides must accept this key.
VECTOR_SECRET = "test-signing-secret-0123456789abcdef"
VECTOR_KEY = (
    "wid1.eyJpZCI6IjAxMjM0NTY3ODlhYmNkZWYiLCJ0IjoiZnJlZSIsImlhdCI6MTc5MDAwMDAw"
    "MCwiZXhwIjoxNzkwMDg2NDAwfQ.IrwTvyvqycrumBFstOoFPVR2e7qSUhz3CEuN8Mz9rlA"
)
VECTOR_NOW = 1_790_000_001.0


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _sign(claims: object, secret: str = VECTOR_SECRET) -> str:
    signed = "wid1." + _encode(json.dumps(claims, separators=(",", ":")).encode())
    signature = hmac.new(secret.encode(), signed.encode(), hashlib.sha256).digest()
    return f"{signed}.{_encode(signature)}"


def _claims(**overrides: object) -> dict[str, object]:
    return {
        "id": "0123456789abcdef",
        "t": "free",
        "iat": 1_790_000_000,
        "exp": 1_790_086_400,
        **overrides,
    }


class SignedKeyVerifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.verifier = SignedKeyVerifier(VECTOR_SECRET)

    def test_accepts_the_cross_language_reference_key(self):
        self.assertEqual(
            self.verifier.verify(VECTOR_KEY, VECTOR_NOW), "0123456789abcdef"
        )
        self.assertEqual(_sign(_claims()), VECTOR_KEY)

    def test_rejects_a_key_signed_with_another_secret(self):
        other = SignedKeyVerifier("another-signing-secret-0123456789abcdef")

        self.assertIsNone(other.verify(VECTOR_KEY, VECTOR_NOW))

    def test_rejects_a_tampered_payload(self):
        version, _payload, signature = VECTOR_KEY.split(".")
        forged = _encode(json.dumps(_claims(exp=1_990_086_400)).encode())

        self.assertIsNone(
            self.verifier.verify(f"{version}.{forged}.{signature}", VECTOR_NOW)
        )

    def test_rejects_an_expired_key_at_the_exact_expiry_second(self):
        self.assertIsNone(self.verifier.verify(VECTOR_KEY, 1_790_086_400.0))
        self.assertIsNotNone(self.verifier.verify(VECTOR_KEY, 1_790_086_399.9))

    def test_rejects_a_revoked_key_id(self):
        verifier = SignedKeyVerifier(VECTOR_SECRET, frozenset({"0123456789abcdef"}))

        self.assertIsNone(verifier.verify(VECTOR_KEY, VECTOR_NOW))

    def test_rejects_validly_signed_claims_with_the_wrong_shape(self):
        for claims in (
            _claims(t="owner"),
            _claims(id="short"),
            _claims(id="0123456789ABCDEF"),
            _claims(exp="1790086400"),
            _claims(exp=True),
            _claims(iat=1.5),
            ["not", "an", "object"],
        ):
            with self.subTest(claims=claims):
                self.assertIsNone(self.verifier.verify(_sign(claims), VECTOR_NOW))

    def test_rejects_malformed_keys(self):
        for candidate in ("", "wid1", "wid1.a.b.c", "wid2.aaaa.bbbb", "wid1.@@@.bbbb"):
            with self.subTest(candidate=candidate):
                self.assertIsNone(self.verifier.verify(candidate, VECTOR_NOW))

    def test_requires_a_long_secret(self):
        with self.assertRaises(AccessConfigurationError):
            SignedKeyVerifier("short")


class FixedWindowLimiterTests(unittest.TestCase):
    def test_allows_up_to_the_limit_then_rejects_until_the_next_window(self):
        limiter = FixedWindowLimiter()

        first = limiter.take("a", 2, 60, 1.0)
        second = limiter.take("a", 2, 60, 2.0)
        third = limiter.take("a", 2, 60, 59.9)

        self.assertEqual((first.allowed, first.remaining, first.reset_at), (True, 1, 60.0))
        self.assertEqual((second.allowed, second.remaining), (True, 0))
        self.assertEqual((third.allowed, third.remaining), (False, 0))
        self.assertTrue(limiter.take("a", 2, 60, 60.0).allowed)

    def test_buckets_are_independent(self):
        limiter = FixedWindowLimiter()
        limiter.take("a", 1, 60, 0.0)

        self.assertFalse(limiter.take("a", 1, 60, 1.0).allowed)
        self.assertTrue(limiter.take("b", 1, 60, 1.0).allowed)

    def test_stays_within_capacity(self):
        limiter = FixedWindowLimiter(max_entries=10)
        for index in range(50):
            limiter.take(f"bucket-{index}", 1, 60, float(index))

        self.assertLessEqual(len(limiter), 10)


class McpLimitsTests(unittest.TestCase):
    def test_defaults_and_overrides(self):
        self.assertEqual(McpLimits.from_env({}), McpLimits(120, 10, 3_000))
        self.assertEqual(
            McpLimits.from_env(
                {"MCP_LIMIT_KEY_PER_MINUTE": "7", "MCP_LIMIT_OWNER_PER_MINUTE": ""}
            ),
            McpLimits(7, 10, 3_000),
        )

    def test_rejects_invalid_values(self):
        for value in ("0", "-1", "1.5", "many"):
            with self.subTest(value=value):
                with self.assertRaises(AccessConfigurationError):
                    McpLimits.from_env({"MCP_LIMIT_KEY_PER_MINUTE": value})


class TieredMiddlewareTests(unittest.TestCase):
    def setUp(self) -> None:
        self.owner_key = "fixture-owner-key"
        self.now = VECTOR_NOW
        self.downstream_calls: list[str] = []

        async def downstream(scope, receive, send):
            self.downstream_calls.append(scope["path"])
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}", "more_body": False})

        self.middleware = ApiKeyAuthMiddleware(
            downstream,
            ApiKeyVerifier.from_encoded_hashes(
                hashlib.sha256(self.owner_key.encode()).hexdigest()
            ),
            signed_verifier=SignedKeyVerifier(VECTOR_SECRET),
            limiter=FixedWindowLimiter(),
            limits=McpLimits(
                key_per_minute=2, key_artifacts_per_minute=1, owner_per_minute=3
            ),
            clock=lambda: self.now,
        )

    def request(self, path: str, key: str | None, middleware=None):
        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        headers = [] if key is None else [(b"x-api-key", key.encode())]
        asyncio.run(
            (middleware or self.middleware)(
                {"type": "http", "method": "POST", "path": path, "headers": headers},
                receive,
                send,
            )
        )
        return messages

    def statuses(self, path: str, key: str, count: int) -> list[int]:
        return [self.request(path, key)[0]["status"] for _ in range(count)]

    def test_an_issued_key_is_accepted_and_limited_per_minute(self):
        self.assertEqual(self.statuses("/mcp", VECTOR_KEY, 3), [200, 200, 429])
        self.now += 60

        self.assertEqual(self.statuses("/mcp", VECTOR_KEY, 1), [200])

    def test_the_429_response_is_private_and_tells_the_caller_when_to_retry(self):
        self.statuses("/mcp", VECTOR_KEY, 2)
        start, body = self.request("/mcp", VECTOR_KEY)
        headers = dict(start["headers"])

        self.assertEqual(start["status"], 429)
        self.assertEqual(headers[b"cache-control"], b"private, no-store")
        # 1_790_000_001 is 21 seconds into its minute window.
        self.assertEqual(headers[b"retry-after"], b"39")
        self.assertEqual(headers[b"ratelimit-limit"], b"2")
        self.assertEqual(
            json.loads(body["body"])["error"]["code"], "rate_limited"
        )
        self.assertEqual(self.downstream_calls, ["/mcp", "/mcp"])

    def test_artifact_downloads_have_their_own_smaller_budget(self):
        self.assertEqual(
            self.statuses("/artifacts/abc/subset.geojson", VECTOR_KEY, 2), [200, 429]
        )
        self.assertEqual(self.statuses("/mcp", VECTOR_KEY, 1), [200])

    def test_each_issued_key_has_its_own_budget(self):
        other = _sign(_claims(id="fedcba9876543210"))
        self.statuses("/mcp", VECTOR_KEY, 2)

        self.assertEqual(self.statuses("/mcp", VECTOR_KEY, 1), [429])
        self.assertEqual(self.statuses("/mcp", other, 1), [200])

    def test_the_owner_key_only_meets_the_safety_cap(self):
        self.assertEqual(
            self.statuses("/artifacts/abc/subset.geojson", self.owner_key, 4),
            [200, 200, 200, 429],
        )

    def test_expired_revoked_and_forged_keys_return_401(self):
        self.now = 1_790_086_400.0
        self.assertEqual(self.statuses("/mcp", VECTOR_KEY, 1), [401])
        self.now = VECTOR_NOW
        self.assertEqual(
            self.statuses("/mcp", _sign(_claims(), secret="x" * 40), 1), [401]
        )
        self.assertEqual(self.request("/mcp", None)[0]["status"], 401)
        self.assertEqual(self.downstream_calls, [])

    def test_issued_keys_are_refused_without_a_signing_secret(self):
        hash_only = ApiKeyAuthMiddleware(
            self.middleware.app, self.middleware.verifier
        )

        self.assertEqual(self.request("/mcp", VECTOR_KEY, hash_only)[0]["status"], 401)
        self.assertEqual(
            self.request("/mcp", self.owner_key, hash_only)[0]["status"], 200
        )


class RuntimeWiringTests(unittest.TestCase):
    def _app(self, **kwargs):
        from unittest.mock import Mock

        async def downstream(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            await send({"type": "http.response.body", "body": b"{}", "more_body": False})

        mcp = Mock()
        mcp.streamable_http_app.return_value = downstream
        return build_authenticated_http_app(
            mcp,
            "streamable-http",
            hashlib.sha256(b"fixture-owner-key").hexdigest(),
            **kwargs,
        )

    def test_hash_only_configuration_still_builds_with_a_limiter(self):
        app = self._app()

        self.assertIsNone(app.signed_verifier)
        self.assertIsNotNone(app.limiter)
        self.assertEqual(app.limits, McpLimits())

    def test_signing_secret_and_revocations_are_wired(self):
        app = self._app(
            signing_secret=VECTOR_SECRET,
            revoked_key_ids=" 0123456789abcdef , ",
            limits=McpLimits(key_per_minute=9),
        )

        self.assertIsNone(app.signed_verifier.verify(VECTOR_KEY, VECTOR_NOW))
        self.assertEqual(app.limits.key_per_minute, 9)

    def test_a_short_signing_secret_fails_closed(self):
        with self.assertRaises(AccessConfigurationError):
            self._app(signing_secret="short")


if __name__ == "__main__":
    unittest.main()
