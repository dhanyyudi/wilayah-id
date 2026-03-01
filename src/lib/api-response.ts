import { NextResponse } from "next/server";

interface ApiMeta {
  total?: number;
  source?: string;
  attribution?: string;
  note?: string;
}

interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Standard API success response envelope.
 */
export function apiSuccess<T>(
  data: T,
  meta?: ApiMeta,
  status: number = 200
): NextResponse {
  const body: Record<string, unknown> = { data };
  if (meta) {
    body.meta = meta;
  }

  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "s-maxage=3600, stale-while-revalidate",
    },
  });
}

/**
 * Standard GeoJSON Feature response.
 */
export function apiGeoJSON(geojson: unknown, status: number = 200): NextResponse {
  return NextResponse.json(geojson, {
    status,
    headers: {
      "Content-Type": "application/geo+json",
      "Cache-Control": "s-maxage=3600, stale-while-revalidate",
    },
  });
}

/**
 * Standard API error response envelope.
 */
export function apiError(
  error: ApiError,
  status: number = 400
): NextResponse {
  return NextResponse.json(
    {
      status: "error",
      code: status,
      error,
    },
    { status }
  );
}

/**
 * Standard 404 response.
 */
export function apiNotFound(resource: string): NextResponse {
  return apiError(
    { code: "NOT_FOUND", message: `${resource} not found` },
    404
  );
}

/**
 * Standard 500 response. Never exposes internal details.
 */
export function apiServerError(): NextResponse {
  return apiError(
    { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
    500
  );
}
