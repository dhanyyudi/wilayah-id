/**
 * GML (Geography Markup Language) Utilities
 * Converts GeoJSON to GML format for WFS responses
 */

import { create } from 'xmlbuilder2';

interface GeoJSONFeature {
  type: 'Feature';
  id?: string | number;
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, unknown>;
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  totalFeatures?: number;
  features: GeoJSONFeature[];
}

/**
 * Generate GML 3.2 FeatureCollection from GeoJSON
 */
export function geoJSONToGML(
  geojson: GeoJSONFeatureCollection,
  featureType: string,
  namespace = 'http://wilayah.id/wfs'
): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('http://www.opengis.net/wfs/2.0', 'FeatureCollection')
    .att('xmlns', 'http://www.opengis.net/wfs/2.0')
    .att('xmlns:wfs', 'http://www.opengis.net/wfs/2.0')
    .att('xmlns:gml', 'http://www.opengis.net/gml/3.2')
    .att('xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance')
    .att('xmlns:app', namespace)
    .att('xsi:schemaLocation', 'http://www.opengis.net/wfs/2.0 http://schemas.opengis.net/wfs/2.0/wfs.xsd')
    .att('numberMatched', String(geojson.features.length))
    .att('numberReturned', String(geojson.features.length));

  // Add boundedBy if we have features
  if (geojson.features.length > 0) {
    const bounds = calculateBounds(geojson.features);
    const boundedBy = doc.ele('gml:boundedBy');
    const envelope = boundedBy.ele('gml:Envelope').att('srsName', 'urn:ogc:def:crs:EPSG::4326');
    envelope.ele('gml:lowerCorner').txt(`${bounds.minX} ${bounds.minY}`);
    envelope.ele('gml:upperCorner').txt(`${bounds.maxX} ${bounds.maxY}`);
  }

  // Add features
  geojson.features.forEach((feature, index) => {
    const member = doc.ele('wfs:member');
    const featureEle = member.ele('app:' + featureType).att('gml:id', String(feature.id || `${featureType}_${index}`));
    
    // Add geometry
    if (feature.geometry) {
      const geomEle = featureEle.ele('app:geometry');
      appendGeometry(geomEle, feature.geometry);
    }
    
    // Add properties
    Object.entries(feature.properties).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        featureEle.ele(`app:${key}`).txt(String(value));
      }
    });
  });

  return doc.end({ prettyPrint: true });
}

/**
 * Append geometry element in GML format
 */
function appendGeometry(parent: any, geometry: GeoJSONFeature['geometry']) {
  const gml = parent.ele('gml:' + geometry.type);
  
  switch (geometry.type) {
    case 'Point': {
      const coords = geometry.coordinates as number[];
      gml.ele('gml:pos').txt(`${coords[0]} ${coords[1]}`);
      break;
    }
    
    case 'LineString': {
      const coords = geometry.coordinates as number[][];
      const posList = coords.map(c => `${c[0]} ${c[1]}`).join(' ');
      gml.ele('gml:posList').txt(posList);
      break;
    }
    
    case 'Polygon': {
      const rings = geometry.coordinates as number[][][];
      rings.forEach((ring, index) => {
        const ringEle = index === 0 
          ? gml.ele('gml:exterior').ele('gml:LinearRing')
          : gml.ele('gml:interior').ele('gml:LinearRing');
        const posList = ring.map(c => `${c[0]} ${c[1]}`).join(' ');
        ringEle.ele('gml:posList').txt(posList);
      });
      break;
    }
    
    case 'MultiPolygon': {
      const polygons = (geometry.coordinates as unknown) as number[][][][];
      polygons.forEach(polygon => {
        const polygonEle = gml.ele('gml:polygonMember').ele('gml:Polygon');
        polygon.forEach((ring, index) => {
          const ringEle = index === 0
            ? polygonEle.ele('gml:exterior').ele('gml:LinearRing')
            : polygonEle.ele('gml:interior').ele('gml:LinearRing');
          const posList = ring.map(c => `${c[0]} ${c[1]}`).join(' ');
          ringEle.ele('gml:posList').txt(posList);
        });
      });
      break;
    }
    
    case 'MultiPoint': {
      const points = geometry.coordinates as number[][];
      points.forEach(point => {
        const pointEle = gml.ele('gml:pointMember').ele('gml:Point');
        pointEle.ele('gml:pos').txt(`${point[0]} ${point[1]}`);
      });
      break;
    }
    
    case 'MultiLineString': {
      const lines = geometry.coordinates as number[][][];
      lines.forEach(line => {
        const lineEle = gml.ele('gml:lineStringMember').ele('gml:LineString');
        const posList = line.map(c => `${c[0]} ${c[1]}`).join(' ');
        lineEle.ele('gml:posList').txt(posList);
      });
      break;
    }
  }
}

/**
 * Calculate bounds from features
 */
function calculateBounds(features: GeoJSONFeature[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  features.forEach(feature => {
    const coords = extractCoordinates(feature.geometry);
    coords.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
  });
  
  return { minX, minY, maxX, maxY };
}

/**
 * Extract all coordinates from geometry
 */
function extractCoordinates(geometry: GeoJSONFeature['geometry']): number[][] {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates as number[]];
    case 'LineString':
    case 'MultiPoint':
      return geometry.coordinates as number[][];
    case 'Polygon':
      return (geometry.coordinates as number[][][]).flat();
    case 'MultiLineString':
      return (geometry.coordinates as number[][][]).flat();
    case 'MultiPolygon':
      return ((geometry.coordinates as unknown) as number[][][][]).flat(2);
    default:
      return [];
  }
}

/**
 * Generate GML Schema for feature type
 */
export function generateGMLSchema(featureType: string, properties: string[]): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('xs:schema')
    .att('xmlns:xs', 'http://www.w3.org/2001/XMLSchema')
    .att('xmlns:gml', 'http://www.opengis.net/gml/3.2')
    .att('xmlns:app', 'http://wilayah.id/wfs')
    .att('targetNamespace', 'http://wilayah.id/wfs')
    .att('elementFormDefault', 'qualified');

  // Import GML schema
  doc.ele('xs:import')
    .att('namespace', 'http://www.opengis.net/gml/3.2')
    .att('schemaLocation', 'http://schemas.opengis.net/gml/3.2.1/gml.xsd');

  // Define feature type
  const complexType = doc.ele('xs:complexType').att('name', `${featureType}Type`);
  const complexContent = complexType.ele('xs:complexContent');
  const extension = complexContent.ele('xs:extension').att('base', 'gml:AbstractFeatureType');
  const sequence = extension.ele('xs:sequence');
  
  // Add geometry property
  sequence.ele('xs:element')
    .att('name', 'geometry')
    .att('type', 'gml:GeometryPropertyType')
    .att('minOccurs', '0');
  
  // Add other properties
  properties.forEach(prop => {
    if (prop !== 'geometry') {
      sequence.ele('xs:element')
        .att('name', prop)
        .att('type', 'xs:string')
        .att('minOccurs', '0')
        .att('maxOccurs', '1');
    }
  });

  // Define element
  doc.ele('xs:element')
    .att('name', featureType)
    .att('type', `app:${featureType}Type`)
    .att('substitutionGroup', 'gml:AbstractFeature');

  return doc.end({ prettyPrint: true });
}
