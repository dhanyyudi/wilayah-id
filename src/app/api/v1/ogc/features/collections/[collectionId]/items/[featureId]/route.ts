/**
 * OGC API Features single feature.
 * GET /api/v1/ogc/features/collections/{collectionId}/items/{featureId}
 */

import { NextRequest } from "next/server";
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
} from "../../../../shared";

export const dynamic = "force-dynamic";

function propertiesToHtml(properties: Record<string, unknown>): string {
  const rows = Object.entries(properties)
    .map(
      ([key, value]) =>
        `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(String(value ?? ""))}</td></tr>`,
    )
    .join("\n");
  return `<table>\n<tbody>\n${rows}\n</tbody>\n</table>`;
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ collectionId: string; featureId: string }> },
) {
  try {
    const { collectionId, featureId } = await params;
    const repository = getOgcRepository();
    const definition = repository.getCollection(collectionId);
    const representation = negotiate(request);

    const feature: GeoJsonFeature = await repository.getFeature(
      definition.id,
      featureId,
    );

    if (representation === "html") {
      const label =
        String(feature.properties[definition.nameColumn] ?? feature.id) ||
        feature.id;
      return htmlResponse(
        `${definition.title}: ${label}`,
        `<h1>${escapeHtml(label)}</h1>\n` +
          propertiesToHtml(feature.properties) +
          `<p><a href="${escapeHtml(featuresAbsoluteUrl(`/collections/${definition.id}/items`))}">Back to ${escapeHtml(definition.title)}</a></p>`,
        FEATURES_CACHE,
      );
    }

    return ogcJson(
      {
        ...feature,
        links: [
          {
            rel: "self",
            type: "application/geo+json",
            href: featuresAbsoluteUrl(
              `/collections/${definition.id}/items/${encodeURIComponent(feature.id)}`,
            ),
          },
          {
            rel: "collection",
            type: "application/json",
            href: featuresAbsoluteUrl(`/collections/${definition.id}`),
          },
        ],
      },
      { contentType: "application/geo+json", cache: FEATURES_CACHE },
    );
  } catch (error) {
    return ogcErrorResponse(error);
  }
}
