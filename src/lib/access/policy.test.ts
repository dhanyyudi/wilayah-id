import { describe, expect, it } from "vitest";
import { getAccessConfig } from "./config";
import type { AccessConfig } from "./config";
import { issueApiKey } from "./keys";
import {
  classifyRequest,
  evaluateAccess,
  normalizeClientIp,
  resolveClientIp,
} from "./policy";
import type { AccessRequest } from "./policy";
import { FixedWindowLimiter } from "./rate-limit";

const SECRET = "test-signing-secret-0123456789abcdef";
const PROXY_TOKEN = "proxy-token-0123456789abcdef-0123456789";
const OWNER_KEY = "owner-key-for-tests";
const OWNER_HASH =
  "2c9adcb6d00615adfbaba5838d7cf357e20a5fda6d5cc1f3f7be705a526fabb0";
const NOW = 1_790_000_000_000;

function config(overrides: Record<string, string> = {}): AccessConfig {
  return getAccessConfig({
    WILAYAH_RATE_LIMIT_ENABLED: "true",
    WILAYAH_KEY_SIGNING_SECRET: SECRET,
    WILAYAH_PROXY_TOKEN: PROXY_TOKEN,
    WILAYAH_OWNER_KEYS_SHA256: OWNER_HASH,
    WILAYAH_LIMIT_ANON_PER_MINUTE: "2",
    WILAYAH_LIMIT_ANON_HEAVY_PER_MINUTE: "1",
    WILAYAH_LIMIT_KEY_PER_MINUTE: "3",
    WILAYAH_LIMIT_KEY_HEAVY_PER_MINUTE: "2",
    WILAYAH_LIMIT_KEY_PER_DAY: "4",
    WILAYAH_LIMIT_OWNER_PER_MINUTE: "5",
    WILAYAH_LIMIT_KEY_ISSUE_PER_DAY: "1",
    ...overrides,
  });
}

function request(
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): AccessRequest {
  const url = new URL(path, "https://api.example.test");
  return {
    method,
    pathname: url.pathname,
    searchParams: url.searchParams,
    headers: new Headers({ "cf-connecting-ip": "203.0.113.7", ...headers }),
  };
}

async function freeKey(id = "0123456789abcdef", ttlSeconds = 3_600) {
  return (await issueApiKey({ secret: SECRET, ttlSeconds, now: NOW, id })).key;
}

describe("classifyRequest", () => {
  it.each([
    ["/api/v1/regions/provinces", "GET", "general"],
    ["/api/v1/boundaries/reverse?lat=-6.2&lng=106.8", "GET", "general"],
    ["/api/v1/boundaries/provinces", "GET", "general"],
    ["/api/v1/boundaries/provinces?geometry=true", "GET", "heavy"],
    ["/api/v1/boundaries/provinces/31?GEOMETRY=TRUE", "GET", "heavy"],
    ["/api/v1/ogc/wms?SERVICE=WMS&REQUEST=GetCapabilities", "GET", "general"],
    ["/api/v1/ogc/wms?service=WMS&request=getmap", "GET", "heavy"],
    ["/api/v1/ogc/wfs?REQUEST=GetFeature&TYPENAMES=provinces", "GET", "heavy"],
    ["/api/v1/ogc/wfs?REQUEST=DescribeFeatureType", "GET", "general"],
    ["/api/v1/ogc/features/collections", "GET", "general"],
    ["/api/v1/ogc/features/collections/provinces/items", "GET", "heavy"],
    ["/api/v1/ogc/features/collections/provinces/items/31", "GET", "heavy"],
    ["/api/keys", "POST", "issue"],
    ["/api/keys", "GET", "general"],
  ])("classifies %s %s as %s", (path, method, expected) => {
    expect(classifyRequest(request(path, {}, method))).toBe(expected);
  });
});

describe("normalizeClientIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["2001:DB8:1:2::1", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001:0db8:0001:0002::1", "2001:db8:1:2::/64"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeClientIp(input)).toBe(expected);
  });
});

