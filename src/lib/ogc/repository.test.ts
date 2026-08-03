import { describe, expect, it } from "vitest";
import type { QueryResultRow } from "pg";
import type { DbQueryFunction } from "../db";
import { OgcError } from "./errors";
import { createOgcRepository } from "./repository";

interface CapturedQuery {
  text: string;
  params: unknown[];
}

/**
 * Builds a fake DbQueryFunction that records queries and delegates row
 * production to the given handler. No live PostGIS is required.
 */
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

function createThrowingDb(rawMessage: string): DbQueryFunction {
  return Object.assign(
    async (): Promise<QueryResultRow[]> => [],
    {
      query: async (): Promise<QueryResultRow[]> => {
        throw new Error(rawMessage);
      },
    },
  );
}

const PROVINCE_ROW: QueryResultRow = {
  kode_prov: "31",
  nama_provinsi: "DKI JAKARTA",
  geometry: { type: "MultiPolygon", coordinates: [] },
};

describe("OgcRepository collections", () => {
  it("lists exactly the four fixed collections", () => {
    const { db } = createFakeDb(() => []);
    const repo = createOgcRepository(db);

    const collections = repo.listCollections();

    expect(collections.map((c) => c.id)).toEqual([
      "provinces",
      "regencies",
      "districts",
      "villages",
    ]);
    expect(collections.map((c) => c.table)).toEqual([
      "provinsi",
      "kabupaten",
      "kecamatan",
      "desa",
    ]);
  });

  it("returns the collection definition for a known id", () => {
    const { db } = createFakeDb(() => []);
    const repo = createOgcRepository(db);

    const def = repo.getCollection("regencies");

    expect(def.table).toBe("kabupaten");
    expect(def.idColumn).toBe("kode_kab");
    expect(def.nameColumn).toBe("nama_kabupaten");
    expect(def.geometryColumn).toBe("geom");
  });

  it("rejects an unknown collection id with NotFound", () => {
    const { db } = createFakeDb(() => []);
    const repo = createOgcRepository(db);

    expect(() => repo.getCollection("planets")).toThrowError(OgcError);
    try {
      repo.getCollection("planets");
    } catch (error) {
      expect((error as OgcError).code).toBe("NotFound");
    }
  });
});

