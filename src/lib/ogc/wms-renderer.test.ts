/**
 * Unit tests for the bounded WMS renderer.
 *
 * No live PostGIS is required: a fake DbQueryFunction records SQL and
 * returns small synthetic geometries. Every raster assertion decodes the
 * produced image through Sharp, so a passing test proves the bytes are a
 * real, decodable image of the requested dimensions.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { XMLValidator } from "fast-xml-parser";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { QueryResultRow } from "pg";
import type { DbQueryFunction } from "../db";
import { OgcError } from "./errors";
import {
  WMS_MAX_DIMENSION,
  WMS_MAX_PIXELS,
  generateWmsCapabilities,
  queryFeaturesAtPoint,
  renderWmsMap,
  validateMapDimensions,
} from "./wms-renderer";

interface CapturedQuery {
  text: string;
  params: unknown[];
}

function createFakeDb(
  handler: (text: string, params: unknown[]) => QueryResultRow[],
): { db: DbQueryFunction; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const db: DbQueryFunction = Object.assign(
    async (): Promise<QueryResultRow[]> => [],
    {
      query: async (text: string, params?: unknown[]) => {
        queries.push({ text, params: params ?? [] });
        return handler(text, params ?? []);
      },
    },
  );
  return { db, queries };
}

/** Synthetic square around Jakarta, [106.25..106.75] x [-6.75..-6.25]. */
const SQUARE: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [106.25, -6.75],
        [106.75, -6.75],
        [106.75, -6.25],
        [106.25, -6.25],
        [106.25, -6.75],
      ],
    ],
  ],
};
const SQUARE_BBOX = [106.25, -6.75, 106.75, -6.25];

function envelopesIntersect(bbox: number[]): boolean {
  return (
    bbox[0] <= SQUARE_BBOX[2] &&
    bbox[2] >= SQUARE_BBOX[0] &&
    bbox[1] <= SQUARE_BBOX[3] &&
    bbox[3] >= SQUARE_BBOX[1]
  );
}

/** Fake store that answers map queries with the synthetic square when the
 * requested envelope intersects it, and nothing otherwise. */
function createSquareDb() {
  return createFakeDb((text, params) => {
    if (text.includes("ST_AsGeoJSON")) {
      const envelope = params.slice(0, 4).map(Number);
      return envelopesIntersect(envelope) ? [{ geometry: SQUARE }] : [];
    }
    return [];
  });
}

function createGeometryDb(geometry: Polygon | MultiPolygon) {
  return createFakeDb((text) =>
    text.includes("ST_AsGeoJSON") ? [{ geometry }] : [],
  );
}

