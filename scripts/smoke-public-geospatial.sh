#!/usr/bin/env bash
# smoke-public-geospatial.sh — public smoke checks for the wilayah-id
# geospatial services: REST, OGC API Features, WFS 2.0, and WMS 1.3.0.
#
# Usage:
#   BASE_URL=http://127.0.0.1:3000 bash scripts/smoke-public-geospatial.sh
#
# CAVEAT — false green against production: src/middleware.ts rewrites every
# /api/* request to WILAYAH_API_ORIGIN, which defaults to the PRODUCTION
# API origin. Running this script against a local server that was started
# without overrides silently smoke-tests production instead of the local
# build. When targeting a local server, start it with self-pointed origins
# (non-HTTPS origins are rejected under NODE_ENV=production, so use pnpm dev):
#
#   WILAYAH_API_ORIGIN=http://127.0.0.1:3000 \
#   WILAYAH_TILES_ORIGIN=http://127.0.0.1:3000 \
#   NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 \
#   DATABASE_URL=... pnpm dev -p 3000
#
# Tell-tale of a production rewrite: response headers contain
# `x-middleware-rewrite: https://wilayah-id-api...` and `server: openresty`.
# No overrides are needed when BASE_URL points at a real deployment.
#
# Validators: JSON via Ajv (node), XML via xmllint with python3 /
# fast-xml-parser fallback, images via Sharp (node) with ImageMagick
# `identify` fallback, GeoJSON via ogrinfo with an Ajv fallback. Optional
# validator binaries that are missing only downgrade the check with a loud
# warning; they never fail the run by themselves.

set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAILURES=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILURES=$((FAILURES + 1)); }
warn() { echo "WARN: $1" >&2; }

have() { command -v "$1" >/dev/null 2>&1; }

# fetch <name> <url> <outfile> — stores body and sets HTTP_STATUS.
fetch() {
  local name="$1" url="$2" out="$3"
  HTTP_STATUS="$(curl -sS -o "$out" -w '%{http_code}' "${BASE_URL}${url}")" || {
    fail "$name: curl could not reach ${BASE_URL}${url}"
    return 1
  }
  return 0
}

expect_status() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$name: HTTP $actual"
  else
    fail "$name: expected HTTP $expected, got $actual"
  fi
}

# node_eval <script> [args...] — runs node from the repo root so repo
# dependencies (ajv, fast-xml-parser, sharp) resolve. Extra args are
# exposed to the script as process.argv[1..].
node_eval() {
  local script="$1"
  shift
  (cd "$REPO_ROOT" && node -e "$script" "$@")
}

# validate_json_ajv <name> <file> <schema-key>
# Schemas are intentionally minimal: they pin the contract shape, not the
# full data content.
validate_json_ajv() {
  local name="$1" file="$2" key="$3"
  if node_eval "
    const fs = require('fs');
    const Ajv = require('ajv');
    const schemas = {
      restList: {
        type: 'object', required: ['data'],
        properties: {
          data: { type: 'array', minItems: 1 },
          meta: { type: 'object', required: ['total'], properties: { total: { type: 'integer' } } },
        },
      },
      ogcLanding: {
        type: 'object', required: ['title', 'links'],
        properties: {
          title: { type: 'string', minLength: 1 },
          links: { type: 'array', minItems: 1, items: { type: 'object', required: ['rel', 'href'] } },
        },
      },
      ogcConformance: {
        type: 'object', required: ['conformsTo'],
        properties: {
          conformsTo: {
            type: 'array',
            contains: { const: 'http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core' },
          },
        },
      },
      geojsonFeatureCollection: {
        type: 'object', required: ['type', 'features', 'numberMatched', 'numberReturned'],
        properties: {
          type: { const: 'FeatureCollection' },
          numberMatched: { type: 'integer', minimum: 0 },
          numberReturned: { type: 'integer', minimum: 0 },
          features: {
            type: 'array',
            items: {
              type: 'object', required: ['type', 'geometry', 'properties'],
              properties: { type: { const: 'Feature' }, geometry: { type: 'object' }, properties: { type: 'object' } },
            },
          },
        },
      },
    };
    const ajv = new Ajv({ allErrors: true });
    const body = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const validate = ajv.compile(schemas[process.argv[2]]);
    if (!validate(body)) {
      console.error(ajv.errorsText(validate.errors));
      process.exit(1);
    }
  " "$file" "$key"; then
    pass "$name: valid JSON ($key, Ajv)"
  else
    fail "$name: JSON validation failed ($key)"
  fi
}

