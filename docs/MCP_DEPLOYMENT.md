# MCP deployment

## Authenticated edge architecture

Run the MCP runtime on the same private Docker network as the read-only
PostGIS role. The checked-in homeserver override runs Streamable HTTP on the
container's internal port `8000`; it resets the loopback port inherited from
the local Compose file with `ports: !reset []` and adds no `cloudflared`
service. An existing, externally managed tunnel or authenticated reverse proxy
forwards only `/health`, `/mcp`, and `/artifacts/*` to that private service. Do not publish
the MCP container port, PostgreSQL, database ports, or raw API keys.

The override fails closed until both required variables are present. Copy
`deploy/.env.example` to the deployment environment and replace only the hash
placeholder and public HTTPS origin:

```dotenv
MCP_API_KEYS_SHA256=<64-character-sha256-hex>
MCP_PUBLIC_BASE_URL=https://wilayah-id-mcp-staging.dhanypedia.com
```

`MCP_API_KEYS_SHA256` contains one or more comma-separated SHA-256 hashes. The
raw key belongs only in a password manager and in the client environment. It
must never be committed, added to this example file, logged, or copied into an
edge configuration.

## Client authentication and rotation

Clients send the raw key only in the `X-API-Key` header. `/health` is
anonymous and returns `{"status":"ok"}`. `/mcp` and `/artifacts/*` require a
valid key. All of these responses have a `Cache-Control` value containing
`no-store`.

The REST API, OGC API Features, WFS, WMS, and vector tiles remain usable
without a key. Only public MCP and `/artifacts/*` require `X-API-Key`, and
`GET /health` remains anonymous.

## Key tiers and rate limits

Two kinds of key are accepted:

- **Owner keys** are the raw keys whose SHA-256 hashes are listed in
  `MCP_API_KEYS_SHA256` (MCP) and `WILAYAH_OWNER_KEYS_SHA256` (REST and OGC).
  They skip the public limits and only meet a safety cap of 3,000 requests
  per minute. Use one key per application so a leaked key can be removed
  without affecting the others, and keep them out of browser code.
- **Issued keys** are created by visitors on the `/keys` page. They are
  stateless: the server signs them with `WILAYAH_KEY_SIGNING_SECRET` and does
  not store them. They are accepted only when that secret is configured, and
  they never grant the owner tier.

Default limits per minute:

| Caller | REST and OGC | Heavy REST and OGC | MCP requests | Artifact downloads |
|--------|--------------|--------------------|--------------|--------------------|
| No key (per address) | 60 | 10 | not allowed | not allowed |
| Issued key | 300, and 20,000 per day | 60 | 120 | 10 |
| Owner key | 3,000 | 3,000 | 3,000 | 3,000 |

Heavy requests are WMS `GetMap`, WFS `GetFeature`, OGC API Features items, and
boundary requests with `geometry=true`. A caller over its limit receives HTTP
429 with `Retry-After`. Counters live in the memory of each container and
reset when it restarts. REST and OGC enforcement is off unless
`WILAYAH_RATE_LIMIT_ENABLED=true`; MCP limits are always applied.

An issued key cannot be listed or edited after creation. To refuse one, add
its id to `WILAYAH_REVOKED_KEY_IDS` and recreate both services; the id is
written to the API log when the key is created. Rotating
`WILAYAH_KEY_SIGNING_SECRET` invalidates every issued key at once.

The web Worker proxies `/api/*` to this origin, so the origin would otherwise
see one shared Cloudflare address for every map visitor. Set the same
`WILAYAH_PROXY_TOKEN` on the origin and as a Worker secret; the Worker then
forwards the visitor address and the origin trusts it only with that token:

```bash
pnpm exec wrangler secret put WILAYAH_PROXY_TOKEN
```

The limits can be tuned with `WILAYAH_LIMIT_*` (see `.env.example`) and, for
MCP, `MCP_LIMIT_KEY_PER_MINUTE`, `MCP_LIMIT_KEY_ARTIFACTS_PER_MINUTE`, and
`MCP_LIMIT_OWNER_PER_MINUTE`.

Rotate keys by deploying both the old and new SHA-256 hashes as a comma-
separated value during the overlap period. Update every client to use the new
raw key, verify the edge, then deploy again with only the new hash. This
preserves access during client rollout without ever publishing either raw key.

## Public acceptance check

Run this only from a trusted client environment after the existing edge route
has been configured. It reads its URL and raw key exclusively from environment
variables, does not print request headers or the key, and exits nonzero on any
contract mismatch:

```bash
MCP_BASE_URL=https://public-mcp.example.invalid \
MCP_API_KEY=... \
  python scripts/check-mcp-edge.py
```

The check verifies anonymous health, missing and wrong key rejection,
authorization before artifact path resolution, authenticated artifact 404s,
the no-cache contract for authenticated MCP traffic, and the seven generic
plus five compatibility MCP tools.

## Static Compose validation

Validate the override without starting or building a container:

```bash
MCP_API_KEYS_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
MCP_PUBLIC_BASE_URL=https://wilayah-id-mcp-staging.dhanypedia.com \
  docker compose \
    -f docker-compose.yml \
    -f deploy/docker-compose.homeserver.mcp.yml \
    config --quiet
```

Inspect the rendered configuration as part of the same review and confirm that
the homeserver override resets the inherited loopback port with explicit
`ports: !reset []`. No published port `8000` or PostGIS port should appear in
the merged output. Do not run `up`, `build`, or any Cloudflare management
command as part of this validation.
