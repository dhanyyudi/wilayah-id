import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

describe("middleware", () => {
  beforeEach(() => {
    vi.stubEnv("WILAYAH_API_ORIGIN", "https://api.example.test");
    vi.stubEnv("WILAYAH_TILES_ORIGIN", "https://tiles.example.test");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.example.test");
    vi.stubEnv("WILAYAH_RUNTIME_ROLE", "proxy");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rewrites API requests to the configured API origin", async () => {
    const request = new NextRequest(
      "https://site.example.test/api/v1/regions/provinces",
    );

    const response = await middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://api.example.test/api/v1/regions/provinces",
    );
  });

  it("forwards API requests to local route handlers in origin mode", async () => {
    vi.stubEnv("WILAYAH_RUNTIME_ROLE", "origin");

    const response = await middleware(
      new NextRequest("https://site.example.test/api/v1/regions/provinces"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("does not allow a request header to activate origin mode", async () => {
    const response = await middleware(
      new NextRequest("https://site.example.test/api/v1/regions/provinces", {
        headers: { "WILAYAH_RUNTIME_ROLE": "origin" },
      }),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://api.example.test/api/v1/regions/provinces",
    );
  });

  it("rewrites tile requests without the public tiles prefix in origin mode", async () => {
    vi.stubEnv("WILAYAH_RUNTIME_ROLE", "origin");

    const request = new NextRequest(
      "https://site.example.test/tiles/provinsi/3/6/4.pbf",
    );

    const response = await middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://tiles.example.test/provinsi/3/6/4.pbf",
    );
  });

  it.each([
    [
      "/api/v1/regions/search?q=jakarta&limit=5",
      "https://api.example.test/api/v1/regions/search?q=jakarta&limit=5",
    ],
    [
      "/tiles/provinsi/3/6/4.pbf?cache=refresh&version=2",
      "https://tiles.example.test/provinsi/3/6/4.pbf?cache=refresh&version=2",
    ],
  ])("preserves the query string for %s", async (path, destination) => {
    const response = await middleware(
      new NextRequest(`https://site.example.test${path}`),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(destination);
  });

  it.each(["proxy", "origin"])(
    "keeps the exact health route local in %s mode",
    async (role) => {
      vi.stubEnv("WILAYAH_RUNTIME_ROLE", role);

      const response = await middleware(
        new NextRequest("https://site.example.test/api/health?probe=readiness"),
      );

      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    },
  );

  describe("origin access policy", () => {
    const PROXY_TOKEN = "proxy-token-0123456789abcdef-0123456789";

    beforeEach(() => {
      vi.stubEnv("WILAYAH_RUNTIME_ROLE", "origin");
      vi.stubEnv("WILAYAH_RATE_LIMIT_ENABLED", "true");
      vi.stubEnv("WILAYAH_LIMIT_ANON_PER_MINUTE", "1");
    });

    function apiRequest(path: string, ip: string, extra: Record<string, string> = {}) {
      return new NextRequest(`https://site.example.test${path}`, {
        headers: { "cf-connecting-ip": ip, ...extra },
      });
    }

    it("passes requests through with rate-limit headers, then answers 429", async () => {
      const path = "/api/v1/regions/provinces";
      const allowed = await middleware(apiRequest(path, "203.0.113.50"));
      const rejected = await middleware(apiRequest(path, "203.0.113.50"));

      expect(allowed.headers.get("x-middleware-next")).toBe("1");
      expect(allowed.headers.get("RateLimit-Limit")).toBe("1");
      expect(allowed.headers.get("X-Wilayah-Tier")).toBe("anonymous");
      expect(rejected.status).toBe(429);
      expect(rejected.headers.get("Retry-After")).toMatch(/^\d+$/);
      expect(rejected.headers.get("Cache-Control")).toBe("no-store");
      expect(await rejected.json()).toEqual({
        status: "error",
        code: 429,
        error: {
          code: "RATE_LIMITED",
          message:
            "Rate limit exceeded. Create a free API key for a higher limit.",
        },
      });
    });

    it("answers 401 for an invalid key", async () => {
      const response = await middleware(
        apiRequest("/api/v1/regions/provinces", "203.0.113.51", {
          "x-api-key": "not-a-key",
        }),
      );

      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("INVALID_API_KEY");
    });

    it("never limits the health route", async () => {
      for (let index = 0; index < 3; index += 1) {
        const response = await middleware(
          apiRequest("/api/health", "203.0.113.52"),
        );
        expect(response.headers.get("x-middleware-next")).toBe("1");
        expect(response.headers.get("RateLimit-Limit")).toBeNull();
      }
    });

    it("does not limit when enforcement is off", async () => {
      vi.stubEnv("WILAYAH_RATE_LIMIT_ENABLED", "false");
      for (let index = 0; index < 3; index += 1) {
        const response = await middleware(
          apiRequest("/api/v1/regions/provinces", "203.0.113.53"),
        );
        expect(response.headers.get("x-middleware-next")).toBe("1");
      }
    });

    it("trusts the visitor address forwarded with the proxy token", async () => {
      vi.stubEnv("WILAYAH_PROXY_TOKEN", PROXY_TOKEN);
      const viaProxy = (ip: string) =>
        middleware(
          apiRequest("/api/v1/regions/provinces", "2a06:98c0:3600::103", {
            "x-wilayah-proxy-token": PROXY_TOKEN,
            "x-wilayah-client-ip": ip,
          }),
        );

      expect((await viaProxy("198.51.100.60")).headers.get("X-Wilayah-Ip-Source")).toBe("proxy");
      expect((await viaProxy("198.51.100.60")).status).toBe(429);
      expect((await viaProxy("198.51.100.61")).headers.get("x-middleware-next")).toBe("1");
    });
  });

  describe("proxy forwarding", () => {
    const PROXY_TOKEN = "proxy-token-0123456789abcdef-0123456789";

    function forwardedHeader(response: Response, name: string) {
      return response.headers.get(`x-middleware-request-${name}`);
    }

    it("forwards the visitor address with the proxy token", async () => {
      vi.stubEnv("WILAYAH_PROXY_TOKEN", PROXY_TOKEN);
      const response = await middleware(
        new NextRequest("https://site.example.test/api/v1/regions/provinces", {
          headers: {
            "cf-connecting-ip": "198.51.100.70",
            "x-wilayah-client-ip": "10.0.0.1",
            "x-api-key": "caller-key",
          },
        }),
      );

      expect(forwardedHeader(response, "x-wilayah-proxy-token")).toBe(PROXY_TOKEN);
      expect(forwardedHeader(response, "x-wilayah-client-ip")).toBe("198.51.100.70");
      expect(forwardedHeader(response, "x-api-key")).toBe("caller-key");
    });

    it("drops caller-supplied proxy headers when no token is configured", async () => {
      const response = await middleware(
        new NextRequest("https://site.example.test/api/v1/regions/provinces", {
          headers: {
            "cf-connecting-ip": "198.51.100.71",
            "x-wilayah-proxy-token": "forged-token",
            "x-wilayah-client-ip": "10.0.0.1",
          },
        }),
      );

      expect(forwardedHeader(response, "x-wilayah-proxy-token")).toBeNull();
      expect(forwardedHeader(response, "x-wilayah-client-ip")).toBeNull();
      expect(response.headers.get("x-middleware-override-headers")).not.toContain(
        "x-wilayah-proxy-token",
      );
    });
  });
});
