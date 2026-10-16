import { describe, expect, it } from "vitest";
import {
  DATASET_SNAPSHOT,
  DATA_SOURCES,
  GEOMETRY_SOURCE,
  REGION_META,
  featureGeometrySource,
} from "./provenance";

describe("provenance", () => {
  it("names BIG BATASWILAYAH as the geometry source", () => {
    expect(DATA_SOURCES.geometry.name).toContain("Badan Informasi Geospasial");
    expect(DATA_SOURCES.geometry.edition).toBe("2026-06-12");
    expect(GEOMETRY_SOURCE).toBe("BIG BATASWILAYAH 2026-06-12");
  });

  it("keeps names and population on their own sources", () => {
    expect(DATA_SOURCES.names.edition).toBe("2025");
    expect(DATA_SOURCES.demographics.name).toBe("Ditjen Dukcapil Kemendagri");
    expect(REGION_META.source).toBe(
      "BIG BATASWILAYAH 2026-06-12; names Kepmendagri 2025; population Dukcapil 2024 Semester 1",
    );
    expect(REGION_META.attribution).toContain("Badan Informasi Geospasial (BIG)");
  });

  it("uses the snapshot id shared with the MCP server", () => {
    expect(DATASET_SNAPSHOT).toBe("big-2026-06-12+kepmendagri-2025+dukcapil-2024-s1");
    expect(REGION_META.snapshot).toBe(DATASET_SNAPSHOT);
  });

  it("prefers the per-feature geometry source of a village", () => {
    const retained = "Dukcapil Kemendagri 2024 S1, dipotong dengan coverage BIG";
    expect(featureGeometrySource(retained)).toBe(retained);
    expect(featureGeometrySource(null)).toBe(GEOMETRY_SOURCE);
    expect(featureGeometrySource("")).toBe(GEOMETRY_SOURCE);
  });
});
