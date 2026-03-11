import { getDb } from "@/lib/db";
import { apiSuccess, apiServerError } from "@/lib/api-response";

/**
 * GET /api/v1/regions/provinces
 * Returns all 38 provinces sorted by kode_prov.
 */
export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT kode_prov, nama_provinsi, jumlah_penduduk, jumlah_kk, kepadatan, 
             luas_wilayah, jumlah_kab, jumlah_kota, jumlah_kec, jumlah_desa, jumlah_kel
      FROM provinsi
      ORDER BY kode_prov
    `;

    return apiSuccess(rows, {
      total: rows.length,
      source: "wilayah-id v2.0.0 (Dukcapil 2024)",
      attribution: "WebGIS Dukcapil Kemendagri 2024",
    });
  } catch (error) {
    console.error("GET /api/v1/regions/provinces error:", error);
    return apiServerError();
  }
}
