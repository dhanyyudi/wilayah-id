/**
 * Issued API keys are stateless: `wid1.<payload>.<signature>` where the
 * signature is HMAC-SHA256 over `wid1.<payload>`. The MCP server verifies the
 * same format in `mcp/wilayah_mcp/access.py`, so both sides must stay in sync.
 *
 * This module only uses Web Crypto so it can run inside Edge middleware.
 */

const KEY_VERSION = "wid1";
const MAX_KEY_LENGTH = 256;

export interface ApiKeyClaims {
  id: string;
  tier: "free";
  issuedAt: number;
  expiresAt: number;
}

export type ApiKeyVerification =
  | { valid: true; claims: ApiKeyClaims }
  | { valid: false; reason: "malformed" | "signature" | "expired" | "revoked" };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importSecret(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function generateKeyId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(8)));
}

export async function issueApiKey(options: {
  secret: string;
  ttlSeconds: number;
  now: number;
  id?: string;
}): Promise<{ key: string; claims: ApiKeyClaims }> {
  const issuedAt = Math.floor(options.now / 1000);
  const claims: ApiKeyClaims = {
    id: options.id ?? generateKeyId(),
    tier: "free",
    issuedAt,
    expiresAt: issuedAt + options.ttlSeconds,
  };
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        id: claims.id,
        t: claims.tier,
        iat: claims.issuedAt,
        exp: claims.expiresAt,
      }),
    ),
  );
  const signed = `${KEY_VERSION}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importSecret(options.secret),
    encoder.encode(signed),
  );
  return {
    key: `${signed}.${toBase64Url(new Uint8Array(signature))}`,
    claims,
  };
}

export async function verifyApiKey(
  key: string,
  options: { secret: string; now: number; revokedIds?: ReadonlySet<string> },
): Promise<ApiKeyVerification> {
  if (key.length > MAX_KEY_LENGTH) {
    return { valid: false, reason: "malformed" };
  }
  const parts = key.split(".");
  if (parts.length !== 3 || parts[0] !== KEY_VERSION) {
    return { valid: false, reason: "malformed" };
  }
  const [, payload, signature] = parts;
  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (!signatureBytes || !payloadBytes) {
    return { valid: false, reason: "malformed" };
  }

  const authentic = await crypto.subtle.verify(
    "HMAC",
    await importSecret(options.secret),
    signatureBytes as BufferSource,
    encoder.encode(`${KEY_VERSION}.${payload}`),
  );
  if (!authentic) {
    return { valid: false, reason: "signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof record.id !== "string" ||
    !/^[0-9a-f]{16}$/.test(record.id) ||
    record.t !== "free" ||
    !Number.isInteger(record.iat) ||
    !Number.isInteger(record.exp)
  ) {
    return { valid: false, reason: "malformed" };
  }

  const claims: ApiKeyClaims = {
    id: record.id,
    tier: "free",
    issuedAt: record.iat as number,
    expiresAt: record.exp as number,
  };
  if (claims.expiresAt <= Math.floor(options.now / 1000)) {
    return { valid: false, reason: "expired" };
  }
  if (options.revokedIds?.has(claims.id)) {
    return { valid: false, reason: "revoked" };
  }
  return { valid: true, claims };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

/** Compare without stopping at the first differing character. */
export function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** Return the matching owner hash, checking every configured hash. */
export async function matchOwnerKey(
  key: string,
  ownerHashes: readonly string[],
): Promise<string | null> {
  if (ownerHashes.length === 0 || key.length > MAX_KEY_LENGTH) {
    return null;
  }
  const digest = await sha256Hex(key);
  let matched: string | null = null;
  for (const expected of ownerHashes) {
    if (constantTimeEqual(digest, expected)) {
      matched = expected;
    }
  }
  return matched;
}
