# Spatial Interoperability

This context defines the dataset-independent language exposed by the geospatial
MCP interface. Wilayah-ID is one dataset and adapter within this context.

## Language

**Dataset**:
A governed collection of spatial layers that shares source, snapshot, and
provenance metadata.
_Avoid_: Database, schema, portal

**Layer**:
A named collection of spatial entities with a common geometry type, coordinate
reference system, and attribute vocabulary.
_Avoid_: Table, endpoint

**Spatial Entity**:
One identifiable geographic feature belonging to a dataset layer.
_Avoid_: Row, record, administrative object

**FeatureRef**:
A canonical reference composed of dataset identifier, layer identifier, and
feature identifier.
_Avoid_: Database ID, table key

**Spatial Relation**:
A declared topological, metric, hierarchical, or directional relationship
between spatial entities.
_Avoid_: Spatial reasoning result

**Containment Policy**:
The declared rule for whether a feature boundary is included when locating a
coordinate or testing containment.
_Avoid_: Point-in-polygon mode

**Area of Interest (AOI)**:
A geometry that limits the spatial scope of a query without becoming part of
the source dataset.
_Avoid_: Selection box, crop boundary

**Spatial Subset**:
A bounded collection of source features selected or clipped using an AOI and a
declared spatial predicate.
_Avoid_: Dataset copy, manual crop

**Artifact**:
A temporary downloadable representation of a spatial subset, accompanied by
format, checksum, size, expiry, and provenance metadata.
_Avoid_: Source dataset, permanent publication

**Provenance**:
The source, snapshot, and processing lineage needed to interpret and reproduce
a spatial result or artifact.
_Avoid_: Attribution only
