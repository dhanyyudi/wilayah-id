/**
 * Shared helpers for the OGC API Features route handlers.
 *
 * Content negotiation, link building, error mapping, and minimal accessible
 * HTML rendering live here so each route handler stays a thin adapter over
 * the shared OGC domain layer in `src/lib/ogc`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAbsolutePublicUrl } from "@/lib/public-config";
import type { CollectionDefinition } from "@/lib/ogc/catalog";
import { OgcError, isOgcError } from "@/lib/ogc/errors";
import { createOgcRepository, type OgcRepository } from "@/lib/ogc/repository";

/** Cache policy mandated for feature reads. */
export const FEATURES_CACHE = "public, max-age=60, stale-while-revalidate=300";
/** Cache policy for metadata resources (landing, conformance, collections). */
export const METADATA_CACHE = "public, max-age=3600";

const FEATURES_BASE_PATH = "/api/v1/ogc/features";
const CRS84_URI = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
const STORAGE_CRS_URI = "http://www.opengis.net/def/crs/EPSG/0/4326";
/** National extent of the Indonesian administrative dataset, in CRS84. */
const DATASET_BBOX: [number, number, number, number] = [95.0, -11.0, 141.0, 6.0];

export interface OgcLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}

let repository: OgcRepository | undefined;

/** Lazily created shared repository; replaced by tests via module mock. */
export function getOgcRepository(): OgcRepository {
  repository ??= createOgcRepository();
  return repository;
}

export type Representation = "json" | "geojson" | "html";

/**
 * Resolves the requested representation. The `f` query parameter wins over
 * the Accept header; unknown values are rejected, never ignored.
 */
export function negotiate(request: NextRequest): Representation {
  const url = new URL(request.url);
  const f = url.searchParams.get("f");
  if (f !== null) {
    const normalized = f.toLowerCase();
    if (normalized === "json") return "json";
    if (normalized === "geojson") return "geojson";
    if (normalized === "html") return "html";
    throw new OgcError(
      "InvalidParameterValue",
      `Unsupported f value "${f}"; supported values are json, geojson, html`,
      { locator: "f" },
    );
  }
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html")) return "html";
  if (accept.includes("application/geo+json")) return "geojson";
  return "json";
}

/**
 * Removes protocol-level parameters handled by the route (currently `f`)
 * so the shared query parser never sees parameters outside its vocabulary.
 */
export function stripProtocolParams(
  searchParams: URLSearchParams,
): URLSearchParams {
  const cleaned = new URLSearchParams(searchParams);
  cleaned.delete("f");
  return cleaned;
}

/** Builds an absolute URL under the OGC API Features base path. */
export function featuresAbsoluteUrl(
  path: string,
  params?: URLSearchParams,
): string {
  const base = getAbsolutePublicUrl(`${FEATURES_BASE_PATH}${path}`);
  if (!params || params.size === 0) {
    return base;
  }
  return `${base}?${params.toString()}`;
}

/**
 * RFC 8288 web links for a paginated feature response: self, HTML
 * alternate, and prev/next where applicable.
 */
export function pagingLinks(
  request: NextRequest,
  path: string,
  limit: number,
  offset: number,
  numberMatched: number,
): OgcLink[] {
  const url = new URL(request.url);
  const params = stripProtocolParams(url.searchParams);
  const links: OgcLink[] = [
    {
      rel: "self",
      type: "application/geo+json",
      href: featuresAbsoluteUrl(path, params),
    },
  ];

  const htmlParams = new URLSearchParams(params);
  htmlParams.set("f", "html");
  links.push({
    rel: "alternate",
    type: "text/html",
    href: featuresAbsoluteUrl(path, htmlParams),
  });

  if (offset > 0) {
    const prevParams = new URLSearchParams(params);
    prevParams.set("offset", String(Math.max(0, offset - limit)));
    links.push({
      rel: "prev",
      type: "application/geo+json",
      href: featuresAbsoluteUrl(path, prevParams),
    });
  }
  if (offset + limit < numberMatched) {
    const nextParams = new URLSearchParams(params);
    nextParams.set("offset", String(offset + limit));
    links.push({
      rel: "next",
      type: "application/geo+json",
      href: featuresAbsoluteUrl(path, nextParams),
    });
  }
  return links;
}

/** Collection metadata shared by the collections listing and detail routes. */
export function toCollectionMetadata(
  definition: CollectionDefinition,
): Record<string, unknown> {
  return {
    id: definition.id,
    title: definition.title,
    description: `Indonesian administrative boundaries: ${definition.title}.`,
    itemType: "feature",
    crs: [CRS84_URI],
    storageCrs: STORAGE_CRS_URI,
    extent: {
      spatial: {
        bbox: [DATASET_BBOX],
        crs: CRS84_URI,
      },
    },
    links: [
      {
        rel: "self",
        type: "application/json",
        href: featuresAbsoluteUrl(`/collections/${definition.id}`),
      },
      {
        rel: "alternate",
        type: "text/html",
        href: featuresAbsoluteUrl(
          `/collections/${definition.id}`,
          new URLSearchParams({ f: "html" }),
        ),
      },
      {
        rel: "items",
        type: "application/geo+json",
        href: featuresAbsoluteUrl(`/collections/${definition.id}/items`),
      },
    ],
  };
}

/** JSON response with the shared cache policy. */
export function ogcJson(
  body: unknown,
  options?: { status?: number; cache?: string; contentType?: string },
): NextResponse {
  return NextResponse.json(body, {
    status: options?.status ?? 200,
    headers: {
      ...(options?.contentType
        ? { "Content-Type": options.contentType }
        : {}),
      "Cache-Control": options?.cache ?? METADATA_CACHE,
    },
  });
}

/**
 * Maps any thrown error to a standards-shaped OGC exception document.
 * Non-OGC errors are logged server-side and surfaced as a generic
 * NoApplicableCode error so database details never leak.
 */
export function ogcErrorResponse(error: unknown): NextResponse {
  if (isOgcError(error)) {
    return NextResponse.json(
      {
        code: error.code,
        description: error.message,
        ...(error.locator ? { locator: error.locator } : {}),
      },
      { status: error.httpStatus },
    );
  }
  console.error("OGC API Features unexpected error:", error);
  return NextResponse.json(
    {
      code: "NoApplicableCode",
      description: "The server could not complete the request",
    },
    { status: 500 },
  );
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Minimal accessible HTML document shell (server-rendered, no JS). */
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

export function htmlResponse(
  title: string,
  body: string,
  cache: string = METADATA_CACHE,
): NextResponse {
  return new NextResponse(htmlDocument(title, body), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cache,
    },
  });
}

/** Renders RFC 8288 links as a navigable HTML list. */
export function linksToHtml(links: OgcLink[]): string {
  const items = links
    .map(
      (link) =>
        `<li><a href="${escapeHtml(link.href)}" rel="${escapeHtml(link.rel)}">${escapeHtml(link.title ?? link.rel)}</a></li>`,
    )
    .join("\n");
  return `<nav aria-label="Resource links">\n<ul>\n${items}\n</ul>\n</nav>`;
}
