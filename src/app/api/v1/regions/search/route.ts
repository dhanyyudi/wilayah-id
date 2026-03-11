import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { validateSearchQuery } from "@/lib/validation";

const VALID_LEVELS = ["province", "regency", "district", "village"] as const;
type Level = (typeof VALID_LEVELS)[number];

/**
 * GET /api/v1/regions/search?q=bandung&level=regency
 * Search regions by name. Level is optional (defaults to all levels).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const level = searchParams.get("level") as Level | null;
    const limitParam = searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitParam ?? "20", 10) || 20, 1), 100);

    const qErr = validateSearchQuery(q);
    if (qErr) {
      return apiError({ code: "INVALID_QUERY", message: qErr }, 400);
    }

    if (level && !VALID_LEVELS.includes(level)) {
      return apiError(
        { code: "INVALID_LEVEL", message: `level must be one of: ${VALID_LEVELS.join(", ")}` },
        400
      );
    }

    const sql = getDb();
    const searchPattern = `%${q.trim()}%`;
    const results: Array<Record<string, unknown>> = [];

    // Search provinces
    if (!level || level === "province") {
      const rows = await sql`
        SELECT kode_prov AS code, nama_provinsi AS name, 'province' AS level,
          ST_X(ST_Centroid(geom)) as lng, ST_Y(ST_Centroid(geom)) as lat
        FROM provinsi
        WHERE nama_provinsi ILIKE ${searchPattern}
        ORDER BY nama_provinsi
        LIMIT ${limit}
      `;
      results.push(...rows);
    }

    // Search regencies
    if (!level || level === "regency") {
      const rows = await sql`
        SELECT
          kb.kode_kab AS code, kb.nama_kabupaten AS name, 'regency' AS level,
          kb.tipe, p.nama_provinsi,
          ST_X(ST_Centroid(kb.geom)) as lng, ST_Y(ST_Centroid(kb.geom)) as lat
        FROM kabupaten kb
        JOIN provinsi p ON kb.kode_prov = p.kode_prov
        WHERE kb.nama_kabupaten ILIKE ${searchPattern}
        ORDER BY kb.nama_kabupaten
        LIMIT ${limit}
      `;
      results.push(...rows);
    }

    // Search districts
    if (!level || level === "district") {
      const rows = await sql`
        SELECT
          kc.kode_kec AS code, kc.nama_kecamatan AS name, 'district' AS level,
          kb.nama_kabupaten, p.nama_provinsi,
          ST_X(ST_Centroid(kc.geom)) as lng, ST_Y(ST_Centroid(kc.geom)) as lat
        FROM kecamatan kc
        JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
        JOIN provinsi p ON kb.kode_prov = p.kode_prov
        WHERE kc.nama_kecamatan ILIKE ${searchPattern}
        ORDER BY kc.nama_kecamatan
        LIMIT ${limit}
      `;
      results.push(...rows);
    }

    // Search villages
    if (!level || level === "village") {
      const rows = await sql`
        SELECT
          d.kode_desa AS code, d.nama_desa AS name, 'village' AS level,
          d.tipe, kc.nama_kecamatan, kb.nama_kabupaten, p.nama_provinsi,
          ST_X(ST_Centroid(d.geom)) as lng, ST_Y(ST_Centroid(d.geom)) as lat
        FROM desa d
        JOIN kecamatan kc ON d.kode_kec = kc.kode_kec
        JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
        JOIN provinsi p ON kb.kode_prov = p.kode_prov
        WHERE d.nama_desa ILIKE ${searchPattern}
        ORDER BY d.nama_desa
        LIMIT ${limit}
      `;
      results.push(...rows);
    }

    return apiSuccess(results, {
      total: results.length,
      source: "wilayah-id v2.0.0 (Dukcapil 2024)",
    });
  } catch (error) {
    console.error("GET /api/v1/regions/search error:", error);
    return apiServerError();
  }
}
