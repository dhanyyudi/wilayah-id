import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { apiSuccess, apiError, apiServerError } from "@/lib/api-response";
import { validateKode } from "@/lib/validation";

/**
 * GET /api/v1/postal-codes?village_code=1101010001
 * GET /api/v1/postal-codes?postal_code=23773
 * GET /api/v1/postal-codes?district_code=110101
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const villageCode = searchParams.get("village_code");
    const postalCode = searchParams.get("postal_code");
    const districtCode = searchParams.get("district_code");

    if (!villageCode && !postalCode && !districtCode) {
      return apiError(
        {
          code: "MISSING_PARAM",
          message: "At least one query parameter is required: village_code, postal_code, or district_code",
        },
        400
      );
    }

    const sql = getDb();

    // Search by village code
    if (villageCode) {
      const err = validateKode(villageCode, "desa");
      if (err) {
        return apiError({ code: "INVALID_CODE", message: err }, 400);
      }

      const rows = await sql`
        SELECT
          pc.kode_desa, d.nama_desa, pc.kode_pos,
          pc.status, pc.confidence
        FROM postal_code pc
        JOIN desa d ON pc.kode_desa = d.kode_desa
        WHERE pc.kode_desa = ${villageCode}
      `;

      return apiSuccess(rows, {
        total: rows.length,
        source: "postal-code-id v2026Q1 (lokabisa-oss)",
        note: "Records marked AUGMENTED are derived, not officially authoritative",
      });
    }

    // Search by postal code
    if (postalCode) {
      if (!/^\d{5}$/.test(postalCode)) {
        return apiError(
          { code: "INVALID_CODE", message: "postal_code must be a 5-digit string" },
          400
        );
      }

      const rows = await sql`
        SELECT
          pc.kode_desa, d.nama_desa, pc.kode_pos,
          pc.status, pc.confidence,
          kc.nama_kecamatan, kb.nama_kabupaten, p.nama_provinsi
        FROM postal_code pc
        JOIN desa d ON pc.kode_desa = d.kode_desa
        JOIN kecamatan kc ON d.kode_kec = kc.kode_kec
        JOIN kabupaten kb ON kc.kode_kab = kb.kode_kab
        JOIN provinsi p ON kb.kode_prov = p.kode_prov
        WHERE pc.kode_pos = ${postalCode}
        ORDER BY d.nama_desa
        LIMIT 100
      `;

      return apiSuccess(rows, {
        total: rows.length,
        source: "postal-code-id v2026Q1 (lokabisa-oss)",
        note: "Records marked AUGMENTED are derived, not officially authoritative",
      });
    }

    // Search by district code
    if (districtCode) {
      const err = validateKode(districtCode, "kecamatan");
      if (err) {
        return apiError({ code: "INVALID_CODE", message: err }, 400);
      }

      const rows = await sql`
        SELECT
          pc.kode_desa, d.nama_desa, pc.kode_pos,
          pc.status, pc.confidence
        FROM postal_code pc
        JOIN desa d ON pc.kode_desa = d.kode_desa
        WHERE d.kode_kec = ${districtCode}
        ORDER BY d.nama_desa
      `;

      return apiSuccess(rows, {
        total: rows.length,
        source: "postal-code-id v2026Q1 (lokabisa-oss)",
        note: "Records marked AUGMENTED are derived, not officially authoritative",
      });
    }

    return apiError({ code: "MISSING_PARAM", message: "No valid query parameter provided" }, 400);
  } catch (error) {
    console.error("GET /api/v1/postal-codes error:", error);
    return apiServerError();
  }
}
