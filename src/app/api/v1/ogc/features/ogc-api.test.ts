/**
 * Route contract tests for OGC API Features (Core + GeoJSON).
 *
 * The repository layer is mocked, so no live PostGIS is required. The mock
 * keeps the real catalog-driven collection behavior and stubs only the two
 * database-backed feature methods.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { OgcError } from "@/lib/ogc/errors";
import { GET as landingGET } from "./route";
import { GET as conformanceGET } from "./conformance/route";
import { GET as apiGET } from "./api/route";
import { GET as collectionsGET } from "./collections/route";
import { GET as collectionGET } from "./collections/[collectionId]/route";
import { GET as itemsGET } from "./collections/[collectionId]/items/route";
import { GET as itemGET } from "./collections/[collectionId]/items/[featureId]/route";

const mocks = vi.hoisted(() => ({
  listFeatures: vi.fn(),
  getFeature: vi.fn(),
}));

vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  const { createOgcRepository } = await import("@/lib/ogc/repository");
  const real = createOgcRepository();
  return {
    ...original,
    getOgcRepository: () => ({
      ...real,
      listFeatures: mocks.listFeatures,
      getFeature: mocks.getFeature,
    }),
  };
});

const FEATURE = {
  type: "Feature",
  id: "31",
  geometry: { type: "MultiPolygon", coordinates: [] },
  properties: { kode_prov: "31", nama_provinsi: "DKI JAKARTA" },
};

const BASE = "http://localhost/api/v1/ogc/features";

function req(path: string): NextRequest {
  return new NextRequest(`${BASE}${path}`);
}

beforeEach(() => {
  mocks.listFeatures.mockReset();
  mocks.getFeature.mockReset();
  mocks.listFeatures.mockResolvedValue({
    features: [FEATURE],
    numberMatched: 25,
    numberReturned: 1,
  });
  mocks.getFeature.mockResolvedValue(FEATURE);
});

describe("GET /api/v1/ogc/features (landing page)", () => {
  it("returns a JSON landing document with the required links", async () => {
    const response = await landingGET(req(""));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.title).toBeTruthy();
    expect(body.description).toBeTruthy();
    const rels = body.links.map((link: { rel: string }) => link.rel);
    expect(rels).toContain("self");
    expect(rels).toContain("service-desc");
    expect(rels).toContain("conformance");
    expect(rels).toContain("data");
    for (const link of body.links) {
      expect(link.href).toMatch(/^https:\/\//);
    }
    const dataLink = body.links.find(
      (link: { rel: string }) => link.rel === "data",
    );
    expect(dataLink.href).toContain("/api/v1/ogc/features/collections");
  });

  it("serves a minimal accessible HTML representation with f=html", async () => {
    const response = await landingGET(req("?f=html"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("<html lang=");
    expect(html).toContain("<title>");
    expect(html).toContain("<h1");
    expect(html).toContain("<main");
  });
});

describe("GET /api/v1/ogc/features/conformance", () => {
  it("declares exactly the implemented conformance classes", async () => {
    const response = await conformanceGET(req("/conformance"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.conformsTo).toEqual([
      "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core",
      "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30",
      "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/html",
      "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson",
    ]);
  });
});

describe("GET /api/v1/ogc/features/api", () => {
  it("serves an OpenAPI document covering the implemented paths", async () => {
    const response = await apiGET(req("/api"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("json");
    const body = await response.json();
    expect(body.openapi).toMatch(/^3\.0/);
    expect(body.paths["/collections"]).toBeTruthy();
    expect(body.paths["/collections/{collectionId}"]).toBeTruthy();
    expect(body.paths["/collections/{collectionId}/items"]).toBeTruthy();
    expect(
      body.paths["/collections/{collectionId}/items/{featureId}"],
    ).toBeTruthy();
  });
});

describe("GET /api/v1/ogc/features/collections", () => {
  it("lists exactly the four administrative collections", async () => {
    const response = await collectionsGET(req("/collections"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.collections.map((c: { id: string }) => c.id)).toEqual([
      "provinces",
      "regencies",
      "districts",
      "villages",
    ]);
    for (const collection of body.collections) {
      expect(collection.itemType).toBe("feature");
      expect(collection.crs).toContain(
        "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      );
      const itemLink = collection.links.find(
        (link: { rel: string }) => link.rel === "items",
      );
      expect(itemLink.href).toContain(
        `/collections/${collection.id}/items`,
      );
    }
  });

  it("serves an HTML representation listing the collections", async () => {
    const response = await collectionsGET(req("/collections?f=html"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("provinces");
    expect(html).toContain("villages");
    expect(html).toContain("<ul");
  });
});

describe("GET /api/v1/ogc/features/collections/{collectionId}", () => {
  it("returns metadata for a known collection", async () => {
    const response = await collectionGET(req("/collections/provinces"), {
      params: Promise.resolve({ collectionId: "provinces" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("provinces");
    expect(body.title).toBe("Provinces");
    expect(body.itemType).toBe("feature");
    expect(body.extent.spatial.bbox[0]).toHaveLength(4);
  });

  it("returns a standards-shaped 404 for an unknown collection", async () => {
    const response = await collectionGET(req("/collections/planets"), {
      params: Promise.resolve({ collectionId: "planets" }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NotFound");
    expect(body.description).toContain("planets");
  });
});

describe("GET /api/v1/ogc/features/collections/{collectionId}/items", () => {
  const ctx = { params: Promise.resolve({ collectionId: "provinces" }) };

  it("returns a GeoJSON FeatureCollection with paging metadata", async () => {
    const response = await itemsGET(req("/collections/provinces/items"), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/geo+json",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
    const body = await response.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.numberMatched).toBe(25);
    expect(body.numberReturned).toBe(1);
    expect(body.features).toHaveLength(1);
    expect(body.timeStamp).toBeTruthy();
  });

  it("emits RFC 8288 self and next links on the first page", async () => {
    const response = await itemsGET(req("/collections/provinces/items"), ctx);
    const body = await response.json();
    const byRel = Object.fromEntries(
      body.links.map((link: { rel: string; href: string }) => [
        link.rel,
        link.href,
      ]),
    );
    expect(byRel.self).toContain("/collections/provinces/items");
    expect(byRel.next).toContain("offset=10");
    expect(byRel.prev).toBeUndefined();
  });

  it("emits prev and next links on a middle page", async () => {
    const response = await itemsGET(
      req("/collections/provinces/items?offset=10"),
      ctx,
    );
    const body = await response.json();
    const byRel = Object.fromEntries(
      body.links.map((link: { rel: string; href: string }) => [
        link.rel,
        link.href,
      ]),
    );
    expect(byRel.prev).toContain("offset=0");
    expect(byRel.next).toContain("offset=20");
  });

  it("omits the next link on the last page", async () => {
    mocks.listFeatures.mockResolvedValue({
      features: [FEATURE],
      numberMatched: 25,
      numberReturned: 5,
    });
    const response = await itemsGET(
      req("/collections/provinces/items?offset=20"),
      ctx,
    );
    const body = await response.json();
    const rels = body.links.map((link: { rel: string }) => link.rel);
    expect(rels).toContain("prev");
    expect(rels).not.toContain("next");
  });

  it("passes validated bbox, limit, offset, properties, and crs to the repository", async () => {
    const response = await itemsGET(
      req(
        "/collections/provinces/items?bbox=106,-7,107,-6&limit=5&offset=5&properties=kode_prov&crs=CRS84",
      ),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(mocks.listFeatures).toHaveBeenCalledWith("provinces", {
      bbox: [106, -7, 107, -6],
      limit: 5,
      offset: 5,
      properties: ["kode_prov"],
      crs: "CRS84",
    });
  });

  it("applies the default limit of 10", async () => {
    await itemsGET(req("/collections/provinces/items"), ctx);
    expect(mocks.listFeatures).toHaveBeenCalledWith(
      "provinces",
      expect.objectContaining({ limit: 10, offset: 0 }),
    );
  });

  it("rejects unsupported parameters with a standards-shaped error", async () => {
    const response = await itemsGET(
      req("/collections/provinces/items?filter=pop>1000"),
      ctx,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("InvalidParameterValue");
    expect(body.description).toContain("filter");
    expect(mocks.listFeatures).not.toHaveBeenCalled();
  });

  it("rejects datetime because the data has no temporal field", async () => {
    const response = await itemsGET(
      req("/collections/provinces/items?datetime=2024-01-01"),
      ctx,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("InvalidParameterValue");
  });

  it("rejects a limit above 1000", async () => {
    const response = await itemsGET(
      req("/collections/provinces/items?limit=5000"),
      ctx,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("InvalidParameterValue");
  });

  it("accepts f=geojson and f=json without leaking f into query parsing", async () => {
    for (const f of ["geojson", "json"]) {
      mocks.listFeatures.mockClear();
      const response = await itemsGET(
        req(`/collections/provinces/items?f=${f}`),
        ctx,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/geo+json",
      );
      expect(mocks.listFeatures).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects an unsupported f value", async () => {
    const response = await itemsGET(
      req("/collections/provinces/items?f=csv"),
      ctx,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("InvalidParameterValue");
  });

  it("serves an HTML representation with feature navigation", async () => {
    const response = await itemsGET(
      req("/collections/provinces/items?f=html"),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("DKI JAKARTA");
    expect(html).toContain("/collections/provinces/items/31");
    expect(html).toContain("next");
  });

  it("returns 404 for an unknown collection", async () => {
    const response = await itemsGET(req("/collections/planets/items"), {
      params: Promise.resolve({ collectionId: "planets" }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NotFound");
  });

  it("sanitizes unexpected store failures", async () => {
    mocks.listFeatures.mockRejectedValue(
      new Error("password authentication failed for user postgres"),
    );
    const response = await itemsGET(req("/collections/provinces/items"), ctx);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("NoApplicableCode");
    expect(JSON.stringify(body)).not.toContain("password");
  });
});

describe("GET /api/v1/ogc/features/collections/{collectionId}/items/{featureId}", () => {
  const ctx = {
    params: Promise.resolve({ collectionId: "provinces", featureId: "31" }),
  };

  it("returns a single GeoJSON feature", async () => {
    const response = await itemGET(
      req("/collections/provinces/items/31"),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/geo+json",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
    const body = await response.json();
    expect(body.type).toBe("Feature");
    expect(body.id).toBe("31");
    expect(body.properties.nama_provinsi).toBe("DKI JAKARTA");
    expect(mocks.getFeature).toHaveBeenCalledWith("provinces", "31");
  });

  it("returns a standards-shaped 404 for a missing feature", async () => {
    mocks.getFeature.mockRejectedValue(
      new OgcError("NotFound", 'Feature "99" does not exist'),
    );
    const response = await itemGET(
      req("/collections/provinces/items/99"),
      ctx,
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NotFound");
  });

  it("serves an HTML representation of the feature properties", async () => {
    const response = await itemGET(
      req("/collections/provinces/items/31?f=html"),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("nama_provinsi");
    expect(html).toContain("DKI JAKARTA");
  });
});
