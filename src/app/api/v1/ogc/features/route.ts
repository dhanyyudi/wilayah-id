/**
 * OGC API Features landing page.
 * GET /api/v1/ogc/features
 */

import { NextRequest } from "next/server";
import {
  METADATA_CACHE,
  featuresAbsoluteUrl,
  htmlResponse,
  linksToHtml,
  negotiate,
  ogcErrorResponse,
  ogcJson,
  type OgcLink,
} from "./shared";

export const dynamic = "force-dynamic";

const TITLE = "Wilayah-ID OGC API Features";
const DESCRIPTION =
  "OGC API Features access to Indonesian administrative boundaries " +
  "(provinces, regencies, districts, villages) in CRS84 GeoJSON.";

function landingLinks(): OgcLink[] {
  return [
    {
      rel: "self",
      type: "application/json",
      href: featuresAbsoluteUrl(""),
      title: "This document",
    },
    {
      rel: "alternate",
      type: "text/html",
      href: featuresAbsoluteUrl("", new URLSearchParams({ f: "html" })),
      title: "This document as HTML",
    },
    {
      rel: "service-desc",
      type: "application/vnd.oai.openapi+json;version=3.0",
      href: featuresAbsoluteUrl("/api"),
      title: "OpenAPI 3.0 service description",
    },
    {
      rel: "service-doc",
      type: "text/html",
      href: featuresAbsoluteUrl("/api", new URLSearchParams({ f: "html" })),
      title: "API documentation",
    },
    {
      rel: "conformance",
      type: "application/json",
      href: featuresAbsoluteUrl("/conformance"),
      title: "Conformance classes",
    },
    {
      rel: "data",
      type: "application/json",
      href: featuresAbsoluteUrl("/collections"),
      title: "Feature collections",
    },
  ];
}

export async function GET(request: NextRequest) {
  try {
    const representation = negotiate(request);
    const links = landingLinks();
    if (representation === "html") {
      return htmlResponse(
        TITLE,
        `<h1>${TITLE}</h1>\n<p>${DESCRIPTION}</p>\n${linksToHtml(links)}`,
      );
    }
    return ogcJson(
      { title: TITLE, description: DESCRIPTION, links },
      { cache: METADATA_CACHE },
    );
  } catch (error) {
    return ogcErrorResponse(error);
  }
}
