import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiGeoJSON, apiNotFound, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/boundaries/provinces/:kode
 * GET /api/v1/boundaries/provinces/:kode?geometry=true
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

    const { searchParams } = new URL(request.url);
    const includeGeom = searchParams.get("geometry") === "true";

    const sql = getDb();

    if (includeGeom) {
      const rows = await sql`
        SELECT
          kode_prov, nama_provinsi, area_km2,
          jumlah_penduduk, jumlah_kk, kepadatan, luas_wilayah, jumlah_kab, jumlah_kota, jumlah_kec, jumlah_desa, jumlah_kel,
          ST_AsGeoJSON(geom, 6)::json AS geometry
        FROM provinsi
        WHERE kode_prov = ${kode}
      `;

      if (rows.length === 0) {
        return apiNotFound(`Province boundary with code ${kode}`);
      }

      const r = rows[0];
      return apiGeoJSON({
        type: "Feature",
        properties: {
          kode_prov: r.kode_prov,
          nama_provinsi: r.nama_provinsi,
          area_km2: r.area_km2,
          jumlah_penduduk: r.jumlah_penduduk,
          jumlah_kk: r.jumlah_kk,
          kepadatan: r.kepadatan,
          luas_wilayah: r.luas_wilayah,
          jumlah_kab: r.jumlah_kab,
          jumlah_kota: r.jumlah_kota,
          jumlah_kec: r.jumlah_kec,
          jumlah_desa: r.jumlah_desa,
          jumlah_kel: r.jumlah_kel,
          source: "Dukcapil 2024 via batas-administrasi-indonesia",
        },
        geometry: r.geometry,
      });
    }

    const rows = await sql`
      SELECT kode_prov, nama_provinsi, area_km2,
             jumlah_penduduk, jumlah_kk, kepadatan, luas_wilayah, jumlah_kab, jumlah_kota, jumlah_kec, jumlah_desa, jumlah_kel
      FROM provinsi
      WHERE kode_prov = ${kode}
    `;

    if (rows.length === 0) {
      return apiNotFound(`Province with code ${kode}`);
    }

    return apiSuccess(rows[0]);
  } catch (error) {
    console.error("GET /api/v1/boundaries/provinces/[kode] error:", error);
    return apiServerError();
  }
}
