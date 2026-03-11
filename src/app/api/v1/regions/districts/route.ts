import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/regions/districts?regency_code=1101
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const regencyCode = searchParams.get("regency_code");

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
    const rows = await sql`
      SELECT kode_kec, kode_kab, nama_kecamatan,
             jumlah_penduduk, jumlah_kk, kepadatan, luas_wilayah,
             jumlah_desa, jumlah_kel
      FROM kecamatan
      WHERE kode_kab = ${regencyCode}
      ORDER BY kode_kec
    `;

    return apiSuccess(rows, {
      total: rows.length,
      source: "wilayah-id v2.0.0 (Dukcapil 2024)",
    });
  } catch (error) {
    console.error("GET /api/v1/regions/districts error:", error);
    return apiServerError();
  }
}
