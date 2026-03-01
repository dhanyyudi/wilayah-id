import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiGeoJSON, apiNotFound, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/boundaries/districts/:kode
 * GET /api/v1/boundaries/districts/:kode?geometry=true
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

    const { searchParams } = new URL(request.url);
    const includeGeom = searchParams.get("geometry") === "true";

    const sql = getDb();

    if (includeGeom) {
      const rows = await sql`
        SELECT
          kc.kode_kec, kc.kode_kab, kc.nama_kecamatan, kc.area_km2,
          kb.nama_kabupaten, p.kode_prov, p.nama_provinsi,
          ST_AsGeoJSON(kc.geom, 6)::json AS geometry
        FROM kecamatan kc
        JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
        JOIN provinsi p ON kb.kode_prov = p.kode_prov
        WHERE kc.kode_kec = ${kode}
      `;

      if (rows.length === 0) {
        return apiNotFound(`District boundary with code ${kode}`);
      }

      const r = rows[0];
      return apiGeoJSON({
        type: "Feature",
        properties: {
          kode_kec: r.kode_kec,
          kode_kab: r.kode_kab,
          nama_kecamatan: r.nama_kecamatan,
          nama_kabupaten: r.nama_kabupaten,
          kode_prov: r.kode_prov,
          nama_provinsi: r.nama_provinsi,
          area_km2: r.area_km2,
        },
        geometry: r.geometry,
      });
    }

    const rows = await sql`
      SELECT
        kc.kode_kec, kc.kode_kab, kc.nama_kecamatan, kc.area_km2,
        kb.nama_kabupaten, p.kode_prov, p.nama_provinsi
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
    console.error("GET /api/v1/boundaries/districts/[kode] error:", error);
    return apiServerError();
  }
}
