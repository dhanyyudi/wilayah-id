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
      SELECT kode_prov, nama_provinsi
      FROM provinsi
      ORDER BY kode_prov
    `;

    return apiSuccess(rows, {
      total: rows.length,
      source: "region-id v1.0.1 (lokabisa-oss)",
      attribution: "Kepmendagri 2025",
    });
  } catch (error) {
    console.error("GET /api/v1/regions/provinces error:", error);
    return apiServerError();
  }
}
