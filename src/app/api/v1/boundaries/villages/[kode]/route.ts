import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiGeoJSON, apiNotFound, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/boundaries/villages/:kode
 * GET /api/v1/boundaries/villages/:kode?geometry=true
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

    const { searchParams } = new URL(request.url);
    const includeGeom = searchParams.get("geometry") === "true";

    const sql = getDb();

    if (includeGeom) {
      const rows = await sql`
        SELECT
          d.kode_desa, d.kode_kec, d.nama_desa, d.tipe, d.area_km2,
          d.jumlah_penduduk, d.pulau, d.jangkauan,
          kc.nama_kecamatan, kb.kode_kab, kb.nama_kabupaten,
          p.kode_prov, p.nama_provinsi,
          pc.kode_pos,
          ST_AsGeoJSON(d.geom, 5)::json AS geometry
        FROM desa d
        JOIN kecamatan kc ON d.kode_kec = kc.kode_kec
        JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
        JOIN provinsi p ON kb.kode_prov = p.kode_prov
        LEFT JOIN postal_code pc ON d.kode_desa = pc.kode_desa
        WHERE d.kode_desa = ${kode}
      `;

      if (rows.length === 0) {
        return apiNotFound(`Village boundary with code ${kode}`);
      }

      const r = rows[0];
      return apiGeoJSON({
        type: "Feature",
        properties: {
          kode_desa: r.kode_desa,
          nama_desa: r.nama_desa,
          tipe: r.tipe,
          kode_kec: r.kode_kec,
          nama_kecamatan: r.nama_kecamatan,
          kode_kab: r.kode_kab,
          nama_kabupaten: r.nama_kabupaten,
          kode_prov: r.kode_prov,
          nama_provinsi: r.nama_provinsi,
          kode_pos: r.kode_pos,
          area_km2: r.area_km2,
          jumlah_penduduk: r.jumlah_penduduk,
          pulau: r.pulau,
          jangkauan: r.jangkauan,
          source: "Dukcapil 2024 via batas-administrasi-indonesia",
        },
        geometry: r.geometry,
      });
    }

    const rows = await sql`
      SELECT
        d.kode_desa, d.kode_kec, d.nama_desa, d.tipe, d.area_km2,
        d.jumlah_penduduk, d.pulau, d.jangkauan,
        kc.nama_kecamatan, kb.kode_kab, kb.nama_kabupaten,
        p.kode_prov, p.nama_provinsi,
        pc.kode_pos
      FROM desa d
      JOIN kecamatan kc ON d.kode_kec = kc.kode_kec
      JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
      JOIN provinsi p ON kb.kode_prov = p.kode_prov
      LEFT JOIN postal_code pc ON d.kode_desa = pc.kode_desa
      WHERE d.kode_desa = ${kode}
    `;

    if (rows.length === 0) {
      return apiNotFound(`Village with code ${kode}`);
    }

    return apiSuccess(rows[0]);
  } catch (error) {
    console.error("GET /api/v1/boundaries/villages/[kode] error:", error);
    return apiServerError();
  }
}