describe("OgcRepository listFeatures", () => {
  it("applies the default limit of 10 and offset 0", async () => {
    const { db, queries } = createFakeDb((text) =>
      text.includes("COUNT") ? [{ matched: 0 }] : [],
    );
    const repo = createOgcRepository(db);

    await repo.listFeatures("provinces");

    const select = queries.find((q) => q.text.includes("LIMIT"));
    expect(select).toBeDefined();
    expect(select!.params).toContain(10);
    expect(select!.params).toContain(0);
  });

  it("enforces the maximum limit instead of clamping", async () => {
    const { db } = createFakeDb(() => []);
    const repo = createOgcRepository(db);

    await expect(
      repo.listFeatures("provinces", { limit: 1001 }),
    ).rejects.toMatchObject({ code: "InvalidParameterValue" });
  });

  it("rejects an unknown collection id with NotFound", async () => {
    const { db } = createFakeDb(() => []);
    const repo = createOgcRepository(db);

    await expect(repo.listFeatures("moons")).rejects.toMatchObject({
      code: "NotFound",
    });
  });

  it("parameterizes bbox values and never interpolates them into SQL", async () => {
    const { db, queries } = createFakeDb((text) =>
      text.includes("COUNT") ? [{ matched: 1 }] : [PROVINCE_ROW],
    );
    const repo = createOgcRepository(db);

    await repo.listFeatures("provinces", { bbox: [100, -5, 110, 0] });

    const select = queries.find((q) => q.text.includes("LIMIT"))!;
    expect(select.text).toContain("ST_MakeEnvelope($1, $2, $3, $4, 4326)");
    expect(select.text).not.toContain("100");
    expect(select.params.slice(0, 4)).toEqual([100, -5, 110, 0]);

    const count = queries.find((q) => q.text.includes("COUNT"))!;
    expect(count.text).toContain("ST_MakeEnvelope($1, $2, $3, $4, 4326)");
  });

  it("maps rows to GeoJSON features in CRS84", async () => {
    const { db } = createFakeDb((text) =>
      text.includes("COUNT") ? [{ matched: 1 }] : [PROVINCE_ROW],
    );
    const repo = createOgcRepository(db);

    const result = await repo.listFeatures("provinces");

    expect(result.numberMatched).toBe(1);
    expect(result.numberReturned).toBe(1);
    expect(result.features[0]).toEqual({
      type: "Feature",
      id: "31",
      geometry: { type: "MultiPolygon", coordinates: [] },
      properties: { kode_prov: "31", nama_provinsi: "DKI JAKARTA" },
    });
  });

  it("returns an empty result set without error", async () => {
    const { db } = createFakeDb((text) =>
      text.includes("COUNT") ? [{ matched: 0 }] : [],
    );
    const repo = createOgcRepository(db);

    const result = await repo.listFeatures("villages", {
      bbox: [0, 0, 1, 1],
    });

    expect(result.features).toEqual([]);
    expect(result.numberMatched).toBe(0);
    expect(result.numberReturned).toBe(0);
  });

  it("selects only requested properties plus id and name columns", async () => {
    const { db, queries } = createFakeDb((text) =>
      text.includes("COUNT") ? [{ matched: 0 }] : [],
    );
    const repo = createOgcRepository(db);

    await repo.listFeatures("provinces", { properties: ["area_km2"] });

    const select = queries.find((q) => q.text.includes("LIMIT"))!;
    expect(select.text).toContain('"kode_prov"');
    expect(select.text).toContain('"nama_provinsi"');
    expect(select.text).toContain('"area_km2"');
    expect(select.text).not.toContain('"jumlah_penduduk"');
  });

  it("rejects a requested property outside the fixed catalog", async () => {
    const { db } = createFakeDb(() => []);
    const repo = createOgcRepository(db);

    await expect(
      repo.listFeatures("provinces", { properties: ["password; DROP TABLE provinsi"] }),
    ).rejects.toMatchObject({ code: "InvalidParameterValue" });
  });

  it("sanitizes database failures", async () => {
    const repo = createOgcRepository(
      createThrowingDb("connection refused 10.0.0.5:5432 password=hunter2"),
    );

    try {
      await repo.listFeatures("provinces");
      expect.unreachable("expected an OgcError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(OgcError);
      const ogcError = error as OgcError;
      expect(ogcError.code).toBe("NoApplicableCode");
      expect(ogcError.message).not.toContain("hunter2");
      expect(ogcError.message).not.toContain("10.0.0.5");
      expect(ogcError.message).not.toContain("connection refused");
    }
  });
});

describe("OgcRepository getFeature", () => {
  it("returns a single feature with the feature id passed as a parameter", async () => {
    const { db, queries } = createFakeDb(() => [PROVINCE_ROW]);
    const repo = createOgcRepository(db);

    const feature = await repo.getFeature("provinces", "31");

    expect(feature.id).toBe("31");
    expect(feature.properties.nama_provinsi).toBe("DKI JAKARTA");
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain('"kode_prov" = $1');
    expect(queries[0].text).not.toContain("'31'");
    expect(queries[0].params).toEqual(["31"]);
  });

  it("rejects an unknown collection id with NotFound", async () => {
    const { db } = createFakeDb(() => []);
    const repo = createOgcRepository(db);

    await expect(repo.getFeature("moons", "1")).rejects.toMatchObject({
      code: "NotFound",
    });
  });

  it("returns NotFound when the feature does not exist", async () => {
    const { db } = createFakeDb(() => []);
    const repo = createOgcRepository(db);

    await expect(repo.getFeature("provinces", "99")).rejects.toMatchObject({
      code: "NotFound",
    });
  });

  it("sanitizes database failures", async () => {
    const repo = createOgcRepository(
      createThrowingDb('relation "provinsi" does not exist'),
    );

    try {
      await repo.getFeature("provinces", "31");
      expect.unreachable("expected an OgcError to be thrown");
    } catch (error) {
      const ogcError = error as OgcError;
      expect(ogcError.code).toBe("NoApplicableCode");
      expect(ogcError.message).not.toContain("provinsi");
    }
  });
});
