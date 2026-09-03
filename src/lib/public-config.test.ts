import { describe, expect, it } from "vitest";
import {
  getAbsolutePublicUrl,
  getPublicOrigins,
  getRuntimeRole,
} from "./public-config";

describe("getRuntimeRole", () => {
  it("defaults to the proxy role when the runtime role is omitted", () => {
    expect(getRuntimeRole({})).toBe("proxy");
  });

  it("accepts the explicit origin role", () => {
    expect(getRuntimeRole({ WILAYAH_RUNTIME_ROLE: "origin" })).toBe("origin");
  });

  it.each(["", "direct", "ORIGIN"]) (
    "fails closed for the invalid explicit role %j",
    (role) => {
      expect(() => getRuntimeRole({ WILAYAH_RUNTIME_ROLE: role })).toThrow(
        "Invalid WILAYAH_RUNTIME_ROLE configuration",
      );
    },
  );
});

describe("getPublicOrigins", () => {
  it("returns the public service defaults", () => {
    const origins = getPublicOrigins({});

    expect(origins.api.href).toBe("https://wilayah-id-api.dhanypedia.it.com/");
    expect(origins.tiles.href).toBe("https://tiles.dhanypedia.it.com/");
    expect(origins.site.href).toBe("https://wilayah-id-restapi.vercel.app/");
  });

  it("uses environment overrides", () => {
    const origins = getPublicOrigins({
      WILAYAH_API_ORIGIN: "https://api.example.test",
      WILAYAH_TILES_ORIGIN: "https://tiles.example.test",
      NEXT_PUBLIC_SITE_URL: "https://site.example.test",
    });

    expect(origins.api.href).toBe("https://api.example.test/");
    expect(origins.tiles.href).toBe("https://tiles.example.test/");
    expect(origins.site.href).toBe("https://site.example.test/");
  });

  it("builds an absolute public URL from the canonical site configuration", () => {
    expect(
      getAbsolutePublicUrl("/api/v1/regions/search?q=jakarta", {
        NEXT_PUBLIC_SITE_URL: "https://site.example.test",
      }),
    ).toBe("https://site.example.test/api/v1/regions/search?q=jakarta");
  });

  it.each([
    ["WILAYAH_API_ORIGIN", "api"],
    ["WILAYAH_TILES_ORIGIN", "tiles"],
    ["NEXT_PUBLIC_SITE_URL", "site"],
  ] as const)("rejects an insecure production %s", (variable, label) => {
    expect(() =>
      getPublicOrigins({
        NODE_ENV: "production",
        [variable]: `http://${label}.example.test`,
      }),
    ).toThrow(`${variable} must use HTTPS in production`);
  });

  it.each([
    "WILAYAH_API_ORIGIN",
    "WILAYAH_TILES_ORIGIN",
    "NEXT_PUBLIC_SITE_URL",
  ] as const)("rejects a malformed %s", (variable) => {
    expect(() =>
      getPublicOrigins({
        [variable]: "not a URL",
      }),
    ).toThrow(`${variable} must be a valid absolute URL`);
  });
});
