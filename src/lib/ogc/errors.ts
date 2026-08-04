/**
 * OGC exception model shared by all spatial protocols.
 *
 * Codes follow the OWS/OGC API exception vocabulary. This module is
 * framework-free; route handlers translate OgcError into protocol-specific
 * responses (XML exception reports, JSON problem documents, and so on).
 */

export type OgcExceptionCode =
  | "MissingParameterValue"
  | "InvalidParameterValue"
  | "InvalidValue"
  | "OperationNotSupported"
  | "VersionNegotiationFailed"
  | "NotFound"
  | "NoApplicableCode";

const DEFAULT_HTTP_STATUS: Record<OgcExceptionCode, number> = {
  MissingParameterValue: 400,
  InvalidParameterValue: 400,
  InvalidValue: 400,
  OperationNotSupported: 400,
  VersionNegotiationFailed: 400,
  NotFound: 404,
  NoApplicableCode: 500,
};

export class OgcError extends Error {
  readonly code: OgcExceptionCode;
  readonly httpStatus: number;
  /** Name of the offending parameter, when applicable. */
  readonly locator?: string;

  constructor(
    code: OgcExceptionCode,
    message: string,
    options?: { httpStatus?: number; locator?: string },
  ) {
    super(message);
    this.name = "OgcError";
    this.code = code;
    this.httpStatus = options?.httpStatus ?? DEFAULT_HTTP_STATUS[code];
    this.locator = options?.locator;
  }
}

export function isOgcError(error: unknown): error is OgcError {
  return error instanceof OgcError;
}

/** Convenience constructor for rejected parameter values. */
export function invalidParameterValue(
  parameter: string,
  reason: string,
): OgcError {
  return new OgcError("InvalidParameterValue", reason, { locator: parameter });
}

/**
 * Sanitized wrapper for database failures. The raw driver error is logged
 * server-side only; callers receive a generic NoApplicableCode error and
 * never see connection strings, credentials, or schema details.
 */
export function sanitizedStoreError(operation: string, cause: unknown): OgcError {
  console.error(`OGC data store failure during ${operation}:`, cause);
  return new OgcError(
    "NoApplicableCode",
    "The data store could not complete the request",
  );
}
