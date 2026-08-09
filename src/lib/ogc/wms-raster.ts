import { zlibSync } from "fflate";
import { encode as encodeJpeg } from "jpeg-js";
import type { Geometry, Position } from "geojson";
import type { Bbox } from "./params";

export type WmsImageFormat = "image/png" | "image/jpeg";

export interface RasterLayer {
  id: "provinces" | "regencies" | "districts" | "villages";
  geometries: Geometry[];
}

export interface RasterizationMetrics {
  strokeCandidatePixels: number;
}

const LAYER_STYLES: Record<RasterLayer["id"], { fill: string; stroke: string }> = {
  provinces: { fill: "#4c78a8", stroke: "#2f4b7c" },
  regencies: { fill: "#72b7b2", stroke: "#3a7d78" },
  districts: { fill: "#f2a65a", stroke: "#a8641c" },
  villages: { fill: "#e45756", stroke: "#8f2f2e" },
};

const FILL_OPACITY = 0.45;

const PNG_SIGNATURE = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

interface PixelColor {
  red: number;
  green: number;
  blue: number;
}

function parseHexColor(value: string): PixelColor {
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function projectPosition(
  [lon, lat]: Position,
  bbox: Bbox,
  width: number,
  height: number,
): [number, number] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return [
    ((lon - minLon) / (maxLon - minLon)) * width,
    (1 - (lat - minLat) / (maxLat - minLat)) * height,
  ];
}

function blendPixel(
  data: Uint8Array,
  offset: number,
  color: PixelColor,
  alpha: number,
): void {
  const sourceAlpha = alpha / 255;
  const destinationAlpha = data[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha === 0) {
    return;
  }

  data[offset] = Math.round(
    (color.red * sourceAlpha +
      data[offset] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  data[offset + 1] = Math.round(
    (color.green * sourceAlpha +
      data[offset + 1] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  data[offset + 2] = Math.round(
    (color.blue * sourceAlpha +
      data[offset + 2] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  data[offset + 3] = Math.round(outputAlpha * 255);
}

function drawFilledPolygon(
  data: Uint8Array,
  width: number,
  height: number,
  rings: Position[][],
  bbox: Bbox,
  color: PixelColor,
): void {
  const projectedRings = rings.map((ring) =>
    ring.map((position) => projectPosition(position, bbox, width, height)),
  );
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of projectedRings) {
    for (const [, y] of ring) {
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return;
  }

  const firstScanline = Math.max(0, Math.floor(minY));
  const lastScanline = Math.min(height - 1, Math.ceil(maxY));

  // Scanline filling uses the even-odd rule across all rings, so interior
  // holes remain transparent without requiring a separate polygon library.
  for (let y = firstScanline; y <= lastScanline; y += 1) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (const ring of projectedRings) {
      for (let index = 0; index < ring.length; index += 1) {
        const [x1, y1] = ring[index];
        const [x2, y2] = ring[(index + 1) % ring.length];
        if ((y1 > scanY) !== (y2 > scanY)) {
          intersections.push(x1 + ((scanY - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil(intersections[index] - 0.5));
      const end = Math.min(
        width - 1,
        Math.ceil(intersections[index + 1] - 0.5) - 1,
      );
      for (let x = start; x <= end; x += 1) {
        blendPixel(data, (y * width + x) * 4, color, FILL_OPACITY * 255);
      }
    }
  }
}

function drawStroke(
  data: Uint8Array,
  width: number,
  height: number,
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  color: PixelColor,
  metrics?: RasterizationMetrics,
): void {
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY))));
  const stepX = deltaX / steps;
  const stepY = deltaY / steps;
  let x = x1;
  let y = y1;

  // DDA visits one candidate per pixel-length step instead of scanning the
  // segment's rectangular bounding area. The bounds check preserves clipping.
  for (let step = 0; step <= steps; step += 1) {
    const pixelX = Math.floor(x);
    const pixelY = Math.floor(y);
    if (pixelX >= 0 && pixelX < width && pixelY >= 0 && pixelY < height) {
      if (metrics) {
        metrics.strokeCandidatePixels += 1;
      }
      blendPixel(data, (pixelY * width + pixelX) * 4, color, 255);
    }
    x += stepX;
    y += stepY;
  }
}

export function rasterizeLayers(
  layers: RasterLayer[],
  bbox: Bbox,
  width: number,
  height: number,
  format: WmsImageFormat,
  transparent: boolean,
  metrics?: RasterizationMetrics,
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  if (!transparent || format === "image/jpeg") {
    // JPEG has no alpha; opaque PNG flattens onto the default white WMS
    // background.
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }

  for (const layer of layers) {
    const style = LAYER_STYLES[layer.id];
    const fill = parseHexColor(style.fill);
    const stroke = parseHexColor(style.stroke);
    for (const geometry of layer.geometries) {
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.type === "MultiPolygon"
            ? geometry.coordinates
            : [];
      for (const rings of polygons) {
        drawFilledPolygon(data, width, height, rings, bbox, fill);
        const projectedRings = rings.map((ring) =>
          ring.map((position) =>
            projectPosition(position, bbox, width, height),
          ),
        );
        for (const ring of projectedRings) {
          for (let index = 0; index < ring.length; index += 1) {
            drawStroke(
              data,
              width,
              height,
              ring[index],
              ring[(index + 1) % ring.length],
              stroke,
              metrics,
            );
          }
        }
      }
    }
  }
  return data;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(
    8 + data.length,
    crc32(chunk.subarray(4, 8 + data.length)),
  );
  return chunk;
}

function encodePng(data: Uint8Array, width: number, height: number): Buffer {
  const scanlines = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    scanlines.set(
      data.subarray(y * width * 4, (y + 1) * width * 4),
      rowOffset + 1,
    );
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  return Buffer.from(
    concatBytes(
      PNG_SIGNATURE,
      pngChunk("IHDR", header),
      pngChunk("IDAT", zlibSync(scanlines)),
      pngChunk("IEND", new Uint8Array()),
    ),
  );
}

export function encodeRaster(
  data: Uint8Array,
  width: number,
  height: number,
  format: WmsImageFormat,
): Buffer {
  if (format === "image/png") {
    return encodePng(data, width, height);
  }
  return Buffer.from(encodeJpeg({ data, width, height }, 90).data);
}
