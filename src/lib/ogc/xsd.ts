/**
 * XSD generation for WFS DescribeFeatureType.
 *
 * Builds an XML Schema for the advertised feature types directly from the
 * shared collection catalog, so the schema can never drift from the data
 * the repository actually serves. Column types follow the PostGIS schema:
 * identifier and name columns are strings, demographic counts are integers,
 * and area/density columns are doubles. Geometry is declared with the
 * generic gml:GeometryPropertyType because the GML writer emits whatever
 * geometry type each stored feature carries.
 */

import { create } from "xmlbuilder2";
import { COLLECTION_IDS, findCollection } from "./catalog";
import { invalidParameterValue } from "./errors";

export const WFS_NAMESPACE = "http://wilayah.id/wfs";

const DOUBLE_COLUMNS = new Set(["area_km2", "kepadatan", "luas_wilayah"]);

function xsdTypeForColumn(column: string): string {
  if (DOUBLE_COLUMNS.has(column)) {
    return "xs:double";
  }
  if (column.startsWith("jumlah_")) {
    return "xs:integer";
  }
  return "xs:string";
}

/**
 * Generates an XML Schema describing the requested feature types.
 * Throws OgcError InvalidParameterValue for any unknown type name; the
 * route handler maps it to an ows:ExceptionReport.
 */
export function generateFeatureTypeSchema(typeNames: string[]): string {
  const definitions = typeNames.map((name) => {
    const definition = findCollection(name.toLowerCase());
    if (!definition) {
      throw invalidParameterValue(
        "typeName",
        `Unknown feature type "${name}"; valid types are: ${COLLECTION_IDS.join(", ")}`,
      );
    }
    return definition;
  });

  const doc = create({ version: "1.0", encoding: "UTF-8" })
    .ele("xs:schema")
    .att("xmlns:xs", "http://www.w3.org/2001/XMLSchema")
    .att("xmlns:gml", "http://www.opengis.net/gml/3.2")
    .att("xmlns:app", WFS_NAMESPACE)
    .att("targetNamespace", WFS_NAMESPACE)
    .att("elementFormDefault", "qualified")
    .att("version", "2.0.0");

  doc
    .ele("xs:import")
    .att("namespace", "http://www.opengis.net/gml/3.2")
    .att("schemaLocation", "http://schemas.opengis.net/gml/3.2.1/gml.xsd");

  for (const definition of definitions) {
    const extension = doc
      .ele("xs:complexType")
      .att("name", `${definition.id}Type`)
      .ele("xs:complexContent")
      .ele("xs:extension")
      .att("base", "gml:AbstractFeatureType");
    const sequence = extension.ele("xs:sequence");

    sequence
      .ele("xs:element")
      .att("name", "geometry")
      .att("type", "gml:GeometryPropertyType")
      .att("minOccurs", "0");

    for (const column of definition.propertyColumns) {
      sequence
        .ele("xs:element")
        .att("name", column)
        .att("type", xsdTypeForColumn(column))
        .att("minOccurs", "0");
    }

    doc
      .ele("xs:element")
      .att("name", definition.id)
      .att("type", `app:${definition.id}Type`)
      .att("substitutionGroup", "gml:AbstractFeature");
  }

  return doc.end({ prettyPrint: true });
}
