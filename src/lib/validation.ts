/**
 * Validates kode wilayah format (Kemendagri administrative codes).
 * These are numeric string codes with fixed lengths per admin level.
 */

const KODE_PATTERNS: Record<string, RegExp> = {
  provinsi: /^\d{2}$/,
  kabupaten: /^\d{4}$/,
  kecamatan: /^\d{6}$/,
  desa: /^\d{10}$/,
};

/**
 * Validates a kode wilayah against expected format.
 * Returns null if valid, error message if invalid.
 */
export function validateKode(
  kode: string,
  level: keyof typeof KODE_PATTERNS
): string | null {
  if (!kode) {
    return `${level} code is required`;
  }

  const pattern = KODE_PATTERNS[level];
  if (!pattern) {
    return `Unknown admin level: ${level}`;
  }

  if (!pattern.test(kode)) {
    const expectedLength = level === "provinsi" ? 2
      : level === "kabupaten" ? 4
      : level === "kecamatan" ? 6
      : 10;
    return `Invalid ${level} code: expected ${expectedLength}-digit numeric string, got "${kode}"`;
  }

  return null;
}

/**
 * Validates latitude value (-11 to 6 for Indonesia).
 */
export function validateLat(lat: number): string | null {
  if (isNaN(lat) || lat < -11 || lat > 6) {
    return `Invalid latitude: expected value between -11 and 6, got ${lat}`;
  }
  return null;
}

/**
 * Validates longitude value (95 to 141 for Indonesia).
 */
export function validateLng(lng: number): string | null {
  if (isNaN(lng) || lng < 95 || lng > 141) {
    return `Invalid longitude: expected value between 95 and 141, got ${lng}`;
  }
  return null;
}

/**
 * Validates search query string.
 */
export function validateSearchQuery(q: string): string | null {
  if (!q || q.trim().length < 2) {
    return "Search query must be at least 2 characters";
  }
  if (q.length > 100) {
    return "Search query must be at most 100 characters";
  }
  return null;
}