describe("resolveClientIp", () => {
  it("trusts the proxied address only with the matching token", () => {
    const headers = new Headers({
      "cf-connecting-ip": "2a06:98c0:3600::103",
      "x-wilayah-proxy-token": PROXY_TOKEN,
      "x-wilayah-client-ip": "198.51.100.9",
    });

    expect(resolveClientIp(headers, { proxyToken: PROXY_TOKEN })).toEqual({
      ip: "198.51.100.9",
      source: "proxy",
    });
  });

  it("ignores a proxied address with a wrong or unconfigured token", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-wilayah-proxy-token": "guessed-token-0123456789abcdef-012345678",
      "x-wilayah-client-ip": "198.51.100.9",
    });

    expect(resolveClientIp(headers, { proxyToken: PROXY_TOKEN })).toEqual({
      ip: "203.0.113.7",
      source: "cloudflare",
    });
    expect(resolveClientIp(headers, { proxyToken: null }).ip).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to the last forwarded hop, then to unknown", () => {
    expect(
      resolveClientIp(
        new Headers({ "x-forwarded-for": "10.9.9.9, 192.0.2.44" }),
        { proxyToken: null },
      ),
    ).toEqual({ ip: "192.0.2.44", source: "forwarded" });
    expect(resolveClientIp(new Headers(), { proxyToken: null })).toEqual({
      ip: "unknown",
      source: "unknown",
    });
  });
});

