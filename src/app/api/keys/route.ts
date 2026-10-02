import { NextResponse } from "next/server";
import { getAccessConfig } from "@/lib/access/config";
import type { AccessConfig } from "@/lib/access/config";
import { issueApiKey } from "@/lib/access/keys";

// The policy and signing secret come from the runtime environment.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 2_048;

function publicPolicy(config: AccessConfig) {
  return {
    enforced: config.enabled,
    issuance: config.signingSecret !== null,
    key_ttl_days: Math.round(config.keyTtlSeconds / 86_400),
    limits: {
      anonymous: {
        per_minute: config.limits.anonymousPerMinute,
        heavy_per_minute: config.limits.anonymousHeavyPerMinute,
      },
      free_key: {
        per_minute: config.limits.keyPerMinute,
        heavy_per_minute: config.limits.keyHeavyPerMinute,
        per_day: config.limits.keyPerDay,
      },
      key_creation_per_day: config.limits.keyIssuePerDay,
    },
  };
}

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    { status: "error", code: status, error: { code, message } },
    { status, headers: NO_STORE },
  );
}

/** Keep log lines single-line and bounded whatever the caller sent. */
function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length > 0 && cleaned.length <= maxLength ? cleaned : null;
}

export function GET() {
  return NextResponse.json(
    { data: publicPolicy(getAccessConfig()) },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request) {
  const config = getAccessConfig();
  if (!config.signingSecret) {
    return failure(
      503,
      "KEY_ISSUANCE_UNAVAILABLE",
      "API key creation is not configured on this server.",
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return failure(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("not an object");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return failure(400, "INVALID_BODY", "Send a JSON object.");
  }

  const label = cleanText(body.label, 60);
  if (!label || label.length < 3) {
    return failure(
      400,
      "INVALID_LABEL",
      "label must be 3 to 60 characters describing the application.",
    );
  }
  const contact =
    body.contact === undefined || body.contact === ""
      ? null
      : cleanText(body.contact, 120);
  if (body.contact !== undefined && body.contact !== "" && !contact) {
    return failure(400, "INVALID_CONTACT", "contact must be at most 120 characters.");
  }

  const { key, claims } = await issueApiKey({
    secret: config.signingSecret,
    ttlSeconds: config.keyTtlSeconds,
    now: Date.now(),
  });

  // The key itself is never logged; the id is enough to revoke it later.
  console.info(
    JSON.stringify({
      event: "api_key_issued",
      key_id: claims.id,
      label,
      contact,
      expires_at: new Date(claims.expiresAt * 1000).toISOString(),
    }),
  );

  return NextResponse.json(
    {
      data: {
        key,
        key_id: claims.id,
        tier: claims.tier,
        expires_at: new Date(claims.expiresAt * 1000).toISOString(),
        ...publicPolicy(config),
      },
    },
    { status: 201, headers: NO_STORE },
  );
}
