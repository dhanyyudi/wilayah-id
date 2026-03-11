import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiGeoJSON, apiNotFound, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/boundaries/regencies/:kode
 * GET /api/v1/boundaries/regencies/:kode?geometry=true
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

    const { searchParams } = new URL(request.url);
    const includeGeom = searchParams.get("geometry") === "true";

    const sql = getDb();

    if (includeGeom) {
      const rows = await sql`
        SELECT
          kb.kode_kab, kb.kode_prov, kb.nama_kabupaten, kb.tipe, kb.area_km2,
          kb.jumlah_penduduk, kb.jumlah_kk, kb.kepadatan, kb.luas_wilayah, kb.jumlah_kec, kb.jumlah_desa, kb.jumlah_kel,
          p.nama_provinsi,
          ST_AsGeoJSON(kb.geom, 6)::json AS geometry
        FROM kabupaten kb
        JOIN provinsi p ON kb.kode_prov = p.kode_prov
        WHERE kb.kode_kab = ${kode}
      `;

      if (rows.length === 0) {
        return apiNotFound(`Regency boundary with code ${kode}`);
      }

      const r = rows[0];
      return apiGeoJSON({
        type: "Feature",
        properties: {
          kode_kab: r.kode_kab,
          kode_prov: r.kode_prov,
          nama_kabupaten: r.nama_kabupaten,
          tipe: r.tipe,
          nama_provinsi: r.nama_provinsi,
          area_km2: r.area_km2,
          jumlah_penduduk: r.jumlah_penduduk,
          jumlah_kk: r.jumlah_kk,
          kepadatan: r.kepadatan,
          luas_wilayah: r.luas_wilayah,
          jumlah_kec: r.jumlah_kec,
          jumlah_desa: r.jumlah_desa,
          jumlah_kel: r.jumlah_kel,
          source: "Dukcapil 2024 via batas-administrasi-indonesia",
        },
        geometry: r.geometry,
      });
    }

    const rows = await sql`
      SELECT
        kb.kode_kab, kb.kode_prov, kb.nama_kabupaten, kb.tipe, kb.area_km2,
        kb.jumlah_penduduk, kb.jumlah_kk, kb.kepadatan, kb.luas_wilayah, kb.jumlah_kec, kb.jumlah_desa, kb.jumlah_kel,
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
    console.error("GET /api/v1/boundaries/regencies/[kode] error:", error);
    return apiServerError();
  }
}
