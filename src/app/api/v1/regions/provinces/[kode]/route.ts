import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiNotFound, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/regions/provinces/:kode
 * Returns a single province by code.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kode: string }> }
) {
  try {
    const { kode } = await params;
    const err = validateKode(kode, "provinsi");
    if (err) {
      return apiError({ code: "INVALID_CODE", message: err }, 400);
    }

    const sql = getDb();
    const rows = await sql`
      SELECT kode_prov, nama_provinsi, jumlah_penduduk, jumlah_kk, kepadatan, 
             luas_wilayah, jumlah_kab, jumlah_kota, jumlah_kec, jumlah_desa, jumlah_kel
      FROM provinsi
      WHERE kode_prov = ${kode}
    `;

    if (rows.length === 0) {
      return apiNotFound(`Province with code ${kode}`);
    }

    return apiSuccess(rows[0]);
  } catch (error) {
    console.error("GET /api/v1/regions/provinces/[kode] error:", error);
    return apiServerError();
  }
}