# validate_xml <name> <file> — xmllint, python3, then fast-xml-parser.
validate_xml() {
  local name="$1" file="$2"
  if have xmllint; then
    if xmllint --noout "$file" 2>"$TMP_DIR/xmllint.err"; then
      pass "$name: well-formed XML (xmllint)"
    else
      fail "$name: malformed XML: $(head -1 "$TMP_DIR/xmllint.err")"
    fi
  elif have python3; then
    warn "$name: xmllint not found; falling back to python3 xml parser"
    if python3 -c "import xml.dom.minidom, sys; xml.dom.minidom.parse(sys.argv[1])" "$file" 2>"$TMP_DIR/xml.err"; then
      pass "$name: well-formed XML (python3)"
    else
      fail "$name: malformed XML: $(head -1 "$TMP_DIR/xml.err")"
    fi
  else
    warn "$name: xmllint and python3 not found; falling back to fast-xml-parser via node"
    if node_eval "
      const fs = require('fs');
      const { XMLValidator } = require('fast-xml-parser');
      const result = XMLValidator.validate(fs.readFileSync(process.argv[1], 'utf8'));
      if (result !== true) { console.error(result.err.msg); process.exit(1); }
    " "$file"; then
      pass "$name: well-formed XML (fast-xml-parser)"
    else
      fail "$name: malformed XML"
    fi
  fi
}

