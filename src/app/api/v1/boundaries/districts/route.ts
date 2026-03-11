import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiGeoJSON, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/boundaries/districts?regency_code=1101
 * GET /api/v1/boundaries/districts?regency_code=1101&geometry=true
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const regencyCode = searchParams.get("regency_code");
    const includeGeom = searchParams.get("geometry") === "true";

    if (!regencyCode) {
      return apiError(
        { code: "MISSING_PARAM", message: "regency_code query parameter is required" },
        400
      );
    }

    const err = validateKode(regencyCode, "kabupaten");
    if (err) {
      return apiError({ code: "INVALID_CODE", message: err }, 400);
    }

    const sql = getDb();

    if (includeGeom) {
      const rows = await sql`
        SELECT
          kc.kode_kec, kc.kode_kab, kc.nama_kecamatan, kc.area_km2,
          kc.jumlah_penduduk, kc.jumlah_kk, kc.kepadatan, kc.luas_wilayah, kc.jumlah_desa, kc.jumlah_kel,
          ST_AsGeoJSON(kc.geom, 6)::json AS geometry
        FROM kecamatan kc
        WHERE kc.kode_kab = ${regencyCode}
        ORDER BY kc.kode_kec
      `;

      const features = rows.map((r) => ({
        type: "Feature" as const,
        properties: {
          kode_kec: r.kode_kec,
          kode_kab: r.kode_kab,
          nama_kecamatan: r.nama_kecamatan,
          area_km2: r.area_km2,
          jumlah_penduduk: r.jumlah_penduduk,
          jumlah_kk: r.jumlah_kk,
          kepadatan: r.kepadatan,
          luas_wilayah: r.luas_wilayah,
          jumlah_desa: r.jumlah_desa,
          jumlah_kel: r.jumlah_kel,
          source: "Dukcapil 2024 via batas-administrasi-indonesia",
        },
        geometry: r.geometry,
      }));

      return apiGeoJSON({ type: "FeatureCollection", features });
    }

    const rows = await sql`
      SELECT kode_kec, kode_kab, nama_kecamatan, area_km2,
             jumlah_penduduk, jumlah_kk, kepadatan, luas_wilayah, jumlah_desa, jumlah_kel
      FROM kecamatan
      WHERE kode_kab = ${regencyCode}
      ORDER BY kode_kec
    `;

    return apiSuccess(rows, { total: rows.length });
  } catch (error) {
    console.error("GET /api/v1/boundaries/districts error:", error);
    return apiServerError();
  }
}
