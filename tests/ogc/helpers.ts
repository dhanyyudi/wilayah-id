/**
 * Shared helpers for the OGC integration tests.
 *
 * Every suite is gated on OGC_TEST_DATABASE_URL: without it the describe
 * blocks skip, so `pnpm test` stays green in environments without a
 * disposable PostGIS. The URL must carry the ogc_test schema in its
 * search_path options, for example:
 *
 *   postgresql://postgres:postgres@127.0.0.1:5432/wilayah_id_ogc_test?options=-csearch_path%3Dogc_test,public
 *
 * The fixture schema itself is (re)built once per run by
 * tests/ogc/global-setup.ts.
 */

import Ajv from "ajv";
import { XMLValidator } from "fast-xml-parser";
import { NextRequest } from "next/server";
import { beforeAll } from "vitest";

export const OGC_TEST_DATABASE_URL = process.env.OGC_TEST_DATABASE_URL;
export const hasTestDatabase = Boolean(OGC_TEST_DATABASE_URL);

/**
 * Points the application database layer (src/lib/db) at the disposable
 * fixture database. Must run before the first route handler call; the pg
 * pool is created lazily from DATABASE_URL on first use.
 */
export function useFixtureDatabase(): void {
  beforeAll(() => {
    if (!OGC_TEST_DATABASE_URL) {
      return;
    }
    process.env.DATABASE_URL = OGC_TEST_DATABASE_URL;
  });
}

export function req(url: string): NextRequest {
  return new NextRequest(url);
}

const ajv = new Ajv({ allErrors: true });

/** Minimal GeoJSON FeatureCollection shape used by every feature stream. */
export const featureCollectionSchema = {
  type: "object",
  required: ["type", "features", "numberMatched", "numberReturned"],
  properties: {
    type: { const: "FeatureCollection" },
    numberMatched: { type: "integer", minimum: 0 },
    numberReturned: { type: "integer", minimum: 0 },
    features: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "geometry", "properties"],
        properties: {
          type: { const: "Feature" },
          id: { type: "string" },
          geometry: { type: "object" },
          properties: { type: "object" },
        },
      },
    },
  },
} as const;

export function assertFeatureCollection(body: unknown): void {
  const validate = ajv.compile(featureCollectionSchema);
  if (!validate(body)) {
    throw new Error(
      `Response is not a valid bounded FeatureCollection: ${ajv.errorsText(validate.errors)}`,
    );
  }
}

/** Standards-shaped OGC exception documents (JSON and XML variants). */
export function assertJsonException(
  body: unknown,
  expectedCode: string,
): void {
  const exception = body as { code?: string };
  if (exception.code !== expectedCode) {
    throw new Error(
      `Expected JSON exception code "${expectedCode}", got ${JSON.stringify(body)}`,
    );
  }
}

export function assertXmlWellFormed(xml: string): void {
  const result = XMLValidator.validate(xml);
  if (result !== true) {
    throw new Error(
      `Response is not well-formed XML: ${result.err.msg} (line ${result.err.line})`,
    );
  }
}

export function assertXmlException(
  xml: string,
  expectedCode: string,
): void {
  assertXmlWellFormed(xml);
  if (
    !xml.includes("ExceptionReport") &&
    !xml.includes("ServiceExceptionReport")
  ) {
    throw new Error(`Expected an exception report, got: ${xml.slice(0, 300)}`);
  }
  if (!xml.includes(expectedCode)) {
    throw new Error(
      `Expected exception code "${expectedCode}" in: ${xml.slice(0, 500)}`,
    );
  }
}
