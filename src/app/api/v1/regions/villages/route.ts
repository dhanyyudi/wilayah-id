import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/regions/villages?district_code=110101
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const districtCode = searchParams.get("district_code");

    if (!districtCode) {
      return apiError(
        { code: "MISSING_PARAM", message: "district_code query parameter is required" },
        400
      );
    }

    const err = validateKode(districtCode, "kecamatan");
    if (err) {
      return apiError({ code: "INVALID_CODE", message: err }, 400);
    }

    const sql = getDb();
    const rows = await sql`
      SELECT kode_desa, kode_kec, nama_desa, tipe
      FROM desa
      WHERE kode_kec = ${districtCode}
      ORDER BY kode_desa
    `;

    return apiSuccess(rows, {
      total: rows.length,
      source: "wilayah-id v2.0.0 (Dukcapil 2024)",
    });
  } catch (error) {
    console.error("GET /api/v1/regions/villages error:", error);
    return apiServerError();
  }
}
