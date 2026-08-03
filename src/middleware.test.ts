import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

describe("middleware", () => {
  beforeEach(() => {
    vi.stubEnv("WILAYAH_API_ORIGIN", "https://api.example.test");
    vi.stubEnv("WILAYAH_TILES_ORIGIN", "https://tiles.example.test");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rewrites API requests to the configured API origin", () => {
    const request = new NextRequest(
      "https://site.example.test/api/v1/regions/provinces",
    );

    const response = middleware(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://api.example.test/api/v1/regions/provinces",
    );
  });

  it("rewrites tile requests without the public tiles prefix", () => {
    const request = new NextRequest(
      "https://site.example.test/tiles/provinsi/3/6/4.pbf",
    );

    const response = middleware(request);

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
  ])("preserves the query string for %s", (path, destination) => {
    const response = middleware(
      new NextRequest(`https://site.example.test${path}`),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBe(destination);
  });

  it("keeps the exact health route local", () => {
    const response = middleware(
      new NextRequest("https://site.example.test/api/health?probe=readiness"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
