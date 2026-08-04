/**
 * WFS 2.0 integration tests against a disposable PostGIS fixture.
 *
 * Covers capabilities, DescribeFeatureType, bounded GeoJSON and GML
 * GetFeature responses, paging, FILTER refusal, and standards-shaped
 * exception reports. Gated on OGC_TEST_DATABASE_URL.
 */

import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/ogc/wfs/route";
import {
  OGC_TEST_DATABASE_URL,
  assertFeatureCollection,
  assertXmlException,
  assertXmlWellFormed,
  req,
  useFixtureDatabase,
} from "./helpers";

const BASE = "http://localhost/api/v1/ogc/wfs";

function wfs(query: string) {
  return GET(req(`${BASE}?SERVICE=WFS&${query}`));
}

describe.skipIf(!OGC_TEST_DATABASE_URL)(
  "WFS 2.0 integration (disposable PostGIS)",
  () => {
    useFixtureDatabase();

    it("serves a well-formed GetCapabilities advertising the four types", async () => {
      const response = await wfs("REQUEST=GetCapabilities");
      expect(response.status).toBe(200);
      const xml = await response.text();
      assertXmlWellFormed(xml);
      expect(xml).toContain("WFS_Capabilities");
      for (const name of ["provinces", "regencies", "districts", "villages"]) {
        expect(xml).toContain(name);
      }
    });

    it("describes the provinces feature type with its catalog fields", async () => {
      const response = await wfs(
        "REQUEST=DescribeFeatureType&TYPENAMES=provinces",
      );
      expect(response.status).toBe(200);
      const xml = await response.text();
      assertXmlWellFormed(xml);
      expect(xml).toContain("kode_prov");
      expect(xml).toContain("nama_provinsi");
      expect(xml).toContain("geom");
    });

    it("returns a bounded GeoJSON FeatureCollection by default", async () => {
      const response = await wfs(
        "REQUEST=GetFeature&TYPENAMES=provinces&OUTPUTFORMAT=application%2Fgeo%2Bjson",
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/geo+json",
      );
      const body = await response.json();
      assertFeatureCollection(body);
      expect(body.numberMatched).toBe(12);
      expect(body.numberReturned).toBe(10);
    });

    it("pages with COUNT and STARTINDEX", async () => {
      const response = await wfs(
        "REQUEST=GetFeature&TYPENAMES=provinces&COUNT=3&STARTINDEX=3",
      );
      const body = await response.json();
      assertFeatureCollection(body);
      expect(body.numberMatched).toBe(12);
      expect(body.numberReturned).toBe(3);
      expect(body.features[0].id).toBe("40");
    });

    it("rejects COUNT above the maximum query bound", async () => {
      const response = await wfs(
        "REQUEST=GetFeature&TYPENAMES=provinces&COUNT=1001",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "InvalidParameterValue");
    });

    it("returns GML 3.2 for the GML output format", async () => {
      const response = await wfs(
        "REQUEST=GetFeature&TYPENAMES=villages&OUTPUTFORMAT=" +
          encodeURIComponent("application/gml+xml; version=3.2"),
      );
      expect(response.status).toBe(200);
      const xml = await response.text();
      assertXmlWellFormed(xml);
      expect(xml).toContain("gml");
      expect(xml).toContain("ALPHA VILLAGE");
      expect(xml).toContain("BOUNDARY VILLAGE");
    });

    it("refuses FILTER with OperationNotSupported", async () => {
      const response = await wfs(
        "REQUEST=GetFeature&TYPENAMES=provinces&FILTER=" +
          encodeURIComponent("<fes:Filter/>"),
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "OperationNotSupported");
    });

    it("rejects unknown type names with InvalidParameterValue", async () => {
      const response = await wfs("REQUEST=GetFeature&TYPENAMES=islands");
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "InvalidParameterValue");
    });

    it("rejects multi-typename queries with OperationNotSupported", async () => {
      const response = await wfs(
        "REQUEST=GetFeature&TYPENAMES=provinces,regencies",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "OperationNotSupported");
    });

    it("rejects unsupported srsName values", async () => {
      const response = await wfs(
        "REQUEST=GetFeature&TYPENAMES=provinces&SRSNAME=EPSG:3857",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "InvalidParameterValue");
    });

    it("rejects unsupported parameters on every operation", async () => {
      const response = await wfs("REQUEST=GetCapabilities&FOO=bar");
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "InvalidParameterValue");
    });

    it("filters GetFeature by BBOX and returns empty results truthfully", async () => {
      const hit = await wfs(
        "REQUEST=GetFeature&TYPENAMES=provinces&BBOX=0.1,0.1,1.9,1.9",
      );
      const hitBody = await hit.json();
      expect(hitBody.numberMatched).toBe(1);
      expect(hitBody.features[0].id).toBe("10");

      const empty = await wfs(
        "REQUEST=GetFeature&TYPENAMES=provinces&BBOX=50,50,51,51",
      );
      expect(empty.status).toBe(200);
      const emptyBody = await empty.json();
      assertFeatureCollection(emptyBody);
      expect(emptyBody.numberMatched).toBe(0);
      expect(emptyBody.features).toEqual([]);
    });
  },
);
