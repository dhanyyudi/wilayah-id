/**
 * OGC (Open Geospatial Consortium) Utilities
 * Standards: WMS 1.3.0, WFS 2.0.0
 */

import { create } from 'xmlbuilder2';

// WMS Layer Configuration
export const WMS_LAYERS = {
  provinsi: {
    name: 'provinsi',
    title: 'Batas Provinsi Indonesia',
    abstract: 'Administrative boundary of Indonesian provinces',
    bbox: [95.0, -11.0, 141.0, 6.0], // [minX, minY, maxX, maxY]
    srs: 'EPSG:4326',
  },
  kabupaten: {
    name: 'kabupaten',
    title: 'Batas Kabupaten/Kota Indonesia',
    abstract: 'Administrative boundary of Indonesian regencies/cities',
    bbox: [95.0, -11.0, 141.0, 6.0],
    srs: 'EPSG:4326',
  },
  kecamatan: {
    name: 'kecamatan',
    title: 'Batas Kecamatan Indonesia',
    abstract: 'Administrative boundary of Indonesian districts',
    bbox: [95.0, -11.0, 141.0, 6.0],
    srs: 'EPSG:4326',
  },
  desa: {
    name: 'desa',
    title: 'Batas Desa/Kelurahan Indonesia',
    abstract: 'Administrative boundary of Indonesian villages',
    bbox: [95.0, -11.0, 141.0, 6.0],
    srs: 'EPSG:4326',
  },
} as const;

// WFS Feature Types
export const WFS_FEATURE_TYPES = {
  provinces: {
    name: 'provinces',
    title: 'Provinces',
    abstract: 'Indonesian provinces with geometry',
    properties: ['kode_prov', 'nama_provinsi', 'geometry'],
  },
  regencies: {
    name: 'regencies',
    title: 'Regencies/Cities',
    abstract: 'Indonesian regencies and cities with geometry',
    properties: ['kode_kab', 'nama_kabupaten', 'kode_prov', 'geometry'],
  },
  districts: {
    name: 'districts',
    title: 'Districts',
    abstract: 'Indonesian districts with geometry',
    properties: ['kode_kec', 'nama_kecamatan', 'kode_kab', 'geometry'],
  },
  villages: {
    name: 'villages',
    title: 'Villages',
    abstract: 'Indonesian villages with geometry',
    properties: ['kode_desa', 'nama_desa', 'kode_kec', 'geometry'],
  },
} as const;

/**
 * Generate WMS GetCapabilities XML
 */
export function generateWMSCapabilities(baseUrl: string): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('http://www.opengis.net/wms', 'WMS_Capabilities')
    .att('version', '1.3.0')
    .att('xmlns', 'http://www.opengis.net/wms')
    .att('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');

  // Service metadata
  const service = doc.ele('Service');
  service.ele('Name').txt('WMS');
  service.ele('Title').txt('wilayah-id WMS Service');
  service.ele('Abstract').txt('Web Map Service for Indonesian Administrative Boundaries');
  service.ele('OnlineResource').att('xlink:href', baseUrl);
  service.ele('ContactInformation')
    .ele('ContactPersonPrimary')
      .ele('ContactPerson').txt('Administrator').up()
      .ele('ContactOrganization').txt('wilayah-id');

  // Capability metadata
  const capability = doc.ele('Capability');
  const request = capability.ele('Request');

  // GetCapabilities
  const getCap = request.ele('GetCapabilities');
  getCap.ele('Format').txt('text/xml');
  getCap.ele('DCPType')
    .ele('HTTP')
      .ele('Get')
        .ele('OnlineResource').att('xlink:href', `${baseUrl}/api/v1/ogc/wms`);

  // GetMap
  const getMap = request.ele('GetMap');
  ['image/png', 'image/jpeg', 'image/gif'].forEach(fmt => {
    getMap.ele('Format').txt(fmt);
  });
  getMap.ele('DCPType')
    .ele('HTTP')
      .ele('Get')
        .ele('OnlineResource').att('xlink:href', `${baseUrl}/api/v1/ogc/wms`);

  // GetFeatureInfo
  const getFeatInfo = request.ele('GetFeatureInfo');
  ['text/plain', 'text/html', 'application/json'].forEach(fmt => {
    getFeatInfo.ele('Format').txt(fmt);
  });
  getFeatInfo.ele('DCPType')
    .ele('HTTP')
      .ele('Get')
        .ele('OnlineResource').att('xlink:href', `${baseUrl}/api/v1/ogc/wms`);

  // Layers
  const layerRoot = capability.ele('Layer');
  layerRoot.ele('Title').txt('wilayah-id Layers');
  layerRoot.ele('CRS').txt('EPSG:4326');
  layerRoot.ele('EX_GeographicBoundingBox')
    .ele('westBoundLongitude').txt('95').up()
    .ele('eastBoundLongitude').txt('141').up()
    .ele('southBoundLatitude').txt('-11').up()
    .ele('northBoundLatitude').txt('6');

  // Add each layer
  Object.values(WMS_LAYERS).forEach(layer => {
    const layerEle = layerRoot.ele('Layer').att('queryable', '1');
    layerEle.ele('Name').txt(layer.name);
    layerEle.ele('Title').txt(layer.title);
    layerEle.ele('Abstract').txt(layer.abstract);
    layerEle.ele('CRS').txt(layer.srs);
    layerEle.ele('EX_GeographicBoundingBox')
      .ele('westBoundLongitude').txt(String(layer.bbox[0])).up()
      .ele('eastBoundLongitude').txt(String(layer.bbox[2])).up()
      .ele('southBoundLatitude').txt(String(layer.bbox[1])).up()
      .ele('northBoundLatitude').txt(String(layer.bbox[3]));
    layerEle.ele('BoundingBox')
      .att('CRS', layer.srs)
      .att('minx', String(layer.bbox[0]))
      .att('miny', String(layer.bbox[1]))
      .att('maxx', String(layer.bbox[2]))
      .att('maxy', String(layer.bbox[3]));
  });

  return doc.end({ prettyPrint: true });
}

