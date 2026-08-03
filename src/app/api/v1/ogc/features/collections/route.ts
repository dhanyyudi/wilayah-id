/**
 * OGC API Features collection listing.
 * GET /api/v1/ogc/features/collections
 */

import { NextRequest } from "next/server";
import {
  escapeHtml,
  featuresAbsoluteUrl,
  getOgcRepository,
  htmlResponse,
  negotiate,
  ogcErrorResponse,
  ogcJson,
  toCollectionMetadata,
  type OgcLink,
} from "../shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const representation = negotiate(request);
    const repository = getOgcRepository();
    const collections = repository
      .listCollections()
      .map((definition) => toCollectionMetadata(definition));

    if (representation === "html") {
      const items = collections
        .map((collection) => {
          const id = String(collection.id);
          const title = String(collection.title);
          const href = featuresAbsoluteUrl(`/collections/${id}`);
          return `<li><a href="${escapeHtml(href)}">${escapeHtml(title)}</a> (<code>${escapeHtml(id)}</code>)</li>`;
        })
        .join("\n");
      return htmlResponse(
        "Collections",
        `<h1>Collections</h1>\n<ul>\n${items}\n</ul>`,
      );
    }

    const links: OgcLink[] = [
      {
        rel: "self",
        type: "application/json",
        href: featuresAbsoluteUrl("/collections"),
      },
      {
        rel: "alternate",
        type: "text/html",
        href: featuresAbsoluteUrl(
          "/collections",
          new URLSearchParams({ f: "html" }),
        ),
      },
    ];
    return ogcJson({ links, collections });
  } catch (error) {
    return ogcErrorResponse(error);
  }
}
