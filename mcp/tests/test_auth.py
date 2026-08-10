import asyncio
import hashlib
import json
import logging
import unittest

from wilayah_mcp.auth import (
    ApiKeyConfigurationError,
    ApiKeyAuthMiddleware,
    ApiKeyVerifier,
    extract_single_api_key,
)


class ApiKeyVerifierTests(unittest.TestCase):
    def test_accepts_valid_key_and_rejects_unknown_key(self):
        key = "fixture-valid-key"
        verifier = ApiKeyVerifier.from_encoded_hashes(
            hashlib.sha256(key.encode()).hexdigest()
        )

        self.assertTrue(verifier.accepts(key))
        self.assertFalse(verifier.accepts("fixture-unknown-key"))

    def test_accepts_either_hash_during_rotation(self):
        first = "fixture-first-key"
        second = "fixture-second-key"
        encoded = ", ".join(
            hashlib.sha256(value.encode()).hexdigest() for value in (first, second)
        )
        verifier = ApiKeyVerifier.from_encoded_hashes(encoded)

        self.assertTrue(verifier.accepts(first))
        self.assertTrue(verifier.accepts(second))

    def test_rejects_empty_hash_configuration(self):
        with self.assertRaises(ApiKeyConfigurationError):
            ApiKeyVerifier.from_encoded_hashes("  , ")

    def test_rejects_non_hex_and_non_sha256_hashes(self):
        with self.assertRaises(ApiKeyConfigurationError):
            ApiKeyVerifier.from_encoded_hashes("not-a-digest")
        with self.assertRaises(ApiKeyConfigurationError):
            ApiKeyVerifier.from_encoded_hashes("a" * 64 + "00")
        with self.assertRaises(ApiKeyConfigurationError):
            ApiKeyVerifier.from_encoded_hashes("a" * 32 + " " + "a" * 32)

    def test_header_parser_rejects_missing_empty_duplicate_and_oversized_values(self):
        self.assertIsNone(extract_single_api_key([]))
        self.assertIsNone(extract_single_api_key([(b"x-api-key", b"")]))
        self.assertIsNone(
            extract_single_api_key(
                [(b"x-api-key", b"first"), (b"X-API-KEY", b"second")]
            )
        )
        self.assertIsNone(extract_single_api_key([(b"x-api-key", b"a" * 257)]))

    def test_header_parser_accepts_one_ascii_value(self):
        self.assertEqual(
            extract_single_api_key([(b"X-Api-Key", b"fixture-header-key")]),
            "fixture-header-key",
        )


class ApiKeyAuthMiddlewareTests(unittest.TestCase):
    def setUp(self):
        self.key = "fixture-middleware-key"
        self.verifier = ApiKeyVerifier.from_encoded_hashes(
            hashlib.sha256(self.key.encode()).hexdigest()
        )
        self.downstream_calls = []

        async def downstream(scope, receive, send):
            self.downstream_calls.append(scope["path"])
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"cache-control", b"public, max-age=60"),
                        (b"x-downstream", b"yes"),
                    ],
                }
            )
            await send(
                {"type": "http.response.body", "body": b'{"ok":true}', "more_body": False}
            )

        self.downstream = downstream

    def run_request(self, path, headers=None, method="GET"):
        messages = []
        request_messages = iter([{"type": "http.request", "body": b"", "more_body": False}])
        middleware = ApiKeyAuthMiddleware(self.downstream, self.verifier)

        async def receive():
            return next(request_messages)

        async def send(message):
            messages.append(message)

        asyncio.run(
            middleware(
                {
                    "type": "http",
                    "method": method,
                    "path": path,
                    "headers": headers or [],
                },
                receive,
                send,
            )
        )
        return messages

    def test_health_reaches_downstream_without_a_key(self):
        messages = self.run_request("/health")

        self.assertEqual(self.downstream_calls, ["/health"])
        self.assertEqual(messages[0]["status"], 200)

    def test_non_get_health_requests_require_the_exact_401_contract(self):
        expected_body = json.dumps(
            {
                "error": {
                    "code": "authentication_required",
                    "message": "A valid API key is required.",
                }
            },
            separators=(",", ":"),
        ).encode()
        expected_headers = [
            (b"content-type", b"application/json"),
            (b"cache-control", b"private, no-store"),
            (b"x-content-type-options", b"nosniff"),
        ]

        for method in ("POST", "HEAD", "OPTIONS"):
            with self.subTest(method=method):
                messages = self.run_request("/health", method=method)

                self.assertEqual(self.downstream_calls, [])
                self.assertEqual(
                    messages,
                    [
                        {
                            "type": "http.response.start",
                            "status": 401,
                            "headers": expected_headers,
                        },
                        {
                            "type": "http.response.body",
                            "body": expected_body,
                            "more_body": False,
                        },
                    ],
                )

    def test_public_response_cache_control_is_private(self):
        messages = self.run_request("/health")

        self.assertEqual(
            dict(messages[0]["headers"])[b"cache-control"], b"private, no-store"
        )

    def test_missing_wrong_empty_duplicate_non_ascii_and_oversized_keys_return_401(self):
        headers_by_case = [
            [],
            [(b"x-api-key", b"fixture-wrong-key")],
            [(b"x-api-key", b"")],
            [(b"x-api-key", b"first"), (b"x-api-key", b"second")],
            [(b"x-api-key", "non-ascii-\N{SNOWMAN}".encode("utf-8"))],
            [(b"x-api-key", b"a" * 257)],
        ]

        for headers in headers_by_case:
            with self.subTest(headers=headers):
                messages = self.run_request("/mcp", headers)
                self.assertEqual(messages[0]["status"], 401)
                self.assertEqual(self.downstream_calls, [])

    def test_valid_key_reaches_downstream(self):
        messages = self.run_request("/mcp", [(b"x-api-key", self.key.encode())])

        self.assertEqual(self.downstream_calls, ["/mcp"])
        self.assertEqual(messages[0]["status"], 200)
        self.assertEqual(
            dict(messages[0]["headers"])[b"cache-control"], b"private, no-store"
        )

    def test_rejection_body_and_cache_headers_are_private(self):
        messages = self.run_request("/mcp")

        self.assertEqual(
            messages[1]["body"],
            json.dumps(
                {
                    "error": {
                        "code": "authentication_required",
                        "message": "A valid API key is required.",
                    }
                },
                separators=(",", ":"),
            ).encode(),
        )
        self.assertEqual(dict(messages[0]["headers"])[b"cache-control"], b"private, no-store")

    def test_responses_include_required_security_headers(self):
        for headers in ([], [(b"x-api-key", self.key.encode())]):
            with self.subTest(headers=headers):
                response = self.run_request("/mcp", headers)[0]
                response_headers = dict(response["headers"])
                self.assertEqual(response_headers[b"cache-control"], b"private, no-store")
                if not headers:
                    self.assertEqual(response_headers[b"x-content-type-options"], b"nosniff")

    def test_no_raw_test_key_appears_in_captured_logs(self):
        captured_logs = []

        class CaptureHandler(logging.Handler):
            def emit(self, record):
                captured_logs.append(self.format(record))

        logger = logging.getLogger("wilayah_mcp.auth")
        handler = CaptureHandler()
        logger.addHandler(handler)
        try:
            self.run_request("/mcp", [(b"x-api-key", self.key.encode())])
        finally:
            logger.removeHandler(handler)

        self.assertNotIn(self.key, "\n".join(captured_logs))


if __name__ == "__main__":
    unittest.main()
