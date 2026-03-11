import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiNotFound, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/regions/villages/:kode
 * Returns full hierarchy for a single village.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kode: string }> }
) {
  try {
    const { kode } = await params;
    const err = validateKode(kode, "desa");
    if (err) {
      return apiError({ code: "INVALID_CODE", message: err }, 400);
    }

    const sql = getDb();
    const rows = await sql`
      SELECT
        d.kode_desa, d.nama_desa, d.tipe,
        d.jumlah_penduduk, d.pulau, d.jangkauan, d.area_km2,
        kc.kode_kec, kc.nama_kecamatan,
        kb.kode_kab, kb.nama_kabupaten,
        p.kode_prov, p.nama_provinsi
      FROM desa d
      JOIN kecamatan kc ON d.kode_kec = kc.kode_kec
      JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
      JOIN provinsi p ON kb.kode_prov = p.kode_prov
      WHERE d.kode_desa = ${kode}
    `;

    if (rows.length === 0) {
      return apiNotFound(`Village with code ${kode}`);
    }

    return apiSuccess(rows[0]);
  } catch (error) {
    console.error("GET /api/v1/regions/villages/[kode] error:", error);
    return apiServerError();
  }
}
