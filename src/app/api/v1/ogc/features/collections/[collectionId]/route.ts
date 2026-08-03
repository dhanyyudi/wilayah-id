/**
 * OGC API Features collection metadata.
 * GET /api/v1/ogc/features/collections/{collectionId}
 */

import { NextRequest } from "next/server";
import {
  escapeHtml,
  featuresAbsoluteUrl,
  getOgcRepository,
  htmlResponse,
  linksToHtml,
  negotiate,
  ogcErrorResponse,
  ogcJson,
  toCollectionMetadata,
  type OgcLink,
} from "../../shared";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  try {
    const { collectionId } = await params;
    const repository = getOgcRepository();
    const definition = repository.getCollection(collectionId);
    const representation = negotiate(request);
    const metadata = toCollectionMetadata(definition);

    if (representation === "html") {
      const itemsHref = featuresAbsoluteUrl(`/collections/${definition.id}/items`);
      return htmlResponse(
        definition.title,
        `<h1>${escapeHtml(definition.title)}</h1>\n` +
          `<p>${escapeHtml(String(metadata.description))}</p>\n` +
          `<p><a href="${escapeHtml(itemsHref)}">Browse features</a></p>\n` +
          linksToHtml(metadata.links as OgcLink[]),
      );
    }
    return ogcJson(metadata);
  } catch (error) {
    return ogcErrorResponse(error);
  }
}
