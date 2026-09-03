const DEFAULT_API_ORIGIN = "https://wilayah-id-api.dhanypedia.it.com";
const DEFAULT_TILES_ORIGIN = "https://tiles.dhanypedia.it.com";

type PublicEnvironment = Record<string, string | undefined>;

export type RuntimeRole = "proxy" | "origin";

export function getRuntimeRole(
  env: PublicEnvironment = process.env,
): RuntimeRole {
  const role = env.WILAYAH_RUNTIME_ROLE;

  if (role === undefined) {
    return "proxy";
  }

  if (role === "proxy" || role === "origin") {
    return role;
  }

  throw new TypeError("Invalid WILAYAH_RUNTIME_ROLE configuration");
}

function parsePublicUrl(
  variable: string,
  value: string,
  production: boolean,
) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${variable} must be a valid absolute URL`);
  }

  if (production && url.protocol !== "https:") {
    throw new TypeError(`${variable} must use HTTPS in production`);
  }

  return url;
}

export function getPublicOrigins(env: PublicEnvironment = process.env) {
  const production = env.NODE_ENV === "production";

  return {
    api: parsePublicUrl(
      "WILAYAH_API_ORIGIN",
      env.WILAYAH_API_ORIGIN ?? DEFAULT_API_ORIGIN,
      production,
    ),
    tiles: parsePublicUrl(
      "WILAYAH_TILES_ORIGIN",
      env.WILAYAH_TILES_ORIGIN ?? DEFAULT_TILES_ORIGIN,
      production,
    ),
    site: parsePublicUrl(
      "NEXT_PUBLIC_SITE_URL",
      env.NEXT_PUBLIC_SITE_URL ?? "https://wilayah-id-restapi.vercel.app",
      production,
    ),
  };
}

export function getAbsolutePublicUrl(
  path: string,
  env: PublicEnvironment = process.env,
) {
  return new URL(path, getPublicOrigins(env).site).href;
}
