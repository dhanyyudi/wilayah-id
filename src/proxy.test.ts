import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("rewrites API requests to the configured API origin", () => {
    const request = new NextRequest(
      "https://site.example.test/api/v1/regions/provinces",
    );

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://wilayah-id-api.dhanypedia.it.com/api/v1/regions/provinces",
    );
  });

  it("rewrites tile requests without the public tiles prefix", () => {
    const request = new NextRequest(
      "https://site.example.test/tiles/provinsi/3/6/4.pbf",
    );

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "https://tiles.dhanypedia.it.com/provinsi/3/6/4.pbf",
    );
  });

  it.each([
    [
      "/api/v1/regions/search?q=jakarta&limit=5",
      "https://wilayah-id-api.dhanypedia.it.com/api/v1/regions/search?q=jakarta&limit=5",
    ],
    [
      "/tiles/provinsi/3/6/4.pbf?cache=refresh&version=2",
      "https://tiles.dhanypedia.it.com/provinsi/3/6/4.pbf?cache=refresh&version=2",
    ],
  ])("preserves the query string for %s", (path, destination) => {
    const response = proxy(new NextRequest(`https://site.example.test${path}`));

    expect(response.headers.get("x-middleware-rewrite")).toBe(destination);
  });

  it("keeps the exact health route local", () => {
    const response = proxy(
      new NextRequest("https://site.example.test/api/health?probe=readiness"),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
