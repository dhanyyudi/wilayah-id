/**
 * OGC WFS (Web Feature Service) Endpoint
 * Supports: GetCapabilities, DescribeFeatureType, GetFeature
 * Version: 2.0.0
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  generateWFSCapabilities, 
  parseOGCParams, 
  validateParams,
  WFS_FEATURE_TYPES 
} from '@/lib/ogc-utils';
import { geoJSONToGML } from '@/lib/gml-utils';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Handle WFS requests
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = parseOGCParams(searchParams);
    
    const service = params['SERVICE'];
    const requestType = params['REQUEST'];

    // Validate service
    if (service && service.toLowerCase() !== 'wfs') {
      return NextResponse.json(
        { error: 'Invalid service. Expected: WFS' },
        { status: 400 }
      );
    }

    // Route to appropriate handler
    switch (requestType?.toUpperCase()) {
      case 'GETCAPABILITIES':
        return handleGetCapabilities(request);
      
      case 'DESCRIBEFEATURETYPE':
        return handleDescribeFeatureType(params);
      
      case 'GETFEATURE':
        return handleGetFeature(params);
      
      default:
        return NextResponse.json(
          { 
            error: 'Invalid request',
            message: `Request type '${requestType}' not supported`,
            supported: ['GetCapabilities', 'DescribeFeatureType', 'GetFeature']
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('WFS Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Handle GetCapabilities request
 */
