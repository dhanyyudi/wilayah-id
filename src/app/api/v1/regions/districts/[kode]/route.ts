import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiNotFound, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/regions/districts/:kode
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kode: string }> }
) {
  try {
    const { kode } = await params;
    const err = validateKode(kode, "kecamatan");
    if (err) {
      return apiError({ code: "INVALID_CODE", message: err }, 400);
    }

    const sql = getDb();
    const rows = await sql`
      SELECT
        kc.kode_kec, kc.kode_kab, kc.nama_kecamatan,
        kc.jumlah_penduduk, kc.jumlah_kk, kc.kepadatan, kc.luas_wilayah,
        kc.jumlah_desa, kc.jumlah_kel,
        kb.nama_kabupaten, kb.tipe AS tipe_kabupaten,
        p.kode_prov, p.nama_provinsi
      FROM kecamatan kc
      JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
      JOIN provinsi p ON kb.kode_prov = p.kode_prov
      WHERE kc.kode_kec = ${kode}
    `;

    if (rows.length === 0) {
      return apiNotFound(`District with code ${kode}`);
    }

    return apiSuccess(rows[0]);
  } catch (error) {
    console.error("GET /api/v1/regions/districts/[kode] error:", error);
    return apiServerError();
  }
}