describe("evaluateAccess", () => {
  it("allows everything without headers when enforcement is off", async () => {
    const limiter = new FixedWindowLimiter();
    const disabled = config({ WILAYAH_RATE_LIMIT_ENABLED: "false" });

    for (let index = 0; index < 10; index += 1) {
      expect(
        await evaluateAccess(request("/api/v1/regions/provinces"), disabled, limiter, NOW),
      ).toEqual({ action: "allow", headers: {} });
    }
  });

  it("limits anonymous callers per address and reports the window", async () => {
    const limiter = new FixedWindowLimiter();
    const call = () =>
      evaluateAccess(request("/api/v1/regions/provinces"), config(), limiter, NOW);

    expect(await call()).toEqual({
      action: "allow",
      headers: {
        "X-Wilayah-Tier": "anonymous",
        "X-Wilayah-Ip-Source": "cloudflare",
        "RateLimit-Limit": "2",
        "RateLimit-Remaining": "1",
        "RateLimit-Reset": "40",
      },
    });
    await call();
    const rejected = await call();

    expect(rejected).toMatchObject({
      action: "reject",
      status: 429,
      code: "RATE_LIMITED",
      headers: { "Retry-After": "40", "RateLimit-Remaining": "0" },
    });
  });

  it("keeps separate anonymous addresses and heavy requests apart", async () => {
    const limiter = new FixedWindowLimiter();
    const general = "/api/v1/regions/provinces";
    const heavy = "/api/v1/boundaries/provinces?geometry=true";
    await evaluateAccess(request(general), config(), limiter, NOW);
    await evaluateAccess(request(general), config(), limiter, NOW);

    expect(
      (await evaluateAccess(request(general), config(), limiter, NOW)).action,
    ).toBe("reject");
    expect(
      (
        await evaluateAccess(
          request(general, { "cf-connecting-ip": "203.0.113.8" }),
          config(),
          limiter,
          NOW,
        )
      ).action,
    ).toBe("allow");
    expect(
      (await evaluateAccess(request(heavy), config(), limiter, NOW)).action,
    ).toBe("allow");
    expect(
      (await evaluateAccess(request(heavy), config(), limiter, NOW)).action,
    ).toBe("reject");
  });

  it("gives a free key its own higher budget in a header or query", async () => {
    const limiter = new FixedWindowLimiter();
    const key = await freeKey();
    const viaHeader = request("/api/v1/regions/provinces", { "x-api-key": key });
    const viaQuery = request(`/api/v1/regions/provinces?api_key=${key}`);

    const first = await evaluateAccess(viaHeader, config(), limiter, NOW);
    expect(first).toMatchObject({
      action: "allow",
      headers: { "X-Wilayah-Tier": "free", "RateLimit-Limit": "3" },
    });
    await evaluateAccess(viaQuery, config(), limiter, NOW);
    await evaluateAccess(viaHeader, config(), limiter, NOW);

    expect(
      (await evaluateAccess(viaQuery, config(), limiter, NOW)).action,
    ).toBe("reject");
  });

  it("enforces the daily budget of a free key across minutes", async () => {
    const limiter = new FixedWindowLimiter();
    const keyed = request("/api/v1/regions/provinces", {
      "x-api-key": await freeKey(),
    });
    const outcomes: string[] = [];
    for (let minute = 0; minute < 5; minute += 1) {
      outcomes.push(
        (await evaluateAccess(keyed, config(), limiter, NOW + minute * 60_000))
          .action,
      );
    }

    expect(outcomes).toEqual(["allow", "allow", "allow", "allow", "reject"]);
  });

  it.each([
    ["an unknown key", async () => "not-a-key", "The API key is not valid."],
    [
      "an expired key",
      async () => freeKey("0123456789abcdef", -1),
      "The API key has expired. Create a new key.",
    ],
    [
      "a revoked key",
      async () => freeKey("fedcba9876543210"),
      "The API key has been revoked.",
    ],
  ])("rejects %s instead of downgrading it", async (_name, makeKey, message) => {
    const decision = await evaluateAccess(
      request("/api/v1/regions/provinces", { "x-api-key": await makeKey() }),
      config({ WILAYAH_REVOKED_KEY_IDS: "fedcba9876543210" }),
      new FixedWindowLimiter(),
      NOW,
    );

    expect(decision).toMatchObject({
      action: "reject",
      status: 401,
      code: "INVALID_API_KEY",
      message,
    });
  });

  it("rejects issued keys when no signing secret is configured", async () => {
    const decision = await evaluateAccess(
      request("/api/v1/regions/provinces", { "x-api-key": await freeKey() }),
      config({ WILAYAH_KEY_SIGNING_SECRET: "" }),
      new FixedWindowLimiter(),
      NOW,
    );

    expect(decision).toMatchObject({ action: "reject", status: 401 });
  });

  it("applies only the owner safety cap to an owner key", async () => {
    const limiter = new FixedWindowLimiter();
    const owned = request("/api/v1/boundaries/provinces?geometry=true", {
      "x-api-key": OWNER_KEY,
    });
    const outcomes: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      outcomes.push((await evaluateAccess(owned, config(), limiter, NOW)).action);
    }

    expect(outcomes).toEqual([
      "allow",
      "allow",
      "allow",
      "allow",
      "allow",
      "reject",
    ]);
  });

  it("refuses an owner key from an address outside the allowlist", async () => {
    const restricted = config({ WILAYAH_OWNER_ALLOWED_IPS: "198.51.100.9" });
    const limiter = new FixedWindowLimiter();

    expect(
      await evaluateAccess(
        request("/api/v1/regions/provinces", { "x-api-key": OWNER_KEY }),
        restricted,
        limiter,
        NOW,
      ),
    ).toMatchObject({ action: "reject", status: 401 });
    expect(
      await evaluateAccess(
        request("/api/v1/regions/provinces", {
          "x-api-key": OWNER_KEY,
          "cf-connecting-ip": "198.51.100.9",
        }),
        restricted,
        limiter,
        NOW,
      ),
    ).toMatchObject({ action: "allow", headers: { "X-Wilayah-Tier": "owner" } });
  });

  it("caps key creation per address even when a key is presented", async () => {
    const limiter = new FixedWindowLimiter();
    const create = (headers: Record<string, string> = {}) =>
      evaluateAccess(request("/api/keys", headers, "POST"), config(), limiter, NOW);

    expect((await create()).action).toBe("allow");
    expect(await create({ "x-api-key": await freeKey() })).toMatchObject({
      action: "reject",
      status: 429,
      message:
        "API key creation limit reached for this address. Try again tomorrow.",
    });
    expect(
      (await create({ "cf-connecting-ip": "203.0.113.99" })).action,
    ).toBe("allow");
  });

  it("buckets proxied visitors by their own address", async () => {
    const limiter = new FixedWindowLimiter();
    const proxied = (ip: string) =>
      request("/api/v1/regions/provinces", {
        "cf-connecting-ip": "2a06:98c0:3600::103",
        "x-wilayah-proxy-token": PROXY_TOKEN,
        "x-wilayah-client-ip": ip,
      });
    await evaluateAccess(proxied("198.51.100.1"), config(), limiter, NOW);
    await evaluateAccess(proxied("198.51.100.1"), config(), limiter, NOW);

    expect(
      (await evaluateAccess(proxied("198.51.100.1"), config(), limiter, NOW))
        .action,
    ).toBe("reject");
    expect(
      await evaluateAccess(proxied("198.51.100.2"), config(), limiter, NOW),
    ).toMatchObject({
      action: "allow",
      headers: { "X-Wilayah-Ip-Source": "proxy" },
    });
  });
});
