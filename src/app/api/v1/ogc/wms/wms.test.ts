/**
 * Route contract tests for the WMS 1.3.0 endpoint.
 *
 * The database layer is mocked, so no live PostGIS is required. Map
 * responses are decoded through Sharp to prove they are real images of the
 * requested size; exception responses are validated as WMS 1.3.0
 * ServiceExceptionReport documents.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ query: mocks.query }),
}));

const SQUARE = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [106.25, -6.75],
        [106.75, -6.75],
        [106.75, -6.25],
        [106.25, -6.25],
        [106.25, -6.75],
      ],
    ],
  ],
};

const BASE = "http://localhost/api/v1/ogc/wms";

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

async function expectServiceException(
  response: Response,
  status: number,
  code: string,
  locator?: string,
): Promise<ParsedXml> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("text/xml");
  const xml = await response.text();
  expect(XMLValidator.validate(xml)).toBe(true);
  const doc: ParsedXml = parser.parse(xml);
  const report = doc["ServiceExceptionReport"];
  expect(report, "response must be a ServiceExceptionReport").toBeTruthy();
  expect(report["@_version"]).toBe("1.3.0");
  const exception = Array.isArray(report["ServiceException"])
    ? report["ServiceException"][0]
    : report["ServiceException"];
  expect(exception["@_code"]).toBe(code);
  if (locator !== undefined) {
    expect(exception["@_locator"]).toBe(locator);
  }
  expect(exception["#text"] ?? exception["ServiceException"]).toBeDefined();
  return doc;
}

const GETMAP =
  "?service=WMS&version=1.3.0&request=GetMap&layers=provinces" +
  "&crs=CRS:84&bbox=106,-7,107,-6&width=256&height=128&format=image/png";

beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockImplementation(async (text: string) => {
    if (text.includes("ST_Covers")) {
      return [{ kode_prov: "31", nama_provinsi: "DKI JAKARTA" }];
    }
    if (text.includes("ST_AsGeoJSON")) {
      return [{ geometry: SQUARE }];
    }
    return [];
  });
});

describe("WMS GetCapabilities", () => {
  it("returns valid XML with truthful formats, layers, and limits", async () => {
    const response = await GET(req("?service=WMS&request=GetCapabilities"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/xml");
    const xml = await response.text();
    expect(XMLValidator.validate(xml)).toBe(true);

    expect(xml).toContain('version="1.3.0"');
    expect(xml).toContain("<Format>image/png</Format>");
    expect(xml).toContain("<Format>image/jpeg</Format>");
    expect(xml).not.toContain("image/gif");
    expect(xml).toContain("<MaxWidth>2048</MaxWidth>");
    expect(xml).toContain("<MaxHeight>2048</MaxHeight>");
    for (const id of ["provinces", "regencies", "districts", "villages"]) {
      expect(xml).toContain(`<Name>${id}</Name>`);
    }
    expect(xml).toContain("<Name>default</Name>");
    expect(xml).toContain("<CRS>CRS:84</CRS>");
    expect(xml).toContain("<CRS>EPSG:4326</CRS>");
  });

  it("rejects unsupported parameters instead of ignoring them", async () => {
    const response = await GET(
      req("?service=WMS&request=GetCapabilities&bogus=1"),
    );
    await expectServiceException(response, 400, "InvalidParameterValue", "bogus");
  });
});

describe("WMS GetMap rendering", () => {
  it("returns a decodable PNG of the requested dimensions", async () => {
    const response = await GET(req(GETMAP));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(256);
    expect(metadata.height).toBe(128);

    const mapQuery = mocks.query.mock.calls.find(([text]) =>
      String(text).includes("ST_AsGeoJSON"),
    );
    expect(mapQuery).toBeDefined();
    expect(mapQuery![1].slice(0, 4)).toEqual([106, -7, 107, -6]);
  });

  it("honours WMS 1.3.0 lat,lon axis order for EPSG:4326", async () => {
    const response = await GET(
      req(
        "?service=WMS&version=1.3.0&request=GetMap&layers=provinces" +
          "&crs=EPSG:4326&bbox=-7,106,-6,107&width=256&height=128&format=image/png",
      ),
    );
    expect(response.status).toBe(200);
    const mapQuery = mocks.query.mock.calls.find(([text]) =>
      String(text).includes("ST_AsGeoJSON"),
    );
    // Envelope must be reconstructed in lon,lat order for PostGIS.
    expect(mapQuery![1].slice(0, 4)).toEqual([106, -7, 107, -6]);
  });

  it("returns a decodable JPEG", async () => {
    const response = await GET(req(GETMAP.replace("image/png", "image/jpeg")));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/jpeg");
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(256);
    expect(metadata.height).toBe(128);
  });

  it("keeps empty areas transparent when TRANSPARENT=TRUE", async () => {
    const response = await GET(req(`${GETMAP}&transparent=TRUE`));
    expect(response.status).toBe(200);
    const buffer = Buffer.from(await response.arrayBuffer());
    const { data } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
  });

  it("flattens to a white background by default", async () => {
    const response = await GET(req(GETMAP));
    const buffer = Buffer.from(await response.arrayBuffer());
    const { data } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(255);
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it("accepts the largest advertised request (2048x2048, exactly the pixel cap)", async () => {
    const response = await GET(
      req(GETMAP.replace("width=256&height=128", "width=2048&height=2048")),
    );
    expect(response.status).toBe(200);
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    expect(metadata.width).toBe(2048);
    expect(metadata.height).toBe(2048);
  });

  it("draws multiple layers in one bounded render", async () => {
    const response = await GET(
      req(GETMAP.replace("layers=provinces", "layers=provinces,regencies&styles=,")),
    );
    expect(response.status).toBe(200);
    const mapQueries = mocks.query.mock.calls.filter(([text]) =>
      String(text).includes("ST_AsGeoJSON"),
    );
    expect(mapQueries).toHaveLength(2);
  });
});

describe("WMS GetMap parameter validation", () => {
  it("requires LAYERS, CRS, BBOX, WIDTH, HEIGHT, FORMAT, and VERSION", async () => {
    for (const [removed, locator] of [
      ["layers=provinces&", "layers"],
      ["crs=CRS:84&", "crs"],
      ["bbox=106,-7,107,-6&", "bbox"],
      ["width=256&", "width"],
      ["height=128&", "height"],
      // FORMAT is the final query pair, so strip the leading "&" instead of
      // a trailing one (otherwise the replace is a no-op).
      ["&format=image/png", "format"],
      ["version=1.3.0&", "version"],
    ] as const) {
      const response = await GET(req(GETMAP.replace(removed, "")));
      await expectServiceException(
        response,
        400,
        "MissingParameterValue",
        locator,
      );
      expect(mocks.query).not.toHaveBeenCalled();
    }
  });

  it("rejects unknown layers with LayerNotDefined", async () => {
    const response = await GET(
      req(GETMAP.replace("layers=provinces", "layers=planets")),
    );
    await expectServiceException(response, 400, "LayerNotDefined", "layers");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("accepts empty and default styles, rejects anything else", async () => {
    for (const styles of ["", "default"]) {
      const response = await GET(req(`${GETMAP}&styles=${styles}`));
      expect(response.status).toBe(200);
    }
    const response = await GET(req(`${GETMAP}&styles=fancy`));
    await expectServiceException(response, 400, "StyleNotDefined", "styles");
  });

  it("rejects a style list that does not match the layer list", async () => {
    const response = await GET(
      req(
        GETMAP.replace(
          "layers=provinces",
          "layers=provinces,regencies&styles=default",
        ),
      ),
    );
    await expectServiceException(response, 400, "InvalidParameterValue", "styles");
  });

  it("rejects unsupported CRS with InvalidCRS", async () => {
    const response = await GET(
      req(GETMAP.replace("crs=CRS:84", "crs=EPSG:3857")),
    );
    await expectServiceException(response, 400, "InvalidCRS", "crs");
  });

  it("rejects malformed, inverted, and out-of-range bounding boxes", async () => {
    for (const bbox of ["1,2,3", "107,-7,106,-6", "a,b,c,d", "0,-95,1,95"]) {
      const response = await GET(
        req(GETMAP.replace("bbox=106,-7,107,-6", `bbox=${bbox}`)),
      );
      await expectServiceException(response, 400, "InvalidParameterValue", "bbox");
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("enforces dimension limits before any database work", async () => {
    for (const dims of ["width=0", "width=2049", "width=abc", "height=-1"]) {
      const target = dims.startsWith("width") ? "width=256" : "height=128";
      const response = await GET(req(GETMAP.replace(target, dims)));
      await expectServiceException(response, 400, "InvalidParameterValue");
      expect(mocks.query).not.toHaveBeenCalled();
    }
  });

  it("rejects unadvertised formats with InvalidFormat", async () => {
    for (const format of ["image/gif", "image/jpg", "image/webp"]) {
      const response = await GET(
        req(GETMAP.replace("format=image/png", `format=${format}`)),
      );
      await expectServiceException(response, 400, "InvalidFormat", "format");
    }
  });

  it("validates TRANSPARENT and its compatibility with the format", async () => {
    const bad = await GET(req(`${GETMAP}&transparent=banana`));
    await expectServiceException(bad, 400, "InvalidParameterValue", "transparent");

    const jpegTransparent = await GET(
      req(`${GETMAP.replace("image/png", "image/jpeg")}&transparent=true`),
    );
    await expectServiceException(
      jpegTransparent,
      400,
      "InvalidParameterValue",
      "transparent",
    );
  });

  it("rejects unsupported protocol parameters instead of ignoring them", async () => {
    for (const extra of ["time=2020-01-01", "elevation=5", "bgcolor=0xFF0000", "sld=http://x"]) {
      const response = await GET(req(`${GETMAP}&${extra}`));
      await expectServiceException(response, 400, "InvalidParameterValue");
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects unsupported versions and non-WMS services", async () => {
    const wrongVersion = await GET(
      req(GETMAP.replace("version=1.3.0", "version=1.1.1")),
    );
    await expectServiceException(wrongVersion, 400, "InvalidParameterValue", "version");

    const wrongService = await GET(req(GETMAP.replace("service=WMS", "service=WFS")));
    await expectServiceException(wrongService, 400, "InvalidParameterValue", "service");
  });

  it("rejects unknown requests with OperationNotSupported", async () => {
    const response = await GET(
      req("?service=WMS&version=1.3.0&request=DescribeLayer"),
    );
    await expectServiceException(response, 400, "OperationNotSupported", "request");
  });

  it("requires the REQUEST parameter", async () => {
    const response = await GET(req("?service=WMS"));
    await expectServiceException(response, 400, "MissingParameterValue", "request");
  });

  it("sanitizes database failures", async () => {
    mocks.query.mockRejectedValue(
      new Error("password authentication failed for user postgres"),
    );
    const response = await GET(req(GETMAP));
    const doc = await expectServiceException(response, 500, "NoApplicableCode");
    expect(JSON.stringify(doc)).not.toContain("password");
  });
});

describe("WMS GetFeatureInfo", () => {
  const GFI =
    "?service=WMS&version=1.3.0&request=GetFeatureInfo" +
    "&layers=provinces&query_layers=provinces&crs=CRS:84" +
    "&bbox=106,-7,107,-6&width=256&height=128&i=128&j=64";

  it("returns covering feature properties as JSON, using ST_Covers", async () => {
    const response = await GET(req(GFI));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.coordinate.lon).toBeCloseTo(106.5, 10);
    expect(body.coordinate.lat).toBeCloseTo(-6.5, 10);
    expect(body.layers.provinces).toEqual({
      kode_prov: "31",
      nama_provinsi: "DKI JAKARTA",
    });

    const infoQuery = mocks.query.mock.calls.find(([text]) =>
      String(text).includes("ST_Covers"),
    );
    expect(infoQuery).toBeDefined();
    expect(infoQuery![1]).toEqual([106.5, -6.5]);
  });

  it("honours EPSG:4326 axis order when computing the query coordinate", async () => {
    const response = await GET(
      req(GFI.replace("crs=CRS:84&bbox=106,-7,107,-6", "crs=EPSG:4326&bbox=-7,106,-6,107")),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.coordinate.lon).toBeCloseTo(106.5, 10);
    expect(body.coordinate.lat).toBeCloseTo(-6.5, 10);
  });

  it("supports text/plain output", async () => {
    const response = await GET(req(`${GFI}&info_format=text/plain`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("DKI JAKARTA");
  });

  it("rejects unadvertised info formats with InvalidFormat", async () => {
    const response = await GET(req(`${GFI}&info_format=text/xml`));
    await expectServiceException(response, 400, "InvalidFormat", "info_format");
  });

  it("rejects query layers not present in LAYERS", async () => {
    const response = await GET(
      req(GFI.replace("query_layers=provinces", "query_layers=regencies")),
    );
    await expectServiceException(response, 400, "LayerNotDefined", "query_layers");
  });

  it("rejects pixel positions outside the map with InvalidPoint", async () => {
    for (const [from, to] of [
      ["i=128", "i=256"],
      ["j=64", "j=-1"],
    ] as const) {
      const response = await GET(req(GFI.replace(from, to)));
      await expectServiceException(response, 400, "InvalidPoint");
    }
  });

  it("rejects non-integer pixel positions", async () => {
    const response = await GET(req(GFI.replace("i=128", "i=abc")));
    await expectServiceException(response, 400, "InvalidParameterValue", "i");
  });

  it("rejects the legacy X/Y parameters instead of silently ignoring them", async () => {
    const response = await GET(req(`${GFI}&x=1&y=2`));
    await expectServiceException(response, 400, "InvalidParameterValue", "x");
  });

  it("requires QUERY_LAYERS", async () => {
    const response = await GET(req(GFI.replace("query_layers=provinces&", "")));
    await expectServiceException(response, 400, "MissingParameterValue", "query_layers");
  });
});
