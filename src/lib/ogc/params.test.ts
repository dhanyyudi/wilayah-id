import { describe, expect, it } from "vitest";
import { OgcError } from "./errors";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseFeatureQuery,
} from "./params";

function expectInvalidParameterValue(fn: () => unknown): void {
  try {
    fn();
    expect.unreachable("expected an OgcError to be thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(OgcError);
    expect((error as OgcError).code).toBe("InvalidParameterValue");
  }
}

describe("parseFeatureQuery", () => {
  it("applies defaults for an empty parameter set", () => {
    const query = parseFeatureQuery({});

    expect(query.limit).toBe(DEFAULT_LIMIT);
    expect(query.limit).toBe(10);
    expect(query.offset).toBe(0);
    expect(query.crs).toBe("CRS84");
    expect(query.bbox).toBeUndefined();
    expect(query.properties).toBeUndefined();
    expect(query.datetime).toBeUndefined();
  });

  it("parses a valid limit", () => {
    expect(parseFeatureQuery({ limit: "25" }).limit).toBe(25);
    expect(parseFeatureQuery({ limit: String(MAX_LIMIT) }).limit).toBe(MAX_LIMIT);
  });

  it.each(["0", "-5", "abc", "10.5", ""])("rejects invalid limit %s", (limit) => {
    expectInvalidParameterValue(() => parseFeatureQuery({ limit }));
  });

  it("rejects a limit above the maximum instead of silently clamping", () => {
    expectInvalidParameterValue(() =>
      parseFeatureQuery({ limit: String(MAX_LIMIT + 1) }),
    );
  });

  it("parses a valid offset and rejects invalid offsets", () => {
    expect(parseFeatureQuery({ offset: "40" }).offset).toBe(40);
    expectInvalidParameterValue(() => parseFeatureQuery({ offset: "-1" }));
    expectInvalidParameterValue(() => parseFeatureQuery({ offset: "1.5" }));
    expectInvalidParameterValue(() => parseFeatureQuery({ offset: "abc" }));
  });

  it("parses a valid bbox", () => {
    const query = parseFeatureQuery({ bbox: "100.5,-5.25,110,0" });
    expect(query.bbox).toEqual([100.5, -5.25, 110, 0]);
  });

  it.each([
    ["too few ordinates", "100,-5,110"],
    ["too many ordinates", "100,-5,110,0,1"],
    ["non-numeric ordinate", "100,-5,west,0"],
    ["minx greater than maxx", "110,-5,100,0"],
    ["miny greater than maxy", "100,0,110,-5"],
    ["longitude out of range", "190,-5,200,0"],
    ["latitude out of range", "100,-95,110,0"],
  ])("rejects an invalid bbox: %s", (_label, bbox) => {
    expectInvalidParameterValue(() => parseFeatureQuery({ bbox }));
  });

  it("rejects temporal filtering because source data has no temporal field", () => {
    expectInvalidParameterValue(() =>
      parseFeatureQuery({ datetime: "2024-01-01T00:00:00Z" }),
    );
    expectInvalidParameterValue(() =>
      parseFeatureQuery({ datetime: "2024-01-01T00:00:00Z/2024-12-31T23:59:59Z" }),
    );
  });

  it.each(["CRS84", "OGC:CRS84", "urn:ogc:def:crs:OGC:1.3:CRS84", "http://www.opengis.net/def/crs/OGC/1.3/CRS84"])(
    "accepts CRS84 spelled as %s",
    (crs) => {
      expect(parseFeatureQuery({ crs }).crs).toBe("CRS84");
    },
  );

  it.each(["EPSG:4326", "EPSG:3857", "urn:ogc:def:crs:EPSG::4326"])(
    "rejects unsupported crs %s",
    (crs) => {
      expectInvalidParameterValue(() => parseFeatureQuery({ crs }));
    },
  );

  it("parses a comma-separated properties list", () => {
    const query = parseFeatureQuery({ properties: "kode_prov, area_km2" });
    expect(query.properties).toEqual(["kode_prov", "area_km2"]);
  });

  it.each(["filter", "filter-lang", "sortby", "f", "foo"])(
    "rejects unsupported parameter %s instead of silently ignoring it",
    (key) => {
      expectInvalidParameterValue(() =>
        parseFeatureQuery({ [key]: "anything" }),
      );
    },
  );

  it("accepts URLSearchParams input", () => {
    const params = new URLSearchParams("limit=5&offset=10");
    const query = parseFeatureQuery(params);
    expect(query.limit).toBe(5);
    expect(query.offset).toBe(10);
  });
});
