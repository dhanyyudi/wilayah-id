/**
 * OGC API Features OpenAPI service description.
 * GET /api/v1/ogc/features/api
 *
 * Serves the static openapi.json artifact kept in this directory.
 */

import { NextRequest } from "next/server";
import openapiDocument from "@/app/api/v1/ogc/features/openapi.json";
import {
  featuresAbsoluteUrl,
  htmlResponse,
  negotiate,
  ogcErrorResponse,
  ogcJson,
} from "../shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const representation = negotiate(request);
    if (representation === "html") {
      const jsonHref = featuresAbsoluteUrl("/api");
      return htmlResponse(
        "API documentation",
        `<h1>API documentation</h1>\n<p>The OpenAPI 3.0 description of this service is available as <a href="${jsonHref}">JSON</a>.</p>`,
      );
    }
    return ogcJson(openapiDocument, {
      contentType: "application/vnd.oai.openapi+json;version=3.0",
    });
  } catch (error) {
    return ogcErrorResponse(error);
  }
}
