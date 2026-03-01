import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiGeoJSON, apiServerError } from "@/lib/api-response";

/**
 * GET /api/v1/boundaries/provinces
 * GET /api/v1/boundaries/provinces?geometry=true
 *
 * Returns all provinces. Geometry excluded by default.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeGeom = searchParams.get("geometry") === "true";

    const sql = getDb();

    if (includeGeom) {
      const rows = await sql`
        SELECT
          kode_prov, nama_provinsi, area_km2,
          ST_AsGeoJSON(geom, 6)::json AS geometry
        FROM provinsi
        ORDER BY kode_prov
      `;

      const features = rows.map((r) => ({
        type: "Feature" as const,
        properties: {
          kode_prov: r.kode_prov,
          nama_provinsi: r.nama_provinsi,
          area_km2: r.area_km2,
          source: "BIG via batas-administrasi-indonesia",
        },
        geometry: r.geometry,
      }));

      return apiGeoJSON({
        type: "FeatureCollection",
        features,
      });
    }

    const rows = await sql`
      SELECT kode_prov, nama_provinsi, area_km2
      FROM provinsi
      ORDER BY kode_prov
    `;

    return apiSuccess(rows, {
      total: rows.length,
      source: "BIG via batas-administrasi-indonesia",
    });
  } catch (error) {
    console.error("GET /api/v1/boundaries/provinces error:", error);
    return apiServerError();
  }
}
