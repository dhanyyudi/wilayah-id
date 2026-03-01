/**
 * OGC WMS (Web Map Service) Endpoint
 * Supports: GetCapabilities, GetMap, GetFeatureInfo
 * Version: 1.3.0
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  generateWMSCapabilities, 
  parseOGCParams, 
  validateParams,
  WMS_LAYERS 
} from '@/lib/ogc-utils';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Handle WMS requests
 * Supported operations: GetCapabilities, GetMap, GetFeatureInfo
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = parseOGCParams(searchParams);
    
    const service = params['SERVICE'];
    const requestType = params['REQUEST'];

    // Validate service
    if (service && service.toLowerCase() !== 'wms') {
      return NextResponse.json(
        { error: 'Invalid service. Expected: WMS' },
        { status: 400 }
      );
    }

    // Route to appropriate handler
    switch (requestType?.toUpperCase()) {
      case 'GETCAPABILITIES':
        return handleGetCapabilities(request);
      
      case 'GETMAP':
        return handleGetMap(params);
      
      case 'GETFEATUREINFO':
        return handleGetFeatureInfo(params);
      
      default:
        return NextResponse.json(
          { 
            error: 'Invalid request',
            message: `Request type '${requestType}' not supported`,
            supported: ['GetCapabilities', 'GetMap', 'GetFeatureInfo']
          },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('WMS Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Handle GetCapabilities request
 * Returns XML metadata about the service
 */
function handleGetCapabilities(request: NextRequest) {
  const baseUrl = `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('host')}`;
  const xml = generateWMSCapabilities(baseUrl);
  
  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * Transparent 1x1 PNG (base64 encoded)
 * Used as placeholder for GetMap responses
 */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Handle GetMap request
 * Returns a transparent PNG placeholder
 * 
 * Note: Full raster rendering requires MapServer/GeoServer.
 * For actual map display, use our MVT tile service at /tiles/{layer}/{z}/{x}/{y}.pbf
 * or use WFS for vector data.
 */
function handleGetMap(params: Record<string, string>) {
  // Validate required parameters
  const required = ['LAYERS', 'BBOX', 'WIDTH', 'HEIGHT', 'FORMAT'];
  const error = validateParams(params, required);
  
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const layers = params['LAYERS']?.toLowerCase().split(',');
  const format = params['FORMAT'];

  // Validate layers
  const validLayers = Object.keys(WMS_LAYERS);
  const invalidLayers = layers?.filter(l => !validLayers.includes(l));
  
  if (invalidLayers?.length) {
    return NextResponse.json(
      { error: `Invalid layers: ${invalidLayers.join(', ')}` },
      { status: 400 }
    );
  }

  // Return transparent PNG based on requested format
  const contentType = format.includes('jpeg') || format.includes('jpg') 
    ? 'image/jpeg' 
    : 'image/png';

  // Return transparent PNG
  return new NextResponse(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

/**
 * Handle GetFeatureInfo request
 * Returns information about features at a specific coordinate
 */
async function handleGetFeatureInfo(params: Record<string, string>) {
  const required = ['LAYERS', 'QUERY_LAYERS', 'BBOX', 'WIDTH', 'HEIGHT', 'X', 'Y'];
  const error = validateParams(params, required);
  
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const queryLayers = params['QUERY_LAYERS']?.toLowerCase().split(',');
  const bbox = params['BBOX']?.split(',').map(Number);
  const width = parseInt(params['WIDTH']);
  const height = parseInt(params['HEIGHT']);
  const x = parseInt(params['X']);
  const y = parseInt(params['Y']);
  const infoFormat = params['INFO_FORMAT'] || 'application/json';

  if (bbox.length !== 4) {
    return NextResponse.json(
      { error: 'Invalid BBOX format. Expected: minX,minY,maxX,maxY' },
      { status: 400 }
    );
  }

  // Calculate coordinate from pixel position
  const [minX, minY, maxX, maxY] = bbox;
  const lon = minX + (x / width) * (maxX - minX);
  const lat = maxY - (y / height) * (maxY - minY); // Y is from top in WMS

  try {
    // Query database for features at this coordinate
    const results: Record<string, unknown> = {};
    const sql = getDb();

    for (const layer of queryLayers) {
      let query;
      
      switch (layer) {
        case 'provinsi':
          query = sql`
            SELECT kode_prov, nama_provinsi 
            FROM provinsi 
            WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
            LIMIT 1
          `;
          break;
        case 'kabupaten':
          query = sql`
            SELECT kode_kab, nama_kabupaten 
            FROM kabupaten 
            WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
            LIMIT 1
          `;
          break;
        case 'kecamatan':
          query = sql`
            SELECT kode_kec, nama_kecamatan 
            FROM kecamatan 
            WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
            LIMIT 1
          `;
          break;
        case 'desa':
          query = sql`
            SELECT kode_desa, nama_desa 
            FROM desa 
            WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))
            LIMIT 1
          `;
          break;
        default:
          continue;
      }

      const data = await query;
      if (data.length > 0) {
        results[layer] = data[0];
      }
    }

    // Return in requested format
    if (infoFormat.includes('json')) {
      return NextResponse.json({
        type: 'FeatureInfo',
        coordinate: { lon, lat },
        layers: results,
      });
    } else {
      // Plain text format
      const text = Object.entries(results)
        .map(([layer, data]) => `${layer}: ${JSON.stringify(data)}`)
        .join('\n');
      
      return new NextResponse(text || 'No features found', {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  } catch (error) {
    console.error('GetFeatureInfo error:', error);
    return NextResponse.json(
      { error: 'Database query failed' },
      { status: 500 }
    );
  }
}
