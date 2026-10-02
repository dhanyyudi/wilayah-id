import type { AccessConfig } from "./config";
import { constantTimeEqual, matchOwnerKey, verifyApiKey } from "./keys";
import type { FixedWindowLimiter, RateLimitResult } from "./rate-limit";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

export const PROXY_TOKEN_HEADER = "x-wilayah-proxy-token";
export const PROXY_CLIENT_IP_HEADER = "x-wilayah-client-ip";

export type RequestClass = "general" | "heavy" | "issue";
export type AccessTier = "anonymous" | "free" | "owner";
export type IpSource = "proxy" | "cloudflare" | "forwarded" | "unknown";

export interface AccessRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  headers: Headers;
}

export type AccessDecision =
  | { action: "allow"; headers: Record<string, string> }
  | {
      action: "reject";
      status: 401 | 429;
      code: "INVALID_API_KEY" | "RATE_LIMITED";
      message: string;
      headers: Record<string, string>;
    };

function parameter(searchParams: URLSearchParams, name: string): string | null {
  for (const [key, value] of searchParams) {
    if (key.toLowerCase() === name) {
      return value;
    }
  }
  return null;
}

/** Sort a request into the bucket that reflects its database cost. */
export function classifyRequest(request: AccessRequest): RequestClass {
  const { pathname, searchParams } = request;

  if (pathname === "/api/keys" && request.method === "POST") {
    return "issue";
  }
  if (pathname === "/api/v1/ogc/wms") {
    return parameter(searchParams, "request")?.toLowerCase() === "getmap"
      ? "heavy"
      : "general";
  }
  if (pathname === "/api/v1/ogc/wfs") {
    return parameter(searchParams, "request")?.toLowerCase() === "getfeature"
      ? "heavy"
      : "general";
  }
  if (/^\/api\/v1\/ogc\/features\/collections\/[^/]+\/items(\/|$)/.test(pathname)) {
    return "heavy";
  }
  if (
    pathname.startsWith("/api/v1/boundaries/") &&
    pathname !== "/api/v1/boundaries/reverse" &&
    parameter(searchParams, "geometry")?.toLowerCase() === "true"
  ) {
    return "heavy";
  }
  return "general";
}

/** Group IPv6 clients by /64 so one subscriber cannot rotate addresses. */
export function normalizeClientIp(value: string): string {
  const ip = value.trim().toLowerCase();
  if (!ip.includes(":")) {
    return ip;
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) {
    return mapped[1];
  }
  const [head, tail = ""] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups = ip.includes("::")
    ? [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups]
    : headGroups;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

export function resolveClientIp(
  headers: Headers,
  config: Pick<AccessConfig, "proxyToken">,
): { ip: string; source: IpSource } {
  const presented = headers.get(PROXY_TOKEN_HEADER);
  if (
    config.proxyToken &&
    presented &&
    constantTimeEqual(presented, config.proxyToken)
  ) {
    const proxied = headers.get(PROXY_CLIENT_IP_HEADER);
    if (proxied) {
      return { ip: normalizeClientIp(proxied), source: "proxy" };
    }
  }

  const cloudflare = headers.get("cf-connecting-ip");
  if (cloudflare) {
    return { ip: normalizeClientIp(cloudflare), source: "cloudflare" };
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return { ip: normalizeClientIp(realIp), source: "forwarded" };
  }
  // Only the last hop is appended by a proxy we control; earlier entries are
  // supplied by the client.
  const forwarded = headers.get("x-forwarded-for")?.split(",").pop()?.trim();
  if (forwarded) {
    return { ip: normalizeClientIp(forwarded), source: "forwarded" };
  }
  return { ip: "unknown", source: "unknown" };
}

function extractCredential(request: AccessRequest): string | null {
  return (
    request.headers.get("x-api-key") ??
    parameter(request.searchParams, "api_key")
  );
}

function limitHeaders(
  result: RateLimitResult,
  now: number,
): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.max(1, Math.ceil((result.resetAt - now) / 1000))),
  };
}

