# MCP deployment

## Authenticated edge architecture

Run the MCP runtime on the same private Docker network as the read-only
PostGIS role. The checked-in homeserver override runs Streamable HTTP on the
container's internal port `8000`; it adds no host port and no `cloudflared`
service. An existing, externally managed tunnel or authenticated reverse proxy
forwards only `/health`, `/mcp`, and `/artifacts/*` to that private service. Do not publish
the MCP container port, PostgreSQL, database ports, or raw API keys.

The override fails closed until both required variables are present. Copy
`deploy/.env.example` to the deployment environment and replace only the hash
placeholder and public HTTPS origin:

```dotenv
MCP_API_KEYS_SHA256=<64-character-sha256-hex>
MCP_PUBLIC_BASE_URL=https://wilayah-id-mcp-staging.dhanypedia.it.com
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

The REST API, OGC API Features, WFS, WMS, and vector tiles remain anonymous.
They do not accept or require `X-API-Key`. Only public MCP and `/artifacts/*`
require that header, and `GET /health` remains anonymous.

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
MCP_PUBLIC_BASE_URL=https://wilayah-id-mcp-staging.dhanypedia.it.com \
  docker compose \
    -f docker-compose.yml \
    -f deploy/docker-compose.homeserver.mcp.yml \
    config --quiet
```

Inspect the rendered configuration as part of the same review and confirm that
the homeserver override has not introduced published port `8000` or a PostGIS
port. Do not run `up`, `build`, Podman, or any Cloudflare management command as
part of this validation.
