import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiGeoJSON, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/boundaries/regencies?province_code=11
 * GET /api/v1/boundaries/regencies?province_code=11&geometry=true
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provinceCode = searchParams.get("province_code");
    const includeGeom = searchParams.get("geometry") === "true";

    if (!provinceCode) {
      return apiError(
        { code: "MISSING_PARAM", message: "province_code query parameter is required" },
        400
      );
    }

    const err = validateKode(provinceCode, "provinsi");
    if (err) {
      return apiError({ code: "INVALID_CODE", message: err }, 400);
    }

    const sql = getDb();

    if (includeGeom) {
      const rows = await sql`
        SELECT
          kb.kode_kab, kb.kode_prov, kb.nama_kabupaten, kb.tipe, kb.area_km2,
          p.nama_provinsi,
          ST_AsGeoJSON(kb.geom, 6)::json AS geometry
        FROM kabupaten kb
        JOIN provinsi p ON kb.kode_prov = p.kode_prov
        WHERE kb.kode_prov = ${provinceCode}
        ORDER BY kb.kode_kab
      `;

      const features = rows.map((r) => ({
        type: "Feature" as const,
        properties: {
          kode_kab: r.kode_kab,
          kode_prov: r.kode_prov,
          nama_kabupaten: r.nama_kabupaten,
          tipe: r.tipe,
          nama_provinsi: r.nama_provinsi,
          area_km2: r.area_km2,
        },
        geometry: r.geometry,
      }));

      return apiGeoJSON({ type: "FeatureCollection", features });
    }

    const rows = await sql`
      SELECT kode_kab, kode_prov, nama_kabupaten, tipe, area_km2
      FROM kabupaten
      WHERE kode_prov = ${provinceCode}
      ORDER BY kode_kab
    `;

    return apiSuccess(rows, { total: rows.length });
  } catch (error) {
    console.error("GET /api/v1/boundaries/regencies error:", error);
    return apiServerError();
  }
}
