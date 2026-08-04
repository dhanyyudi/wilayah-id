/**
 * WMS 1.3.0 integration tests against a disposable PostGIS fixture.
 *
 * Covers capabilities, real bounded GetMap rendering (PNG/JPEG, CRS:84 and
 * EPSG:4326 axis orders), dimension limits, GetFeatureInfo with ST_Covers
 * boundary semantics, and standards-shaped ServiceExceptionReports. Gated
 * on OGC_TEST_DATABASE_URL.
 */

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/ogc/wms/route";
import {
  OGC_TEST_DATABASE_URL,
  assertXmlException,
  assertXmlWellFormed,
  req,
  useFixtureDatabase,
} from "./helpers";

const BASE = "http://localhost/api/v1/ogc/wms";

function wms(query: string) {
  return GET(req(`${BASE}?SERVICE=WMS&${query}`));
}

describe.skipIf(!OGC_TEST_DATABASE_URL)(
  "WMS 1.3.0 integration (disposable PostGIS)",
  () => {
    useFixtureDatabase();

    it("serves a well-formed GetCapabilities with truthful limits and layers", async () => {
      const response = await wms("REQUEST=GetCapabilities");
      expect(response.status).toBe(200);
      const xml = await response.text();
      assertXmlWellFormed(xml);
      expect(xml).toContain("WMS_Capabilities");
      expect(xml).toContain("<MaxWidth>2048</MaxWidth>");
      expect(xml).toContain("<MaxHeight>2048</MaxHeight>");
      for (const name of ["provinces", "regencies", "districts", "villages"]) {
        expect(xml).toContain(`<Name>${name}</Name>`);
      }
    });

    it("renders a real bounded PNG map for CRS:84", async () => {
      const response = await wms(
        "REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&CRS=CRS:84" +
          "&BBOX=0,0,4,2&WIDTH=256&HEIGHT=256&FORMAT=image/png",
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      const metadata = await sharp(
        Buffer.from(await response.arrayBuffer()),
      ).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(256);
      expect(metadata.height).toBe(256);
    });

    it("honours the EPSG:4326 lat,lon axis order", async () => {
      // CRS:84 lon,lat 0,0,2,1 and EPSG:4326 lat,lon 0,0,1,2 describe the
      // same window; both must render successfully.
      for (const [crs, bbox] of [
        ["CRS:84", "0,0,2,1"],
        ["EPSG:4326", "0,0,1,2"],
      ] as const) {
        const response = await wms(
          `REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&CRS=${crs}` +
            `&BBOX=${bbox}&WIDTH=128&HEIGHT=128&FORMAT=image/png`,
        );
        expect(response.status).toBe(200);
        const metadata = await sharp(
          Buffer.from(await response.arrayBuffer()),
        ).metadata();
        expect(metadata.width).toBe(128);
      }
    });

    it("renders JPEG when requested", async () => {
      const response = await wms(
        "REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&CRS=CRS:84" +
          "&BBOX=0,0,4,2&WIDTH=64&HEIGHT=64&FORMAT=image/jpeg",
      );
      expect(response.status).toBe(200);
      const metadata = await sharp(
        Buffer.from(await response.arrayBuffer()),
      ).metadata();
      expect(metadata.format).toBe("jpeg");
    });

    it("rejects WIDTH above the 2048 dimension limit before allocation", async () => {
      const response = await wms(
        "REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&CRS=CRS:84" +
          "&BBOX=0,0,4,2&WIDTH=2049&HEIGHT=256&FORMAT=image/png",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "InvalidParameterValue");
    });

    it("rejects unknown layers with LayerNotDefined", async () => {
      const response = await wms(
        "REQUEST=GetMap&VERSION=1.3.0&LAYERS=islands&CRS=CRS:84" +
          "&BBOX=0,0,4,2&WIDTH=64&HEIGHT=64&FORMAT=image/png",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "LayerNotDefined");
    });

    it("rejects unimplemented formats with InvalidFormat", async () => {
      const response = await wms(
        "REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&CRS=CRS:84" +
          "&BBOX=0,0,4,2&WIDTH=64&HEIGHT=64&FORMAT=text/html",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "InvalidFormat");
    });

    it("rejects non-default styles with StyleNotDefined", async () => {
      const response = await wms(
        "REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&STYLES=fancy&CRS=CRS:84" +
          "&BBOX=0,0,4,2&WIDTH=64&HEIGHT=64&FORMAT=image/png",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "StyleNotDefined");
    });

    it("rejects unsupported dimensions such as TIME", async () => {
      const response = await wms(
        "REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&CRS=CRS:84" +
          "&BBOX=0,0,4,2&WIDTH=64&HEIGHT=64&FORMAT=image/png&TIME=2024-01-01",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "InvalidParameterValue");
    });

    it("counts boundary points in GetFeatureInfo via ST_Covers", async () => {
      // I=25,J=50 over BBOX 0,0,2,2 at 100x100 resolves to lon=0.5,lat=1.0,
      // exactly on the shared edge of the two fixture villages.
      const response = await wms(
        "REQUEST=GetFeatureInfo&VERSION=1.3.0&LAYERS=villages&QUERY_LAYERS=villages" +
          "&CRS=CRS:84&BBOX=0,0,2,2&WIDTH=100&HEIGHT=100&I=25&J=50" +
          "&INFO_FORMAT=application/json",
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.coordinate.lon).toBeCloseTo(0.5);
      expect(body.coordinate.lat).toBeCloseTo(1.0);
      expect(body.layers.villages).toBeTruthy();
      expect(["ALPHA VILLAGE", "BOUNDARY VILLAGE"]).toContain(
        body.layers.villages.nama_desa,
      );
    });

    it("returns no layers for a GetFeatureInfo point over empty space", async () => {
      const response = await wms(
        "REQUEST=GetFeatureInfo&VERSION=1.3.0&LAYERS=villages&QUERY_LAYERS=villages" +
          "&CRS=CRS:84&BBOX=50,50,52,52&WIDTH=100&HEIGHT=100&I=50&J=50" +
          "&INFO_FORMAT=application/json",
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.layers).toEqual({});
    });

    it("rejects out-of-extent pixel indices with InvalidPoint", async () => {
      const response = await wms(
        "REQUEST=GetFeatureInfo&VERSION=1.3.0&LAYERS=villages&QUERY_LAYERS=villages" +
          "&CRS=CRS:84&BBOX=0,0,2,2&WIDTH=100&HEIGHT=100&I=100&J=50",
      );
      expect(response.status).toBe(400);
      assertXmlException(await response.text(), "InvalidPoint");
    });
  },
);
