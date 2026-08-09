import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { MultiPolygon, Polygon } from "geojson";
import {
  encodeRaster,
  rasterizeLayers,
  type RasterizationMetrics,
} from "./wms-raster";

const BBOX = [0, 0, 1, 1] as [number, number, number, number];

const DIAGONAL_POLYGON: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 1],
      [1, 1 - 1 / 2048],
      [0, 1 / 2048],
      [0, 0],
    ],
  ],
};

const BBOX_POLYGON: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

const HOLED_MULTIPOLYGON: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [0.1, 0.1],
        [0.45, 0.1],
        [0.45, 0.45],
        [0.1, 0.45],
        [0.1, 0.1],
      ],
      [
        [0.2, 0.2],
        [0.35, 0.2],
        [0.35, 0.35],
        [0.2, 0.35],
        [0.2, 0.2],
      ],
    ],
    [
      [
        [0.55, 0.55],
        [0.9, 0.55],
        [0.9, 0.9],
        [0.55, 0.9],
        [0.55, 0.55],
      ],
    ],
  ],
};

describe("WMS rasterization and encoding", () => {
  it("encodes exact-size PNG and JPEG images from polygonal layers", async () => {
    const layers = [{ id: "provinces" as const, geometries: [DIAGONAL_POLYGON] }];
    const pixels = rasterizeLayers(layers, BBOX, 256, 128, "image/png", true);

    const png = await sharp(encodeRaster(pixels, 256, 128, "image/png")).metadata();
    const jpeg = await sharp(encodeRaster(pixels, 256, 128, "image/jpeg")).metadata();
    expect(png.format).toBe("png");
    expect(png.width).toBe(256);
    expect(png.height).toBe(128);
    expect(jpeg.format).toBe("jpeg");
    expect(jpeg.width).toBe(256);
    expect(jpeg.height).toBe(128);
  });

  it("supports polygon holes and multipolygon members", async () => {
    const pixels = rasterizeLayers(
      [{ id: "provinces", geometries: [HOLED_MULTIPOLYGON] }],
      BBOX,
      128,
      128,
      "image/png",
      true,
    );
    const { data, info } = await sharp(encodeRaster(pixels, 128, 128, "image/png"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const holeOffset = (Math.floor(info.height * 0.7) * info.width + Math.floor(info.width * 0.275)) * 4;
    const filledOffset = (Math.floor(info.height * 0.25) * info.width + Math.floor(info.width * 0.75)) * 4;
    expect(data[holeOffset + 3]).toBe(0);
    expect(data[filledOffset + 3]).toBeGreaterThan(0);
  });

  it("draws an opaque stroke on every visible edge of an exact-BBOX polygon", () => {
    const width = 8;
    const height = 8;
    const pixels = rasterizeLayers(
      [{ id: "provinces", geometries: [BBOX_POLYGON] }],
      BBOX,
      width,
      height,
      "image/png",
      true,
    );
    const alphaAt = (x: number, y: number): number =>
      pixels[(y * width + x) * 4 + 3] ?? 0;

    expect(alphaAt(0, Math.floor(height / 2))).toBe(255);
    expect(alphaAt(width - 1, Math.floor(height / 2))).toBe(255);
    expect(alphaAt(Math.floor(width / 2), 0)).toBe(255);
    expect(alphaAt(Math.floor(width / 2), height - 1)).toBe(255);
  });

  it("counts diagonal stroke candidates proportional to line length", () => {
    const metrics: RasterizationMetrics = { strokeCandidatePixels: 0 };
    rasterizeLayers(
      [{ id: "provinces", geometries: [DIAGONAL_POLYGON] }],
      BBOX,
      2048,
      2048,
      "image/png",
      true,
      metrics,
    );

    // The ring has four visible edges plus its explicit closing point. The
    // renderer's ring wrap adds one zero-length edge: 2049 + 2 + 2049 + 2 + 2.
    expect(metrics.strokeCandidatePixels).toBe(4_104);
    expect(metrics.strokeCandidatePixels).toBeLessThanOrEqual(10 * 2048);
    expect(metrics.strokeCandidatePixels).toBeLessThan(2048 * 2048 / 100);
  });
});
