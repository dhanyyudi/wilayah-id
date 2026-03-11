import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiNotFound, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/regions/regencies/:kode
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kode: string }> }
) {
  try {
    const { kode } = await params;
    const err = validateKode(kode, "kabupaten");
    if (err) {
      return apiError({ code: "INVALID_CODE", message: err }, 400);
    }

    const sql = getDb();
    const rows = await sql`
      SELECT
        kb.kode_kab, kb.kode_prov, kb.nama_kabupaten, kb.tipe,
        kb.jumlah_penduduk, kb.jumlah_kk, kb.kepadatan, kb.luas_wilayah, 
        kb.jumlah_kec, kb.jumlah_desa, kb.jumlah_kel,
        p.nama_provinsi
      FROM kabupaten kb
      JOIN provinsi p ON kb.kode_prov = p.kode_prov
      WHERE kb.kode_kab = ${kode}
    `;

    if (rows.length === 0) {
      return apiNotFound(`Regency with code ${kode}`);
    }

    return apiSuccess(rows[0]);
  } catch (error) {
    console.error("GET /api/v1/regions/regencies/[kode] error:", error);
    return apiServerError();
  }
}
