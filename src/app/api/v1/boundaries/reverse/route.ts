import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { validateLat, validateLng } from "@/lib/validation";

const VALID_LEVELS = ["province", "regency", "district", "village"] as const;
type Level = (typeof VALID_LEVELS)[number];

/**
 * GET /api/v1/boundaries/reverse?lat=-6.2088&lng=106.8456
 * GET /api/v1/boundaries/reverse?lat=-6.2088&lng=106.8456&level=district
 *
 * Reverse geocode: coordinate → administrative area hierarchy.
 * Uses ST_Contains with GIST index for fast spatial lookup.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const latStr = searchParams.get("lat");
    const lngStr = searchParams.get("lng");
    const level = searchParams.get("level") as Level | null;

    if (!latStr || !lngStr) {
      return apiError(
        { code: "MISSING_PARAM", message: "lat and lng query parameters are required" },
        400
      );
    }

    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    const latErr = validateLat(lat);
    if (latErr) {
      return apiError({ code: "INVALID_PARAM", message: latErr }, 400);
    }

    const lngErr = validateLng(lng);
    if (lngErr) {
      return apiError({ code: "INVALID_PARAM", message: lngErr }, 400);
    }

    if (level && !VALID_LEVELS.includes(level)) {
      return apiError(
        { code: "INVALID_LEVEL", message: `level must be one of: ${VALID_LEVELS.join(", ")}` },
        400
      );
    }

    const sql = getDb();
    const point = `POINT(${lng} ${lat})`;

    const result: Record<string, unknown> = { lat, lng };

    // Province lookup
    if (!level || level === "province" || level === "regency" || level === "district" || level === "village") {
      const rows = await sql`
        SELECT kode_prov, nama_provinsi
        FROM provinsi
        WHERE ST_Contains(geom, ST_GeomFromText(${point}, 4326))
        LIMIT 1
      `;
      result.provinsi = rows.length > 0 ? rows[0] : null;
    }

    // Regency lookup
    if (!level || level === "regency" || level === "district" || level === "village") {
      const rows = await sql`
        SELECT kode_kab, kode_prov, nama_kabupaten, tipe
        FROM kabupaten
        WHERE ST_Contains(geom, ST_GeomFromText(${point}, 4326))
        LIMIT 1
      `;
      result.kabupaten = rows.length > 0 ? rows[0] : null;
    }

    // District lookup
    if (!level || level === "district" || level === "village") {
      const rows = await sql`
        SELECT kode_kec, kode_kab, nama_kecamatan
        FROM kecamatan
        WHERE ST_Contains(geom, ST_GeomFromText(${point}, 4326))
        LIMIT 1
      `;
      result.kecamatan = rows.length > 0 ? rows[0] : null;
    }

    // Village lookup (most detailed)
    if (!level || level === "village") {
      const rows = await sql`
        SELECT
          d.kode_desa, d.kode_kec, d.nama_desa, d.tipe,
          pc.kode_pos
        FROM desa d
        LEFT JOIN postal_code pc ON d.kode_desa = pc.kode_desa
        WHERE ST_Contains(d.geom, ST_GeomFromText(${point}, 4326))
        LIMIT 1
      `;
      result.desa = rows.length > 0 ? rows[0] : null;
    }

    return apiSuccess(result);
  } catch (error) {
    console.error("GET /api/v1/boundaries/reverse error:", error);
    return apiServerError();
  }
}
