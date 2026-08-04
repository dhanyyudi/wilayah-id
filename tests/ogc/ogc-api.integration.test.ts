/**
 * OGC API Features integration tests against a disposable PostGIS fixture.
 *
 * Exercises the real route handlers and the real repository SQL against the
 * ogc_test schema (12 provinces, ambiguous regency names, an invalid
 * source geometry, boundary-sharing villages). Gated on
 * OGC_TEST_DATABASE_URL; skipped entirely without a database.
 */

import { describe, expect, it } from "vitest";
import { GET as collectionsGET } from "@/app/api/v1/ogc/features/collections/route";
import { GET as itemsGET } from "@/app/api/v1/ogc/features/collections/[collectionId]/items/route";
import { GET as itemGET } from "@/app/api/v1/ogc/features/collections/[collectionId]/items/[featureId]/route";
import {
  OGC_TEST_DATABASE_URL,
  assertFeatureCollection,
  assertJsonException,
  req,
  useFixtureDatabase,
} from "./helpers";

const BASE = "http://localhost/api/v1/ogc/features";

function items(url: string, collectionId = "provinces") {
  return itemsGET(req(`${BASE}/collections/${collectionId}/items${url}`), {
    params: Promise.resolve({ collectionId }),
  });
}

function item(collectionId: string, featureId: string) {
  return itemGET(
    req(`${BASE}/collections/${collectionId}/items/${featureId}`),
    { params: Promise.resolve({ collectionId, featureId }) },
  );
}

describe.skipIf(!OGC_TEST_DATABASE_URL)(
  "OGC API Features integration (disposable PostGIS)",
  () => {
    useFixtureDatabase();

    it("lists exactly the four fixed collections", async () => {
      const response = await collectionsGET(req(`${BASE}/collections`));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.collections.map((c: { id: string }) => c.id)).toEqual([
        "provinces",
        "regencies",
        "districts",
        "villages",
      ]);
    });

    it("bounds the default page to 10 of 12 provinces and links the next page", async () => {
      const response = await items("");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/geo+json",
      );
      const body = await response.json();
      assertFeatureCollection(body);
      expect(body.numberMatched).toBe(12);
      expect(body.numberReturned).toBe(10);
      const rels = body.links.map((link: { rel: string }) => link.rel);
      expect(rels).toContain("next");
      expect(rels).not.toContain("prev");
    });

    it("returns the second page with a prev link and no next link", async () => {
      const response = await items("?offset=10");
      const body = await response.json();
      assertFeatureCollection(body);
      expect(body.numberMatched).toBe(12);
      expect(body.numberReturned).toBe(2);
      expect(body.features.map((f: { id: string }) => f.id)).toEqual([
        "92",
        "93",
      ]);
      const rels = body.links.map((link: { rel: string }) => link.rel);
      expect(rels).toContain("prev");
      expect(rels).not.toContain("next");
    });

    it("accepts the maximum bounded limit of 1000", async () => {
      const response = await items("?limit=1000");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.numberReturned).toBe(12);
    });

    it("rejects limit=1001 above the maximum query bound", async () => {
      const response = await items("?limit=1001");
      expect(response.status).toBe(400);
      assertJsonException(await response.json(), "InvalidParameterValue");
    });

    it("filters by bbox and returns only the intersecting province", async () => {
      const response = await items("?bbox=0.1,0.1,1.9,1.9");
      const body = await response.json();
      assertFeatureCollection(body);
      expect(body.numberMatched).toBe(1);
      expect(body.features[0].id).toBe("10");
      expect(body.features[0].properties.nama_provinsi).toBe("ALPHA");
    });

    it("returns an empty FeatureCollection for a bbox over no data", async () => {
      const response = await items("?bbox=50,50,51,51");
      expect(response.status).toBe(200);
      const body = await response.json();
      assertFeatureCollection(body);
      expect(body.numberMatched).toBe(0);
      expect(body.numberReturned).toBe(0);
      expect(body.features).toEqual([]);
    });

    it("serves the invalid source geometry without a server error", async () => {
      const response = await item("provinces", "30");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.type).toBe("Feature");
      expect(body.properties.nama_provinsi).toBe("GAMMA INVALID");
      expect(body.geometry.type).toBe("MultiPolygon");
    });

    it("resolves both ambiguous ALPHA EAST regencies by feature id", async () => {
      for (const featureId of ["1002", "2001"]) {
        const response = await item("regencies", featureId);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.properties.nama_kabupaten).toBe("ALPHA EAST");
      }
      const list = await items("?bbox=1.1,-0.1,3.9,2.1", "regencies");
      const body = await list.json();
      expect(body.numberMatched).toBe(2);
    });

    it("returns 404 NotFound for an unknown collection", async () => {
      const response = await items("", "islands");
      expect(response.status).toBe(404);
      assertJsonException(await response.json(), "NotFound");
    });

    it("returns 404 NotFound for a missing feature", async () => {
      const response = await item("provinces", "99");
      expect(response.status).toBe(404);
      assertJsonException(await response.json(), "NotFound");
    });

    it("rejects unsupported parameters instead of silently ignoring them", async () => {
      const response = await items("?resultType=hits");
      expect(response.status).toBe(400);
      assertJsonException(await response.json(), "InvalidParameterValue");
    });

    it("rejects datetime because the dataset has no temporal field", async () => {
      const response = await items("?datetime=2024-01-01T00:00:00Z");
      expect(response.status).toBe(400);
      assertJsonException(await response.json(), "InvalidParameterValue");
    });

    it("honours the properties allowlist and rejects unknown properties", async () => {
      const ok = await items("?bbox=0.1,0.1,1.9,1.9&properties=kode_prov");
      const okBody = await ok.json();
      expect(Object.keys(okBody.features[0].properties).sort()).toEqual([
        "kode_prov",
        "nama_provinsi",
      ]);

      const bad = await items("?properties=geom_secret");
      expect(bad.status).toBe(400);
      assertJsonException(await bad.json(), "InvalidParameterValue");
    });
  },
);