# validate_image <name> <file> <width> <height> <format>
validate_image() {
  local name="$1" file="$2" width="$3" height="$4" format="$5"
  if node_eval "
    const sharp = require('sharp');
    sharp(process.argv[1]).metadata().then((m) => {
      if (m.width !== ${width} || m.height !== ${height} || m.format !== '${format}') {
        console.error(\`got \${m.width}x\${m.height} \${m.format}\`);
        process.exit(1);
      }
    }).catch((e) => { console.error(e.message); process.exit(1); });
  " "$file" 2>"$TMP_DIR/img.err"; then
    pass "$name: ${width}x${height} ${format} image (sharp)"
  elif have identify; then
    warn "$name: sharp unavailable; falling back to ImageMagick identify"
    local got
    got="$(identify -format '%w %h %m' "$file" 2>/dev/null)"
    local want="${width} ${height} $(echo "$format" | tr 'a-z' 'A-Z')"
    # ImageMagick spells jpeg as JPEG and png as PNG.
    if [ "$got" = "$want" ]; then
      pass "$name: ${width}x${height} ${format} image (identify)"
    else
      fail "$name: expected '$want', got '$got'"
    fi
  else
    warn "$name: no image validator available (sharp, identify); checking magic bytes only"
    if [ "$(head -c 4 "$file" | od -An -tx1 | tr -d ' \n')" = "89504e47" ]; then
      pass "$name: PNG magic bytes present"
    else
      fail "$name: missing PNG magic bytes and no validator available"
    fi
  fi
}

# validate_geojson <name> <file> — ogrinfo with Ajv fallback.
validate_geojson() {
  local name="$1" file="$2"
  if have ogrinfo; then
    if ogrinfo -ro -al -so "$file" >"$TMP_DIR/ogr.out" 2>&1; then
      pass "$name: readable GeoJSON (ogrinfo)"
    else
      fail "$name: ogrinfo could not read GeoJSON: $(head -1 "$TMP_DIR/ogr.out")"
    fi
  else
    warn "$name: ogrinfo not found; falling back to Ajv GeoJSON schema check"
    validate_json_ajv "$name" "$file" geojsonFeatureCollection
  fi
}

echo "Smoke target: ${BASE_URL}"
echo "----------------------------------------------------------------"

# 1. REST regions ----------------------------------------------------------
if fetch "REST provinces" "/api/v1/regions/provinces" "$TMP_DIR/rest.json"; then
  expect_status "REST provinces" 200 "$HTTP_STATUS"
  validate_json_ajv "REST provinces" "$TMP_DIR/rest.json" restList
fi

# 2. OGC API Features ------------------------------------------------------
if fetch "OGC landing" "/api/v1/ogc/features" "$TMP_DIR/landing.json"; then
  expect_status "OGC landing" 200 "$HTTP_STATUS"
  validate_json_ajv "OGC landing" "$TMP_DIR/landing.json" ogcLanding
fi

if fetch "OGC conformance" "/api/v1/ogc/features/conformance" "$TMP_DIR/conf.json"; then
  expect_status "OGC conformance" 200 "$HTTP_STATUS"
  validate_json_ajv "OGC conformance" "$TMP_DIR/conf.json" ogcConformance
fi

if fetch "OGC bounded items" "/api/v1/ogc/features/collections/provinces/items?limit=2" "$TMP_DIR/items.geojson"; then
  expect_status "OGC bounded items" 200 "$HTTP_STATUS"
  validate_geojson "OGC bounded items" "$TMP_DIR/items.geojson"
  if node_eval "
    const body = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    if (body.numberReturned > 2) { console.error('numberReturned ' + body.numberReturned + ' exceeds limit=2'); process.exit(1); }
  " "$TMP_DIR/items.geojson"; then
    pass "OGC bounded items: limit=2 honoured"
  else
    fail "OGC bounded items: limit=2 not honoured"
  fi
fi

# 3. WFS 2.0 ---------------------------------------------------------------
if fetch "WFS GetCapabilities" "/api/v1/ogc/wfs?SERVICE=WFS&REQUEST=GetCapabilities" "$TMP_DIR/wfs-cap.xml"; then
  expect_status "WFS GetCapabilities" 200 "$HTTP_STATUS"
  validate_xml "WFS GetCapabilities" "$TMP_DIR/wfs-cap.xml"
  if grep -q "WFS_Capabilities" "$TMP_DIR/wfs-cap.xml"; then
    pass "WFS GetCapabilities: WFS_Capabilities root present"
  else
    fail "WFS GetCapabilities: WFS_Capabilities root missing"
  fi
fi

if fetch "WFS GetFeature GML" "/api/v1/ogc/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAMES=provinces&COUNT=2&OUTPUTFORMAT=application%2Fgml%2Bxml%3B%20version%3D3.2" "$TMP_DIR/wfs.gml"; then
  expect_status "WFS GetFeature GML" 200 "$HTTP_STATUS"
  validate_xml "WFS GetFeature GML" "$TMP_DIR/wfs.gml"
  if grep -q "gml" "$TMP_DIR/wfs.gml"; then
    pass "WFS GetFeature GML: GML payload present"
  else
    fail "WFS GetFeature GML: no GML payload"
  fi
fi

if fetch "WFS FILTER refusal" "/api/v1/ogc/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAMES=provinces&FILTER=%3Cfes%3AFilter%2F%3E" "$TMP_DIR/wfs-filter.xml"; then
  expect_status "WFS FILTER refusal" 400 "$HTTP_STATUS"
  validate_xml "WFS FILTER refusal" "$TMP_DIR/wfs-filter.xml"
  if grep -q 'exceptionCode="OperationNotSupported"' "$TMP_DIR/wfs-filter.xml"; then
    pass "WFS FILTER refusal: OperationNotSupported exception"
  else
    fail "WFS FILTER refusal: expected OperationNotSupported exception"
  fi
fi

# 4. WMS 1.3.0 -------------------------------------------------------------
if fetch "WMS GetCapabilities" "/api/v1/ogc/wms?SERVICE=WMS&REQUEST=GetCapabilities" "$TMP_DIR/wms-cap.xml"; then
  expect_status "WMS GetCapabilities" 200 "$HTTP_STATUS"
  validate_xml "WMS GetCapabilities" "$TMP_DIR/wms-cap.xml"
  if grep -q "WMS_Capabilities" "$TMP_DIR/wms-cap.xml"; then
    pass "WMS GetCapabilities: WMS_Capabilities root present"
  else
    fail "WMS GetCapabilities: WMS_Capabilities root missing"
  fi
fi

if fetch "WMS GetMap PNG" "/api/v1/ogc/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&CRS=CRS:84&BBOX=95,-11,141,6&WIDTH=256&HEIGHT=256&FORMAT=image/png" "$TMP_DIR/map.png"; then
  expect_status "WMS GetMap PNG" 200 "$HTTP_STATUS"
  validate_image "WMS GetMap PNG" "$TMP_DIR/map.png" 256 256 png
fi

if fetch "WMS oversize refusal" "/api/v1/ogc/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=provinces&CRS=CRS:84&BBOX=95,-11,141,6&WIDTH=2049&HEIGHT=256&FORMAT=image/png" "$TMP_DIR/wms-big.xml"; then
  expect_status "WMS oversize refusal" 400 "$HTTP_STATUS"
  validate_xml "WMS oversize refusal" "$TMP_DIR/wms-big.xml"
  if grep -q "ServiceException" "$TMP_DIR/wms-big.xml"; then
    pass "WMS oversize refusal: ServiceExceptionReport returned"
  else
    fail "WMS oversize refusal: expected ServiceExceptionReport"
  fi
fi

echo "----------------------------------------------------------------"
if [ "$FAILURES" -gt 0 ]; then
  echo "SMOKE FAILED: $FAILURES check(s) failed against ${BASE_URL}"
  exit 1
fi
echo "SMOKE OK: all checks passed against ${BASE_URL}"