/**
 * Generate WFS GetCapabilities XML
 */
export function generateWFSCapabilities(baseUrl: string): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('http://www.opengis.net/wfs/2.0', 'WFS_Capabilities')
    .att('version', '2.0.0')
    .att('xmlns', 'http://www.opengis.net/wfs/2.0')
    .att('xmlns:ows', 'http://www.opengis.net/ows/1.1')
    .att('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
    .att('xmlns:fes', 'http://www.opengis.net/fes/2.0');

  // Service identification
  const serviceId = doc.ele('ows:ServiceIdentification');
  serviceId.ele('ows:Title').txt('wilayah-id WFS Service');
  serviceId.ele('ows:Abstract').txt('Web Feature Service for Indonesian Administrative Boundaries');
  serviceId.ele('ows:ServiceType').txt('WFS');
  serviceId.ele('ows:ServiceTypeVersion').txt('1.1.0');
  serviceId.ele('ows:ServiceTypeVersion').txt('2.0.0');

  // Operations metadata
  const opsMeta = doc.ele('ows:OperationsMetadata');
  
  ['GetCapabilities', 'DescribeFeatureType', 'GetFeature'].forEach(op => {
    const operation = opsMeta.ele('ows:Operation').att('name', op);
    const get = operation.ele('ows:DCP').ele('ows:HTTP').ele('ows:Get');
    get.att('xlink:href', `${baseUrl}/api/v1/ogc/wfs`);
  });

  // Feature catalog
  const featureCatalog = doc.ele('FeatureTypeList');
  Object.values(WFS_FEATURE_TYPES).forEach(ft => {
    const ftEle = featureCatalog.ele('FeatureType');
    ftEle.ele('Name').txt(ft.name);
    ftEle.ele('Title').txt(ft.title);
    ftEle.ele('Abstract').txt(ft.abstract);
    ftEle.ele('DefaultCRS').txt('urn:ogc:def:crs:EPSG::4326');
    ftEle.ele('ows:WGS84BoundingBox')
      .ele('ows:LowerCorner').txt('95 -11').up()
      .ele('ows:UpperCorner').txt('141 6');
  });

  return doc.end({ prettyPrint: true });
}

/**
 * Parse WMS/WFS request parameters
 */
export function parseOGCParams(searchParams: URLSearchParams): Record<string, string> {
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    params[key.toUpperCase()] = value;
  });
  return params;
}

/**
 * Validate required parameters
 */
export function validateParams(params: Record<string, string>, required: string[]): string | null {
  for (const param of required) {
    if (!params[param]) {
      return `Missing required parameter: ${param}`;
    }
  }
  return null;
}
