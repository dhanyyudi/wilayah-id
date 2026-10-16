/**
 * Village routes return the BIG boundary attributes `status_batas` and
 * `edisi_geometri`. The database is mocked; each test checks the SQL the
 * route sends and the fields it passes through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as regionVillagesGET } from "./regions/villages/route";
import { GET as regionVillageGET } from "./regions/villages/[kode]/route";
import { GET as boundaryVillagesGET } from "./boundaries/villages/route";
import { GET as boundaryVillageGET } from "./boundaries/villages/[kode]/route";
import { GET as reverseGET } from "./boundaries/reverse/route";

const db = vi.hoisted(() => ({
  queries: [] as string[],
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  getDb: () =>
    Object.assign(
      async (strings: TemplateStringsArray) => {
        db.queries.push(strings.join("$"));
        return db.rows;
      },
      { query: async () => db.rows },
    ),
}));

const VILLAGE = {
  kode_desa: "3273011001",
  kode_kec: "327301",
  nama_desa: "Sukaluyu",
  tipe: "KELURAHAN",
  status_batas: "Batas Indikatif",
  edisi_geometri: "2026-06-12",
  sumber_geometri: "BIG BATASWILAYAH 2026-06-12",
  geometry: { type: "MultiPolygon", coordinates: [] },
};

const BASE = "http://localhost/api/v1";
const req = (path: string) => new NextRequest(`${BASE}${path}`);
const params = (kode: string) => ({ params: Promise.resolve({ kode }) });

function expectBoundaryColumns(sql: string) {
  expect(sql).toContain("status_batas");
  expect(sql).toContain("to_char(");
  expect(sql).toContain("edisi_geometri, 'YYYY-MM-DD') AS edisi_geometri");
}

beforeEach(() => {
  db.queries = [];
  db.rows = [VILLAGE];
});

describe("village boundary attributes", () => {
  it("lists villages with status and edition", async () => {
    const res = await regionVillagesGET(req("/regions/villages?district_code=327301"));
    expect(res.status).toBe(200);
    expectBoundaryColumns(db.queries[0]);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ status_batas: "Batas Indikatif", edisi_geometri: "2026-06-12" });
    expect(body.meta.source).toContain("BIG BATASWILAYAH 2026-06-12");
    expect(body.meta.snapshot).toBe("big-2026-06-12+kepmendagri-2025+dukcapil-2024-s1");
  });

  it("returns status and edition in the village detail", async () => {
    const res = await regionVillageGET(req("/regions/villages/3273011001"), params("3273011001"));
    expect(res.status).toBe(200);
    expectBoundaryColumns(db.queries[0]);
  });

  it("puts status, edition and per-feature source on boundary features", async () => {
    db.rows = [{ ...VILLAGE, sumber_geometri: "Dukcapil Kemendagri 2024 S1, dipotong dengan coverage BIG" }];
    const res = await boundaryVillagesGET(
      req("/boundaries/villages?district_code=327301&geometry=true"),
    );
    expectBoundaryColumns(db.queries[0]);
    expect(db.queries[0]).toContain("d.sumber_geometri");
    const body = await res.json();
    expect(body.features[0].properties).toMatchObject({
      status_batas: "Batas Indikatif",
      edisi_geometri: "2026-06-12",
      source: "Dukcapil Kemendagri 2024 S1, dipotong dengan coverage BIG",
    });
  });

  it("returns status and edition without geometry", async () => {
    await boundaryVillagesGET(req("/boundaries/villages?district_code=327301"));
    expectBoundaryColumns(db.queries[0]);
  });

  it("returns status, edition and BIG source for a single boundary", async () => {
    const res = await boundaryVillageGET(
      req("/boundaries/villages/3273011001?geometry=true"),
      params("3273011001"),
    );
    expectBoundaryColumns(db.queries[0]);
    const body = await res.json();
    expect(body.properties).toMatchObject({
      status_batas: "Batas Indikatif",
      edisi_geometri: "2026-06-12",
      source: "BIG BATASWILAYAH 2026-06-12",
    });

    db.queries = [];
    await boundaryVillageGET(req("/boundaries/villages/3273011001"), params("3273011001"));
    expectBoundaryColumns(db.queries[0]);
  });

  it("returns status and edition for the reverse-geocoded village", async () => {
    const res = await reverseGET(req("/boundaries/reverse?lat=-6.9&lng=107.6&level=village"));
    expect(res.status).toBe(200);
    expectBoundaryColumns(db.queries[db.queries.length - 1]);
    const body = await res.json();
    expect(body.data.desa).toMatchObject({ status_batas: "Batas Indikatif" });
  });
});
