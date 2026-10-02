import { describe, expect, it } from "vitest";
import { getAccessConfig } from "./config";

const SECRET = "s".repeat(32);

describe("getAccessConfig", () => {
  it("is disabled with default limits when nothing is configured", () => {
    const config = getAccessConfig({});

    expect(config.enabled).toBe(false);
    expect(config.signingSecret).toBeNull();
    expect(config.proxyToken).toBeNull();
    expect(config.ownerKeyHashes).toEqual([]);
    expect(config.keyTtlSeconds).toBe(365 * 86_400);
    expect(config.limits).toEqual({
      anonymousPerMinute: 60,
      anonymousHeavyPerMinute: 10,
      keyPerMinute: 300,
      keyHeavyPerMinute: 60,
      keyPerDay: 20_000,
      ownerPerMinute: 3_000,
      keyIssuePerDay: 5,
    });
  });

  it("reads explicit values", () => {
    const config = getAccessConfig({
      WILAYAH_RATE_LIMIT_ENABLED: "true",
      WILAYAH_KEY_SIGNING_SECRET: SECRET,
      WILAYAH_PROXY_TOKEN: "p".repeat(40),
      WILAYAH_OWNER_KEYS_SHA256: ` ${"A".repeat(64)} , ${"b".repeat(64)} `,
      WILAYAH_OWNER_ALLOWED_IPS: "203.0.113.7",
      WILAYAH_REVOKED_KEY_IDS: "0123456789abcdef, fedcba9876543210",
      WILAYAH_KEY_TTL_DAYS: "30",
      WILAYAH_LIMIT_ANON_PER_MINUTE: "5",
    });

    expect(config.enabled).toBe(true);
    expect(config.signingSecret).toBe(SECRET);
    expect(config.ownerKeyHashes).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(config.ownerAllowedIps).toEqual(["203.0.113.7"]);
    expect(config.revokedKeyIds.has("fedcba9876543210")).toBe(true);
    expect(config.keyTtlSeconds).toBe(30 * 86_400);
    expect(config.limits.anonymousPerMinute).toBe(5);
  });

  it.each([
    [{ WILAYAH_RATE_LIMIT_ENABLED: "yes" }, "WILAYAH_RATE_LIMIT_ENABLED"],
    [{ WILAYAH_RATE_LIMIT_ENABLED: "" }, "WILAYAH_RATE_LIMIT_ENABLED"],
    [{ WILAYAH_KEY_SIGNING_SECRET: "short" }, "WILAYAH_KEY_SIGNING_SECRET"],
    [{ WILAYAH_PROXY_TOKEN: "short" }, "WILAYAH_PROXY_TOKEN"],
    [{ WILAYAH_OWNER_KEYS_SHA256: "not-a-hash" }, "WILAYAH_OWNER_KEYS_SHA256"],
    [{ WILAYAH_LIMIT_ANON_PER_MINUTE: "0" }, "WILAYAH_LIMIT_ANON_PER_MINUTE"],
    [{ WILAYAH_LIMIT_KEY_PER_DAY: "-1" }, "WILAYAH_LIMIT_KEY_PER_DAY"],
    [{ WILAYAH_KEY_TTL_DAYS: "1.5" }, "WILAYAH_KEY_TTL_DAYS"],
  ])("fails closed for the invalid setting %j", (env, variable) => {
    expect(() => getAccessConfig(env)).toThrow(variable);
  });
});
