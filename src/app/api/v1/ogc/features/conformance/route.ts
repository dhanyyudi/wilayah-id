/**
 * OGC API Features conformance declaration.
 * GET /api/v1/ogc/features/conformance
 *
 * Only conformance classes actually implemented by this service are listed.
 */

import { NextRequest } from "next/server";
import {
  escapeHtml,
  htmlResponse,
  negotiate,
  ogcErrorResponse,
  ogcJson,
} from "../shared";

export const dynamic = "force-dynamic";

const CONFORMS_TO = [
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core",
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30",
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/html",
  "http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson",
];

export async function GET(request: NextRequest) {
  try {
    const representation = negotiate(request);
    if (representation === "html") {
      const items = CONFORMS_TO.map(
        (uri) =>
          `<li><a href="${escapeHtml(uri)}"><code>${escapeHtml(uri)}</code></a></li>`,
      ).join("\n");
      return htmlResponse(
        "Conformance",
        `<h1>Conformance</h1>\n<p>This service conforms to the following OGC API Features classes.</p>\n<ul>\n${items}\n</ul>`,
      );
    }
    return ogcJson({ conformsTo: CONFORMS_TO });
  } catch (error) {
    return ogcErrorResponse(error);
  }
}
