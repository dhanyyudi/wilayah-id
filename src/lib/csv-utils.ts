type CSVRecord = Record<string, unknown>;

function formatCSVValue(value: unknown): string {
  if (typeof value === "string" && value.includes(",")) {
    return `"${value}"`;
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

export function serializeCSV(items: readonly CSVRecord[]): string {
  if (items.length === 0) return "";

  const headers = Object.keys(items[0]).filter(
    (header) => header !== "geom" && header !== "geometry",
  );
  return [
    headers.join(","),
    ...items.map((item) =>
      headers.map((header) => formatCSVValue(item[header])).join(","),
    ),
  ].join("\n");
}