function handleGetCapabilities(request: NextRequest) {
  const baseUrl = `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('host')}`;
  const xml = generateWFSCapabilities(baseUrl);
  
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * Handle DescribeFeatureType request
 * Returns XSD schema for the feature type
 */
function handleDescribeFeatureType(params: Record<string, string>) {
  const typeName = params['TYPENAME'] || params['TYPE_NAME'];
  
  if (!typeName) {
    return NextResponse.json(
      { error: 'Missing required parameter: TYPENAME' },
      { status: 400 }
    );
  }

  const featureType = WFS_FEATURE_TYPES[typeName.toLowerCase() as keyof typeof WFS_FEATURE_TYPES];
  
  if (!featureType) {
    return NextResponse.json(
      { 
        error: 'Invalid feature type',
        validTypes: Object.keys(WFS_FEATURE_TYPES)
      },
      { status: 400 }
    );
  }

  // Return simple schema description
  return NextResponse.json({
    featureType: typeName,
    schema: {
      namespace: 'http://wilayah.id/wfs',
      elementFormDefault: 'qualified',
      properties: featureType.properties.reduce((acc, prop) => {
        acc[prop] = {
          type: prop === 'geometry' ? 'gml:GeometryPropertyType' : 'string',
          nillable: prop !== 'geometry',
        };
        return acc;
      }, {} as Record<string, unknown>),
    },
  });
}

/**
 * Handle GetFeature request
 * Returns features in GeoJSON or GML format
 */
async function handleGetFeature(params: Record<string, string>) {
  const required = ['TYPENAME'];
  const error = validateParams(params, required);
  
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const typeName = params['TYPENAME'];
  const outputFormat = params['OUTPUTFORMAT'] || 'application/geo+json';
  const maxFeatures = parseInt(params['MAXFEATURES'] || params['COUNT'] || '1000');
  const bbox = params['BBOX'];
  const filter = params['FILTER'];

  // Validate feature type
  const featureType = WFS_FEATURE_TYPES[typeName.toLowerCase() as keyof typeof WFS_FEATURE_TYPES];
  
  if (!featureType) {
    return NextResponse.json(
      { 
        error: 'Invalid feature type',
        requested: typeName,
        validTypes: Object.keys(WFS_FEATURE_TYPES)
      },
      { status: 400 }
    );
  }

  try {
    const sql = getDb();
    
    // Build query based on feature type
    let query;
    const limit = Math.min(maxFeatures, 10000); // Hard limit for performance

    switch (typeName.toLowerCase()) {
      case 'provinces':
        query = buildFeatureQuery(sql, 'provinces', 'kode_prov', 'nama_provinsi', 'geom', bbox, limit);
        break;
      case 'regencies':
        query = buildFeatureQuery(sql, 'regencies', 'kode_kab', 'nama_kabupaten', 'geom', bbox, limit);
        break;
      case 'districts':
        query = buildFeatureQuery(sql, 'districts', 'kode_kec', 'nama_kecamatan', 'geom', bbox, limit);
        break;
      case 'villages':
        query = buildFeatureQuery(sql, 'villages', 'kode_desa', 'nama_desa', 'geom', bbox, limit);
        break;
      default:
        return NextResponse.json({ error: 'Unknown feature type' }, { status: 400 });
    }

    const rows = await query;

    // Convert to GeoJSON
    const features = rows.map((row: Record<string, unknown>) => {
      const props: Record<string, unknown> = {
        code: row.code,
        name: row.name,
      };
      if (row.parent_code) {
        props.parent_code = row.parent_code;
      }
      return {
        type: 'Feature' as const,
        id: row.code,
        geometry: row.geometry,
        properties: props,
      };
    });

    const geojson = {
      type: 'FeatureCollection',
      numberMatched: features.length,
      numberReturned: features.length,
      features,
      // Note: GeoJSON RFC 7946 default CRS is WGS84 (EPSG:4326)
      // No explicit crs property needed
    };

    // Return in requested format
    if (outputFormat.includes('gml') || outputFormat.includes('xml')) {
      // Convert to GML format
      const gml = geoJSONToGML(geojson as any, typeName);
      
      return new NextResponse(gml, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    return NextResponse.json(geojson, {
      headers: {
        'Content-Type': 'application/geo+json',
        'Cache-Control': 'public, max-age=300',
      },
    });

  } catch (error) {
    console.error('GetFeature error:', error);
    return NextResponse.json(
      { error: 'Database query failed' },
      { status: 500 }
    );
  }
}

/**
 * Whitelist of valid table configurations for safe query building
 * All identifiers are validated against this whitelist to prevent SQL injection
 * Using Indonesian table names as per database schema
 */
const TABLE_CONFIG: Record<string, { table: string; code: string; name: string; parent?: string }> = {
  provinces: { table: 'provinsi', code: 'kode_prov', name: 'nama_provinsi' },
  regencies: { table: 'kabupaten', code: 'kode_kab', name: 'nama_kabupaten', parent: 'kode_prov' },
  districts: { table: 'kecamatan', code: 'kode_kec', name: 'nama_kecamatan', parent: 'kode_kab' },
  villages: { table: 'desa', code: 'kode_desa', name: 'nama_desa', parent: 'kode_kec' },
};

/**
 * Build and execute SQL query for feature retrieval
 * Uses raw SQL with validated identifiers (SQL injection safe)
 */
async function executeFeatureQuery(
  sql: ReturnType<typeof getDb>,
  table: string,
  bbox: string | undefined,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  // Validate table name against whitelist
  const config = TABLE_CONFIG[table.toLowerCase()];
  if (!config) {
    throw new Error(`Invalid table name: ${table}`);
  }

  // Build the query string with validated identifiers
  // Note: config.* values come from whitelist, user input (bbox/limit) is parameterized
  let query: string;
  let params: (number | string)[];

  if (bbox) {
    // Parse bbox: minX,minY,maxX,maxY
    const [minX, minY, maxX, maxY] = bbox.split(',').map(Number);
    
    query = `
      SELECT 
        ${config.code} as code,
        ${config.name} as name,
        ${config.parent ? `${config.parent} as parent_code,` : ''}
        ST_AsGeoJSON(geom)::json as geometry
      FROM ${config.table}
      WHERE ST_Intersects(
        geom,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      LIMIT $5
    `;
    params = [minX, minY, maxX, maxY, limit];
  } else {
    query = `
      SELECT 
        ${config.code} as code,
        ${config.name} as name,
        ${config.parent ? `${config.parent} as parent_code,` : ''}
        ST_AsGeoJSON(geom)::json as geometry
      FROM ${config.table}
      LIMIT $1
    `;
    params = [limit];
  }

  // Execute using sql.query for conventional function call with placeholders
  return sql.query(query, params);
}

// Backward compatibility wrapper
function buildFeatureQuery(
  sql: ReturnType<typeof getDb>,
  table: string,
  codeColumn: string,
  nameColumn: string,
  geomColumn: string,
  bbox: string | undefined,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  return executeFeatureQuery(sql, table, bbox, limit);
}
