type AccessEnvironment = Record<string, string | undefined>;

export interface AccessLimits {
  anonymousPerMinute: number;
  anonymousHeavyPerMinute: number;
  keyPerMinute: number;
  keyHeavyPerMinute: number;
  keyPerDay: number;
  ownerPerMinute: number;
  keyIssuePerDay: number;
}

export interface AccessConfig {
  enabled: boolean;
  signingSecret: string | null;
  ownerKeyHashes: string[];
  ownerAllowedIps: string[];
  revokedKeyIds: ReadonlySet<string>;
  proxyToken: string | null;
  keyTtlSeconds: number;
  limits: AccessLimits;
}

const MIN_SECRET_LENGTH = 32;

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(
  env: AccessEnvironment,
  variable: string,
  fallback: number,
): number {
  const raw = env[variable];
  if (raw === undefined) {
    return fallback;
  }
  if (!/^[1-9]\d{0,8}$/.test(raw)) {
    throw new TypeError(`${variable} must be a positive integer`);
  }
  return Number(raw);
}

function secret(env: AccessEnvironment, variable: string): string | null {
  const raw = env[variable];
  if (raw === undefined || raw === "") {
    return null;
  }
  if (raw.length < MIN_SECRET_LENGTH) {
    throw new TypeError(
      `${variable} must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return raw;
}

function enabledFlag(env: AccessEnvironment): boolean {
  const raw = env.WILAYAH_RATE_LIMIT_ENABLED;
  if (raw === undefined || raw === "false") {
    return false;
  }
  if (raw === "true") {
    return true;
  }
  throw new TypeError("WILAYAH_RATE_LIMIT_ENABLED must be true or false");
}

/** Read the access policy; invalid explicit values fail closed. */
export function getAccessConfig(
  env: AccessEnvironment = process.env,
): AccessConfig {
  const ownerKeyHashes = csv(env.WILAYAH_OWNER_KEYS_SHA256).map((value) =>
    value.toLowerCase(),
  );
  if (ownerKeyHashes.some((value) => !/^[0-9a-f]{64}$/.test(value))) {
    throw new TypeError(
      "WILAYAH_OWNER_KEYS_SHA256 must contain hexadecimal SHA-256 digests",
    );
  }

  return {
    enabled: enabledFlag(env),
    signingSecret: secret(env, "WILAYAH_KEY_SIGNING_SECRET"),
    ownerKeyHashes,
    ownerAllowedIps: csv(env.WILAYAH_OWNER_ALLOWED_IPS),
    revokedKeyIds: new Set(csv(env.WILAYAH_REVOKED_KEY_IDS)),
    proxyToken: secret(env, "WILAYAH_PROXY_TOKEN"),
    keyTtlSeconds:
      positiveInteger(env, "WILAYAH_KEY_TTL_DAYS", 365) * 24 * 60 * 60,
    limits: {
      anonymousPerMinute: positiveInteger(
        env,
        "WILAYAH_LIMIT_ANON_PER_MINUTE",
        60,
      ),
      anonymousHeavyPerMinute: positiveInteger(
        env,
        "WILAYAH_LIMIT_ANON_HEAVY_PER_MINUTE",
        10,
      ),
      keyPerMinute: positiveInteger(env, "WILAYAH_LIMIT_KEY_PER_MINUTE", 300),
      keyHeavyPerMinute: positiveInteger(
        env,
        "WILAYAH_LIMIT_KEY_HEAVY_PER_MINUTE",
        60,
      ),
      keyPerDay: positiveInteger(env, "WILAYAH_LIMIT_KEY_PER_DAY", 20_000),
      ownerPerMinute: positiveInteger(
        env,
        "WILAYAH_LIMIT_OWNER_PER_MINUTE",
        3_000,
      ),
      keyIssuePerDay: positiveInteger(
        env,
        "WILAYAH_LIMIT_KEY_ISSUE_PER_DAY",
        5,
      ),
    },
  };
}
