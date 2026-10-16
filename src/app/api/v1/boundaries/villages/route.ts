import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiGeoJSON, apiError, apiServerError } from "@/lib/api-response";
import { featureGeometrySource } from "@/lib/provenance";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/boundaries/villages?district_code=110101
 * GET /api/v1/boundaries/villages?district_code=110101&geometry=true
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const districtCode = searchParams.get("district_code");
    const includeGeom = searchParams.get("geometry") === "true";

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

    if (includeGeom) {
      const rows = await sql`
        SELECT
          d.kode_desa, d.kode_kec, d.nama_desa, d.tipe, d.area_km2,
          d.jumlah_penduduk, d.pulau, d.jangkauan,
          d.status_batas, to_char(d.edisi_geometri, 'YYYY-MM-DD') AS edisi_geometri, d.sumber_geometri,
          ST_AsGeoJSON(d.geom, 5)::json AS geometry
        FROM desa d
        WHERE d.kode_kec = ${districtCode}
        ORDER BY d.kode_desa
      `;

      const features = rows.map((r) => ({
        type: "Feature" as const,
        properties: {
          kode_desa: r.kode_desa,
          kode_kec: r.kode_kec,
          nama_desa: r.nama_desa,
          tipe: r.tipe,
          area_km2: r.area_km2,
          jumlah_penduduk: r.jumlah_penduduk,
          pulau: r.pulau,
          jangkauan: r.jangkauan,
          status_batas: r.status_batas,
          edisi_geometri: r.edisi_geometri,
          source: featureGeometrySource(r.sumber_geometri),
        },
        geometry: r.geometry,
      }));

      return apiGeoJSON({ type: "FeatureCollection", features });
    }

    const rows = await sql`
      SELECT kode_desa, kode_kec, nama_desa, tipe, area_km2,
             jumlah_penduduk, pulau, jangkauan,
             status_batas, to_char(edisi_geometri, 'YYYY-MM-DD') AS edisi_geometri
      FROM desa
      WHERE kode_kec = ${districtCode}
      ORDER BY kode_desa
    `;

    return apiSuccess(rows, { total: rows.length });
  } catch (error) {
    console.error("GET /api/v1/boundaries/villages error:", error);
    return apiServerError();
  }
}
