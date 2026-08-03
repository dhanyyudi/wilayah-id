/**
 * OGC API Features feature listing (FeatureCollection).
 * GET /api/v1/ogc/features/collections/{collectionId}/items
 *
 * Supported query parameters: bbox, limit (default 10, max 1000), offset,
 * properties, crs (CRS84 only), and f for content negotiation. Any other
 * parameter is rejected with InvalidParameterValue.
 */

import { NextRequest } from "next/server";
import { parseFeatureQuery } from "@/lib/ogc/params";
import type { GeoJsonFeature } from "@/lib/ogc/repository";
import {
  FEATURES_CACHE,
  escapeHtml,
  featuresAbsoluteUrl,
  getOgcRepository,
  htmlResponse,
  negotiate,
  ogcErrorResponse,
  ogcJson,
  pagingLinks,
  stripProtocolParams,
} from "../../../shared";

export const dynamic = "force-dynamic";

function featuresToHtml(
  collectionId: string,
  nameColumn: string,
  features: GeoJsonFeature[],
): string {
  if (features.length === 0) {
    return "<p>No features in this page.</p>";
  }
  const items = features
    .map((feature) => {
      const href = featuresAbsoluteUrl(
        `/collections/${collectionId}/items/${encodeURIComponent(feature.id)}`,
      );
      const label =
        String(feature.properties[nameColumn] ?? feature.id) || feature.id;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
    })
    .join("\n");
  return `<ul>\n${items}\n</ul>`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  try {
    const { collectionId } = await params;
    const repository = getOgcRepository();
    const definition = repository.getCollection(collectionId);
    const representation = negotiate(request);

    const url = new URL(request.url);
    const query = parseFeatureQuery(stripProtocolParams(url.searchParams));

    const result = await repository.listFeatures(definition.id, query);
    const links = pagingLinks(
      request,
      `/collections/${definition.id}/items`,
      query.limit,
      query.offset,
      result.numberMatched,
    );

    if (representation === "html") {
      const nav = links
        .filter((link) => link.rel === "prev" || link.rel === "next")
        .map(
          (link) =>
            `<li><a href="${escapeHtml(link.href)}" rel="${link.rel}">${link.rel}</a></li>`,
        )
        .join("\n");
      return htmlResponse(
        `${definition.title} features`,
        `<h1>${escapeHtml(definition.title)}</h1>\n` +
          `<p>Showing ${result.numberReturned} of ${result.numberMatched} matching features.</p>\n` +
          featuresToHtml(definition.id, definition.nameColumn, result.features) +
          (nav ? `<nav aria-label="Pagination">\n<ul>\n${nav}\n</ul>\n</nav>` : ""),
        FEATURES_CACHE,
      );
    }

    return ogcJson(
      {
        type: "FeatureCollection",
        features: result.features,
        numberMatched: result.numberMatched,
        numberReturned: result.numberReturned,
        timeStamp: new Date().toISOString(),
        links,
      },
      { contentType: "application/geo+json", cache: FEATURES_CACHE },
    );
  } catch (error) {
    return ogcErrorResponse(error);
  }
}
