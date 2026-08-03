/**
 * Route contract tests for the WFS 2.0.0 endpoint.
 *
 * The repository layer is mocked, so no live PostGIS is required. Every
 * response XML body is validated for well-formedness and parsed with
 * fast-xml-parser; GML payloads are additionally checked for the expected
 * feature members and paging counts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  listFeatures: vi.fn(),
  getFeature: vi.fn(),
}));

vi.mock("@/lib/ogc/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ogc/repository")>();
  const real = original.createOgcRepository();
  return {
    ...original,
    createOgcRepository: () => ({
      ...real,
      listFeatures: mocks.listFeatures,
      getFeature: mocks.getFeature,
    }),
  };
});

const FEATURE = {
  type: "Feature",
  id: "31",
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [106.8, -6.2],
          [106.9, -6.2],
          [106.9, -6.1],
          [106.8, -6.1],
          [106.8, -6.2],
        ],
      ],
    ],
  },
  properties: { kode_prov: "31", nama_provinsi: "DKI JAKARTA" },
};

const BASE = "http://localhost/api/v1/ogc/wfs";

function req(path: string): NextRequest {
  return new NextRequest(`${BASE}${path}`);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

interface ParsedXml {
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function parseXml(response: Response): Promise<ParsedXml> {
  const xml = await response.text();
  expect(XMLValidator.validate(xml)).toBe(true);
  return parser.parse(xml);
}

function expectExceptionReport(
  doc: ParsedXml,
  code: string,
  locator?: string,
): void {
  const report = doc["ows:ExceptionReport"];
  expect(report, "response must be an ows:ExceptionReport").toBeTruthy();
  const exception = Array.isArray(report["ows:Exception"])
    ? report["ows:Exception"][0]
    : report["ows:Exception"];
  expect(exception["@_exceptionCode"]).toBe(code);
  if (locator !== undefined) {
    expect(exception["@_locator"]).toBe(locator);
  }
  expect(exception["ows:ExceptionText"]).toBeTruthy();
}

beforeEach(() => {
  mocks.listFeatures.mockReset();
  mocks.getFeature.mockReset();
  mocks.listFeatures.mockResolvedValue({
    features: [FEATURE],
    numberMatched: 25,
    numberReturned: 1,
  });
  mocks.getFeature.mockResolvedValue(FEATURE);
});

describe("WFS GetCapabilities", () => {
  it("returns valid XML advertising only implemented operations", async () => {
    const response = await GET(req("?service=WFS&request=GetCapabilities"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/xml");
    const doc = await parseXml(response);
    const capabilities = doc["wfs:WFS_Capabilities"] ?? doc["WFS_Capabilities"];
    expect(capabilities).toBeTruthy();
    expect(capabilities["@_version"]).toBe("2.0.0");

    const operations = capabilities["ows:OperationsMetadata"]["ows:Operation"];
    const names = (Array.isArray(operations) ? operations : [operations]).map(
      (op: ParsedXml) => op["@_name"],
    );
    expect(names).toEqual([
      "GetCapabilities",
      "DescribeFeatureType",
      "GetFeature",
    ]);
  });

  it("advertises only service version 2.0.0", async () => {
    const response = await GET(req("?service=WFS&request=GetCapabilities"));
    const doc = await parseXml(response);
    const capabilities = doc["wfs:WFS_Capabilities"] ?? doc["WFS_Capabilities"];
    const versions =
      capabilities["ows:ServiceIdentification"]["ows:ServiceTypeVersion"];
    const list = Array.isArray(versions) ? versions : [versions];
    expect(list).toEqual(["2.0.0"]);
  });

  it("lists exactly the four catalog feature types with a CRS84 default", async () => {
    const response = await GET(req("?service=WFS&request=GetCapabilities"));
    const doc = await parseXml(response);
    const capabilities = doc["wfs:WFS_Capabilities"] ?? doc["WFS_Capabilities"];
    const featureTypes = capabilities["FeatureTypeList"]["FeatureType"];
    const list = Array.isArray(featureTypes) ? featureTypes : [featureTypes];
    expect(list.map((ft: ParsedXml) => ft.Name)).toEqual([
      "provinces",
      "regencies",
      "districts",
      "villages",
    ]);
    for (const ft of list) {
      expect(String(ft.DefaultCRS)).toContain("CRS84");
    }
  });

  it("advertises only the output formats actually implemented", async () => {
    const response = await GET(req("?service=WFS&request=GetCapabilities"));
    const xml = await response.text();
    expect(xml).toContain("application/gml+xml; version=3.2");
    expect(xml).toContain("application/geo+json");
    // No unimplemented formats may be promised.
    expect(xml).not.toContain("shape");
    expect(xml).not.toContain("KML");
    expect(xml).not.toContain("CSV");
  });

  it("advertises the bounded paging constraints", async () => {
    const response = await GET(req("?service=WFS&request=GetCapabilities"));
    const doc = await parseXml(response);
    const capabilities = doc["wfs:WFS_Capabilities"] ?? doc["WFS_Capabilities"];
    const constraints =
      capabilities["ows:OperationsMetadata"]["ows:Constraint"];
    const list = Array.isArray(constraints) ? constraints : [constraints];
    const byName = Object.fromEntries(
      list.map((c: ParsedXml) => [c["@_name"], c]),
    );
    expect(String(byName.CountDefault["ows:AllowedValues"]["ows:Value"])).toBe(
      "10",
    );
    expect(String(byName.CountMaximum["ows:AllowedValues"]["ows:Value"])).toBe(
      "1000",
    );
    expect(
      String(byName.ImplementsResultPaging["ows:AllowedValues"]["ows:Value"]),
    ).toBe("TRUE");
  });
});

describe("WFS DescribeFeatureType", () => {
  it("returns an XML Schema document, not JSON", async () => {
    const response = await GET(
      req("?service=WFS&version=2.0.0&request=DescribeFeatureType&typename=provinces"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    const doc = await parseXml(response);
    const schema = doc["xs:schema"];
    expect(schema, "DescribeFeatureType must return XSD").toBeTruthy();
    expect(schema["@_targetNamespace"]).toBe("http://wilayah.id/wfs");
  });

  it("declares every advertised property with truthful types", async () => {
    const response = await GET(
      req("?service=WFS&request=DescribeFeatureType&typename=provinces"),
    );
    const doc = await parseXml(response);
    const schema = doc["xs:schema"];
    const complexTypes = Array.isArray(schema["xs:complexType"])
      ? schema["xs:complexType"]
      : [schema["xs:complexType"]];
    const featureType = complexTypes.find(
      (ct: ParsedXml) => ct["@_name"] === "provincesType",
    );
    expect(featureType).toBeTruthy();
    const extension =
      featureType["xs:complexContent"]["xs:extension"];
    expect(extension["@_base"]).toBe("gml:AbstractFeatureType");
    const elements = extension["xs:sequence"]["xs:element"];
    const list = Array.isArray(elements) ? elements : [elements];
    const byName = Object.fromEntries(
      list.map((el: ParsedXml) => [el["@_name"], el["@_type"]]),
    );
    expect(byName.geometry).toBe("gml:GeometryPropertyType");
    expect(byName.kode_prov).toBe("xs:string");
    expect(byName.nama_provinsi).toBe("xs:string");
    expect(byName.area_km2).toBe("xs:double");
    expect(byName.jumlah_penduduk).toBe("xs:integer");
  });

  it("declares a substitutable element per requested type", async () => {
    const response = await GET(
      req(
        "?service=WFS&request=DescribeFeatureType&typenames=provinces,villages",
      ),
    );
    expect(response.status).toBe(200);
    const doc = await parseXml(response);
    const schema = doc["xs:schema"];
    const elements = Array.isArray(schema["xs:element"])
      ? schema["xs:element"]
      : [schema["xs:element"]];
    const substitutable = elements.filter(
      (el: ParsedXml) => el["@_substitutionGroup"] === "gml:AbstractFeature",
    );
    expect(substitutable.map((el: ParsedXml) => el["@_name"])).toEqual([
      "provinces",
      "villages",
    ]);
  });

  it("rejects an unknown type name with an exception report", async () => {
    const response = await GET(
      req("?service=WFS&request=DescribeFeatureType&typename=planets"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue", "typeName");
  });

  it("rejects a missing type name with an exception report", async () => {
    const response = await GET(
      req("?service=WFS&request=DescribeFeatureType"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "MissingParameterValue", "typeName");
  });
});

describe("WFS GetFeature paging and bounding", () => {
  it("applies the default count of 10 and startIndex 0", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces"),
    );
    expect(response.status).toBe(200);
    expect(mocks.listFeatures).toHaveBeenCalledWith(
      "provinces",
      expect.objectContaining({ limit: 10, offset: 0 }),
    );
  });

  it("maps count and startIndex to limit and offset", async () => {
    const response = await GET(
      req(
        "?service=WFS&request=GetFeature&typename=provinces&count=25&startindex=50",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.listFeatures).toHaveBeenCalledWith("provinces", {
      bbox: undefined,
      limit: 25,
      offset: 50,
      properties: undefined,
      crs: "CRS84",
    });
  });

  it("accepts the legacy maxfeatures alias", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces&maxfeatures=7"),
    );
    expect(response.status).toBe(200);
    expect(mocks.listFeatures).toHaveBeenCalledWith(
      "provinces",
      expect.objectContaining({ limit: 7 }),
    );
  });

  it("passes a validated bbox to the repository", async () => {
    const response = await GET(
      req(
        "?service=WFS&request=GetFeature&typename=regencies&bbox=106,-7,107,-6",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.listFeatures).toHaveBeenCalledWith(
      "regencies",
      expect.objectContaining({ bbox: [106, -7, 107, -6] }),
    );
  });

  it("rejects a count above 1000", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces&count=5000"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue", "limit");
    expect(mocks.listFeatures).not.toHaveBeenCalled();
  });

  it("rejects a non-positive count", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces&count=0"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue");
  });

  it("rejects a negative startIndex", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces&startindex=-1"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue");
  });

  it("rejects a malformed bbox", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces&bbox=1,2,3"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue", "bbox");
  });
});

describe("WFS GetFeature strict parameter handling", () => {
  it("rejects FILTER with OperationNotSupported on GetFeature", async () => {
    const response = await GET(
      req(
        "?service=WFS&request=GetFeature&typename=provinces&filter=<Filter/>",
      ),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "OperationNotSupported", "FILTER");
    expect(mocks.listFeatures).not.toHaveBeenCalled();
  });

  it("rejects FILTER on any request, including DescribeFeatureType", async () => {
    const response = await GET(
      req(
        "?service=WFS&request=DescribeFeatureType&typename=provinces&filter=x",
      ),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "OperationNotSupported", "FILTER");
  });

  it("rejects unsupported parameters instead of ignoring them", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces&bogus=1"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue", "bogus");
    expect(mocks.listFeatures).not.toHaveBeenCalled();
  });

  it("rejects an unknown type name", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=planets"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue", "typeName");
  });

  it("rejects an unsupported output format", async () => {
    const response = await GET(
      req(
        "?service=WFS&request=GetFeature&typename=provinces&outputformat=application/shapefile",
      ),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue", "outputFormat");
  });

  it("rejects an unsupported version", async () => {
    const response = await GET(
      req(
        "?service=WFS&version=1.1.0&request=GetFeature&typename=provinces",
      ),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue", "version");
  });

  it("rejects an unknown request type with OperationNotSupported", async () => {
    const response = await GET(req("?service=WFS&request=Transaction"));
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "OperationNotSupported", "request");
  });

  it("rejects a missing request parameter", async () => {
    const response = await GET(req("?service=WFS"));
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "MissingParameterValue", "request");
  });

  it("rejects a non-WFS service parameter", async () => {
    const response = await GET(
      req("?service=WMS&request=GetCapabilities"),
    );
    expect(response.status).toBe(400);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "InvalidParameterValue", "service");
  });

  it("sanitizes unexpected store failures", async () => {
    mocks.listFeatures.mockRejectedValue(
      new Error("password authentication failed for user postgres"),
    );
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces"),
    );
    expect(response.status).toBe(500);
    const doc = await parseXml(response);
    expectExceptionReport(doc, "NoApplicableCode");
    expect(JSON.stringify(doc)).not.toContain("password");
  });
});

describe("WFS GetFeature GeoJSON output", () => {
  it("returns a GeoJSON FeatureCollection with truthful counts", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=provinces"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/geo+json",
    );
    const body = await response.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.numberMatched).toBe(25);
    expect(body.numberReturned).toBe(1);
    expect(body.features).toHaveLength(1);
  });
});

describe("WFS GetFeature GML output", () => {
  it("returns parseable GML with truthful paging counts", async () => {
    const gmlFormat = encodeURIComponent("application/gml+xml; version=3.2");
    const response = await GET(
      req(
        `?service=WFS&request=GetFeature&typename=provinces&outputformat=${gmlFormat}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/xml");
    const doc = await parseXml(response);
    const collection =
      doc["wfs:FeatureCollection"] ?? doc["FeatureCollection"];
    expect(collection).toBeTruthy();
    expect(collection["@_numberMatched"]).toBe("25");
    expect(collection["@_numberReturned"]).toBe("1");

    const memberNodes = collection["wfs:member"] ?? collection["member"];
    const members = Array.isArray(memberNodes) ? memberNodes : [memberNodes];
    expect(members).toHaveLength(1);
    const feature = members[0]["app:provinces"];
    expect(feature).toBeTruthy();
    expect(feature["app:geometry"]).toBeTruthy();
    expect(String(feature["app:kode_prov"])).toBe("31");
    expect(feature["app:nama_provinsi"]).toBe("DKI JAKARTA");

    const envelope = collection["gml:boundedBy"]["gml:Envelope"];
    expect(String(envelope["@_srsName"])).toContain("CRS84");
  });

  it("accepts the short gml output format alias", async () => {
    const response = await GET(
      req("?service=WFS&request=GetFeature&typename=villages&outputformat=gml"),
    );
    expect(response.status).toBe(200);
    const doc = await parseXml(response);
    const collection =
      doc["wfs:FeatureCollection"] ?? doc["FeatureCollection"];
    expect(collection).toBeTruthy();
  });
});
