import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  issueApiKey,
  matchOwnerKey,
  sha256Hex,
  verifyApiKey,
} from "./keys";

// Shared with mcp/tests/test_access.py: both sides must accept this key.
const VECTOR_SECRET = "test-signing-secret-0123456789abcdef";
const VECTOR_KEY =
  "wid1.eyJpZCI6IjAxMjM0NTY3ODlhYmNkZWYiLCJ0IjoiZnJlZSIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDg2NDAwfQ.IrwTvyvqycrumBFstOoFPVR2e7qSUhz3CEuN8Mz9rlA";
const VECTOR_NOW = 1_790_000_000_000;

describe("issueApiKey", () => {
  it("reproduces the cross-language reference key", async () => {
    const { key, claims } = await issueApiKey({
      secret: VECTOR_SECRET,
      ttlSeconds: 86_400,
      now: VECTOR_NOW,
      id: "0123456789abcdef",
    });

    expect(key).toBe(VECTOR_KEY);
    expect(claims).toEqual({
      id: "0123456789abcdef",
      tier: "free",
      issuedAt: 1_790_000_000,
      expiresAt: 1_790_086_400,
    });
  });

  it("issues distinct ids by default", async () => {
    const options = { secret: VECTOR_SECRET, ttlSeconds: 60, now: VECTOR_NOW };
    const first = await issueApiKey(options);
    const second = await issueApiKey(options);

    expect(first.claims.id).toMatch(/^[0-9a-f]{16}$/);
    expect(first.claims.id).not.toBe(second.claims.id);
  });
});

describe("verifyApiKey", () => {
  const options = { secret: VECTOR_SECRET, now: VECTOR_NOW + 1_000 };

  it("accepts the reference key before it expires", async () => {
    const result = await verifyApiKey(VECTOR_KEY, options);

    expect(result).toEqual({
      valid: true,
      claims: {
        id: "0123456789abcdef",
        tier: "free",
        issuedAt: 1_790_000_000,
        expiresAt: 1_790_086_400,
      },
    });
  });

  it("rejects a key signed with another secret", async () => {
    const result = await verifyApiKey(VECTOR_KEY, {
      ...options,
      secret: "another-signing-secret-0123456789abcdef",
    });

    expect(result).toEqual({ valid: false, reason: "signature" });
  });

  it("rejects a tampered payload", async () => {
    const [version, payload, signature] = VECTOR_KEY.split(".");
    const forged = btoa(
      atob(payload).replace("1790086400", "1990086400"),
    ).replace(/=+$/, "");

    expect(
      await verifyApiKey(`${version}.${forged}.${signature}`, options),
    ).toEqual({ valid: false, reason: "signature" });
  });

  it("rejects an expired key at the exact expiry second", async () => {
    expect(
      await verifyApiKey(VECTOR_KEY, {
        secret: VECTOR_SECRET,
        now: 1_790_086_400_000,
      }),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects a revoked key id", async () => {
    expect(
      await verifyApiKey(VECTOR_KEY, {
        ...options,
        revokedIds: new Set(["0123456789abcdef"]),
      }),
    ).toEqual({ valid: false, reason: "revoked" });
  });

  it.each(["", "wid1", "wid1.a.b.c", "wid2.aaaa.bbbb", "wid1.@@@.bbbb", "x".repeat(300)])(
    "rejects the malformed key %j",
    async (key) => {
      expect(await verifyApiKey(key, options)).toEqual({
        valid: false,
        reason: "malformed",
      });
    },
  );
});

describe("matchOwnerKey", () => {
  const ownerHash =
    "2c9adcb6d00615adfbaba5838d7cf357e20a5fda6d5cc1f3f7be705a526fabb0";

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex("owner-key-for-tests")).toBe(ownerHash);
  });

  it("returns the matching hash among several", async () => {
    expect(
      await matchOwnerKey("owner-key-for-tests", ["0".repeat(64), ownerHash]),
    ).toBe(ownerHash);
  });

  it("returns null for an unknown key or an empty list", async () => {
    expect(await matchOwnerKey("someone-else", [ownerHash])).toBeNull();
    expect(await matchOwnerKey("owner-key-for-tests", [])).toBeNull();
  });
});

describe("constantTimeEqual", () => {
  it("compares content and length", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