function invalidKey(message: string): AccessDecision {
  return {
    action: "reject",
    status: 401,
    code: "INVALID_API_KEY",
    message,
    headers: { "Cache-Control": "no-store" },
  };
}

/**
 * Decide whether one API request may proceed. An invalid key is rejected
 * rather than downgraded to anonymous so callers notice a broken credential.
 */
export async function evaluateAccess(
  request: AccessRequest,
  config: AccessConfig,
  limiter: FixedWindowLimiter,
  now: number,
): Promise<AccessDecision> {
  if (!config.enabled) {
    return { action: "allow", headers: {} };
  }

  const requestClass = classifyRequest(request);
  const client = resolveClientIp(request.headers, config);
  const credential = extractCredential(request);
  const { limits } = config;

  let tier: AccessTier = "anonymous";
  let identity = `ip:${client.ip}`;

  if (credential !== null) {
    const ownerHash = await matchOwnerKey(credential, config.ownerKeyHashes);
    if (ownerHash) {
      if (
        config.ownerAllowedIps.length > 0 &&
        !config.ownerAllowedIps.map(normalizeClientIp).includes(client.ip)
      ) {
        return invalidKey("The API key is not valid from this address.");
      }
      tier = "owner";
      identity = `owner:${ownerHash.slice(0, 16)}`;
    } else {
      const verification = config.signingSecret
        ? await verifyApiKey(credential, {
            secret: config.signingSecret,
            now,
            revokedIds: config.revokedKeyIds,
          })
        : ({ valid: false, reason: "malformed" } as const);
      if (!verification.valid) {
        return invalidKey(
          verification.reason === "expired"
            ? "The API key has expired. Create a new key."
            : verification.reason === "revoked"
              ? "The API key has been revoked."
              : "The API key is not valid.",
        );
      }
      tier = "free";
      identity = `key:${verification.claims.id}`;
    }
  }

  const tierHeaders = {
    "X-Wilayah-Tier": tier,
    "X-Wilayah-Ip-Source": client.source,
  };

  const checks: Array<[string, number, number]> = [];
  if (requestClass === "issue") {
    // Key creation is capped per address no matter which key is presented.
    checks.push([`issue:${client.ip}`, limits.keyIssuePerDay, DAY_MS]);
  } else if (tier === "owner") {
    checks.push([identity, limits.ownerPerMinute, MINUTE_MS]);
  } else if (tier === "free") {
    checks.push(
      requestClass === "heavy"
        ? [`${identity}:heavy`, limits.keyHeavyPerMinute, MINUTE_MS]
        : [identity, limits.keyPerMinute, MINUTE_MS],
      [`${identity}:day`, limits.keyPerDay, DAY_MS],
    );
  } else {
    checks.push(
      requestClass === "heavy"
        ? [`${identity}:heavy`, limits.anonymousHeavyPerMinute, MINUTE_MS]
        : [identity, limits.anonymousPerMinute, MINUTE_MS],
    );
  }

  let reported: RateLimitResult | null = null;
  for (const [bucket, limit, windowMs] of checks) {
    const result = limiter.take(bucket, limit, windowMs, now);
    reported ??= result;
    if (!result.allowed) {
      const headers = limitHeaders(result, now);
      return {
        action: "reject",
        status: 429,
        code: "RATE_LIMITED",
        message:
          requestClass === "issue"
            ? "API key creation limit reached for this address. Try again tomorrow."
            : tier === "anonymous"
              ? "Rate limit exceeded. Create a free API key for a higher limit."
              : "Rate limit exceeded for this API key.",
        headers: {
          ...tierHeaders,
          ...headers,
          "Retry-After": headers["RateLimit-Reset"],
          "Cache-Control": "no-store",
        },
      };
    }
  }

  return {
    action: "allow",
    headers: { ...tierHeaders, ...(reported ? limitHeaders(reported, now) : {}) },
  };
}
