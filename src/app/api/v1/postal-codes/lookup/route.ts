import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";

/**
 * GET /api/v1/postal-codes/lookup?q=23773
 * Quick lookup — returns villages matching a postal code.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");

    if (!q || q.trim().length < 3) {
      return apiError(
        { code: "INVALID_QUERY", message: "q must be at least 3 characters" },
        400
      );
    }

    const sql = getDb();

    // Exact match on postal code, or prefix match
    const pattern = `${q.trim()}%`;
    const rows = await sql`
      SELECT
        pc.kode_desa, d.nama_desa, d.tipe AS tipe_desa,
        pc.kode_pos, pc.status, pc.confidence,
        kc.nama_kecamatan,
        kb.nama_kabupaten, kb.tipe AS tipe_kabupaten,
        p.nama_provinsi,
        ST_X(ST_Centroid(d.geom)) as lng, ST_Y(ST_Centroid(d.geom)) as lat
      FROM postal_code pc
      JOIN desa d ON pc.kode_desa = d.kode_desa
      JOIN kecamatan kc ON d.kode_kec = kc.kode_kec
      JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
      JOIN provinsi p ON kb.kode_prov = p.kode_prov
      WHERE pc.kode_pos LIKE ${pattern}
      ORDER BY pc.kode_pos, d.nama_desa
      LIMIT 50
    `;

    return apiSuccess(rows, {
      total: rows.length,
      source: "postal-code-id v2026Q1 (lokabisa-oss)",
    });
  } catch (error) {
    console.error("GET /api/v1/postal-codes/lookup error:", error);
    return apiServerError();
  }
}
