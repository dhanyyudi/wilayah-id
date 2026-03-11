import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/regions/regencies
 * Query params: province_code (required)
 *
 * GET /api/v1/regions/regencies?province_code=11
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provinceCode = searchParams.get("province_code");

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
    const rows = await sql`
      SELECT kode_kab, kode_prov, nama_kabupaten, tipe,
             jumlah_penduduk, jumlah_kk, kepadatan, luas_wilayah, 
             jumlah_kec, jumlah_desa, jumlah_kel
      FROM kabupaten
      WHERE kode_prov = ${provinceCode}
      ORDER BY kode_kab
    `;

    return apiSuccess(rows, {
      total: rows.length,
      source: "wilayah-id v2.0.0 (Dukcapil 2024)",
    });
  } catch (error) {
    console.error("GET /api/v1/regions/regencies error:", error);
    return apiServerError();
  }
}