function createHighVertexPolygon(): Polygon {
  const vertexCount = 125_001;
  const ring: Position[] = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const angle = (index / vertexCount) * Math.PI * 2;
    ring.push([
      106.5 + Math.cos(angle) * 0.45,
      -6.5 + Math.sin(angle) * 0.45,
    ]);
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

async function expectSomeVariation(buffer: Buffer): Promise<void> {
  const stats = await sharp(buffer).stats();
  expect(
    stats.channels.some((channel) => channel.stdev > 0),
    "rendered image must not be uniform",
  ).toBe(true);
}

async function cornerAlpha(buffer: Buffer): Promise<number> {
  const { data } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[3];
}

describe("validateMapDimensions", () => {
  it("exposes the advertised bounds", () => {
    expect(WMS_MAX_DIMENSION).toBe(2048);
    expect(WMS_MAX_PIXELS).toBe(4194304);
  });

  it("accepts the largest advertised request", () => {
    expect(() => validateMapDimensions(2048, 2048)).not.toThrow();
    expect(() => validateMapDimensions(1, 1)).not.toThrow();
  });

  it("rejects zero, negative, non-integer, and oversized dimensions", () => {
    for (const [width, height] of [
      [0, 100],
      [100, -1],
      [2049, 100],
      [100, 2049],
      [100.5, 100],
      [Number.NaN, 100],
    ]) {
      expect(() => validateMapDimensions(width, height)).toThrowError(OgcError);
      try {
        validateMapDimensions(width, height);
      } catch (error) {
        expect((error as OgcError).code).toBe("InvalidParameterValue");
      }
    }
  });
});

describe("renderWmsMap SQL", () => {
  it("queries only intersecting geometries, clipped and simplified", async () => {
    const { db, queries } = createSquareDb();
    await renderWmsMap(
      {
        bbox: [106, -7, 107, -6],
        width: 256,
        height: 128,
        layers: ["provinces"],
        transparent: true,
        format: "image/png",
      },
      db,
    );

    expect(queries).toHaveLength(1);
    const { text, params } = queries[0];
    expect(text).toContain("ST_Intersects");
    expect(text).toContain("ST_Intersection");
    expect(text).toContain("ST_SimplifyPreserveTopology");
    expect(text).toContain("ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    expect(text).toContain('FROM "provinsi"');
    expect(text).toContain("LIMIT 5000");
    expect(params.slice(0, 4)).toEqual([106, -7, 107, -6]);
    // Pixel-derived tolerance: half of the larger pixel span in degrees.
    // max(1/256, 1/128) / 2 = 0.00390625
    expect(Number(params[4])).toBeCloseTo(0.00390625, 10);
  });

  it("queries one bounded statement per requested layer from the catalog", async () => {
    const { db, queries } = createSquareDb();
    await renderWmsMap(
      {
        bbox: [106, -7, 107, -6],
        width: 256,
        height: 128,
        layers: ["provinces", "districts"],
        transparent: true,
        format: "image/png",
      },
      db,
    );

    expect(queries).toHaveLength(2);
    expect(queries[0].text).toContain('FROM "provinsi"');
    expect(queries[1].text).toContain('FROM "kecamatan"');
  });

  it("sanitizes database failures", async () => {
    const db: DbQueryFunction = Object.assign(
      async (): Promise<QueryResultRow[]> => [],
      {
        query: async (): Promise<QueryResultRow[]> => {
          throw new Error("password authentication failed for user postgres");
        },
      },
    );

    try {
      await renderWmsMap(
        {
          bbox: [106, -7, 107, -6],
          width: 256,
          height: 128,
          layers: ["provinces"],
          transparent: true,
          format: "image/png",
        },
        db,
      );
      expect.unreachable("renderWmsMap must reject on store failure");
    } catch (error) {
      expect(error).toBeInstanceOf(OgcError);
      expect((error as OgcError).code).toBe("NoApplicableCode");
      expect((error as OgcError).message).not.toContain("password");
    }
  });
});

describe("renderWmsMap raster output", () => {
  it("renders a valid polygon with more than 125,000 vertices", async () => {
    const { db } = createGeometryDb(createHighVertexPolygon());
    const image = await renderWmsMap(
      {
        bbox: [106, -7, 107, -6],
        width: 64,
        height: 64,
        layers: ["provinces"],
        transparent: true,
        format: "image/png",
      },
      db,
    );

    const metadata = await sharp(image).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
  });

  it("does not import native Sharp in the application renderer", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./wms-renderer.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toMatch(/from [\"']sharp[\"']/);
    expect(source).not.toMatch(/require\([\"']sharp[\"']\)/);
  });

  it("renders different nonempty images for two different bounding boxes", async () => {
    const { db } = createSquareDb();
    const base = {
      width: 256,
      height: 128,
      layers: ["provinces" as const],
      transparent: true,
      format: "image/png" as const,
    };

    const imageA = await renderWmsMap(
      { ...base, bbox: [106, -7, 107, -6] },
      db,
    );
    const imageB = await renderWmsMap(
      { ...base, bbox: [106.5, -7, 107.5, -6] },
      db,
    );

    // Both decode through Sharp at the requested dimensions.
    const metaA = await sharp(imageA).metadata();
    const metaB = await sharp(imageB).metadata();
    expect(metaA.width).toBe(256);
    expect(metaA.height).toBe(128);
    expect(metaB.width).toBe(256);
    expect(metaB.height).toBe(128);

    // Both are nonempty (the square is visible in each viewport)...
    await expectSomeVariation(imageA);
    await expectSomeVariation(imageB);

    // ...and the two views do not produce the same pixels.
    expect(imageA.equals(imageB)).toBe(false);
  });

  it("honours the requested width and height exactly", async () => {
    const { db } = createSquareDb();
    const buffer = await renderWmsMap(
      {
        bbox: [106, -7, 107, -6],
        width: 640,
        height: 480,
        layers: ["provinces"],
        transparent: true,
        format: "image/png",
      },
      db,
    );
    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(480);
  });

  it("keeps empty areas transparent only when TRANSPARENT=TRUE", async () => {
    const { db } = createSquareDb();
    const base = {
      bbox: [106, -7, 107, -6] as [number, number, number, number],
      width: 256,
      height: 128,
      layers: ["provinces" as const],
      format: "image/png" as const,
    };

    const transparentImage = await renderWmsMap({ ...base, transparent: true }, db);
    const opaqueImage = await renderWmsMap({ ...base, transparent: false }, db);

    // Pixel (0,0) is outside the synthetic square.
    expect(await cornerAlpha(transparentImage)).toBe(0);
    expect(await cornerAlpha(opaqueImage)).toBe(255);
  });

  it("produces a decodable JPEG without an alpha channel", async () => {
    const { db } = createSquareDb();
    const buffer = await renderWmsMap(
      {
        bbox: [106, -7, 107, -6],
        width: 256,
        height: 128,
        layers: ["provinces"],
        transparent: false,
        format: "image/jpeg",
      },
      db,
    );
    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(256);
    await expectSomeVariation(buffer);
  });

  it("renders a uniform image when no geometry intersects the bbox", async () => {
    const { db } = createSquareDb();
    const buffer = await renderWmsMap(
      {
        bbox: [100, -7, 101, -6],
        width: 256,
        height: 128,
        layers: ["provinces"],
        transparent: true,
        format: "image/png",
      },
      db,
    );
    const metadata = await sharp(buffer).metadata();
    expect(metadata.width).toBe(256);
    const stats = await sharp(buffer).stats();
    expect(stats.channels.every((channel) => channel.stdev === 0)).toBe(true);
  });
});

describe("queryFeaturesAtPoint", () => {
  it("uses ST_Covers so boundary points count", async () => {
    const { db, queries } = createFakeDb(() => [
      { kode_prov: "31", nama_provinsi: "DKI JAKARTA" },
    ]);

    const properties = await queryFeaturesAtPoint("provinces", 106.8, -6.2, db);

    expect(properties).toEqual({ kode_prov: "31", nama_provinsi: "DKI JAKARTA" });
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain("ST_Covers");
    expect(queries[0].text).not.toContain("ST_Contains");
    expect(queries[0].text).toContain('FROM "provinsi"');
    expect(queries[0].params).toEqual([106.8, -6.2]);
  });

  it("returns null when no feature covers the point", async () => {
    const { db } = createFakeDb(() => []);
    await expect(
      queryFeaturesAtPoint("villages", 110, -7, db),
    ).resolves.toBeNull();
  });

  it("sanitizes database failures", async () => {
    const db: DbQueryFunction = Object.assign(
      async (): Promise<QueryResultRow[]> => [],
      {
        query: async (): Promise<QueryResultRow[]> => {
          throw new Error("connection terminated: 10.0.0.5:5432");
        },
      },
    );
    try {
      await queryFeaturesAtPoint("provinces", 106.8, -6.2, db);
      expect.unreachable("queryFeaturesAtPoint must reject on store failure");
    } catch (error) {
      expect(error).toBeInstanceOf(OgcError);
      expect((error as OgcError).code).toBe("NoApplicableCode");
      expect((error as OgcError).message).not.toContain("10.0.0.5");
    }
  });
});

describe("generateWmsCapabilities", () => {
  const xml = generateWmsCapabilities("https://example.test");

  it("is well-formed XML advertising version 1.3.0", () => {
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('version="1.3.0"');
  });

  it("advertises exactly the implemented GetMap formats", () => {
    expect(xml).toContain("<Format>image/png</Format>");
    expect(xml).toContain("<Format>image/jpeg</Format>");
    expect(xml).not.toContain("image/gif");
  });

  it("advertises the four catalog collections as layers", () => {
    for (const id of ["provinces", "regencies", "districts", "villages"]) {
      expect(xml).toContain(`<Name>${id}</Name>`);
    }
    // The legacy table-derived layer names are gone.
    expect(xml).not.toContain("<Name>provinsi</Name>");
    expect(xml).not.toContain("<Name>kabupaten</Name>");
    expect(xml).not.toContain("<Name>kecamatan</Name>");
    expect(xml).not.toContain("<Name>desa</Name>");
  });

  it("advertises both supported CRS and the default style only", () => {
    expect(xml).toContain("<CRS>CRS:84</CRS>");
    expect(xml).toContain("<CRS>EPSG:4326</CRS>");
    expect(xml).toContain("<Name>default</Name>");
  });

  it("advertises the dimension limits and XML exception format", () => {
    expect(xml).toContain("<MaxWidth>2048</MaxWidth>");
    expect(xml).toContain("<MaxHeight>2048</MaxHeight>");
    expect(xml).toContain("<Format>XML</Format>");
  });

  it("advertises only implemented GetFeatureInfo formats", () => {
    expect(xml).toContain("<Format>application/json</Format>");
    expect(xml).toContain("<Format>text/plain</Format>");
    expect(xml).not.toContain("text/html");
  });
});
