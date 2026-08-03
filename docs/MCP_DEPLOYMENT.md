# MCP deployment

## Recommended topology

Run the MCP runtime on the same private Docker network as the read-only
PostGIS role. Publish only the Streamable HTTP endpoint through a Cloudflare
Tunnel (or an equivalent authenticated reverse proxy). Do not publish
PostgreSQL or the container port directly.

A typical server-side layout consists of:

- an application source checkout of this repository;
- a runtime Compose project directory that holds the deployment overrides;
- the MCP build context at `mcp/` inside the source checkout;
- a shared private Docker network between the MCP container and PostGIS.

The checked-in override `deploy/docker-compose.homeserver.mcp.yml` converts
the `wilayah-id-mcp` service from an idle stdio process to Streamable HTTP on
internal port `8000`. The port is not published on the host. Spatial subset
artifacts are ephemeral files under `/tmp/wilayah-mcp-artifacts` in the
container and expire after 15 minutes by default.

## Deploying an update

From the application source checkout on the server, after the desired commit
is on `main`:

```bash
git status --short
git pull --ff-only origin main

# Copy the checked-in override into the runtime Compose project, then:
docker compose \
  -f docker-compose.yml \
  -f docker-compose.mcp.yml \
  up -d --build --no-deps wilayah-id-mcp
docker compose \
  -f docker-compose.yml \
  -f docker-compose.mcp.yml \
  ps wilayah-id-mcp
docker logs --tail 50 wilayah-id-mcp
```

If `git status --short` is not empty, preserve or commit the server-side
change before pulling. Never reset an unknown server-side modification.

The MCP endpoint within the private Docker network is:

```text
http://wilayah-id-mcp:8000/mcp
```

Artifact URLs returned by `extract_spatial_subset` use the same HTTP origin:

```text
http://wilayah-id-mcp:8000/artifacts/{artifact_id}/{filename}
```

Set `MCP_PUBLIC_BASE_URL` to the externally reachable origin only after the
public exposure gate below is complete. If it is unset, tool responses provide
`relative_url` and leave `download_url` empty. A production reverse proxy or
Tunnel route must forward both `/mcp` and `/artifacts/*` to the same service.

Direct execution still defaults to stdio:

```bash
cd mcp
python server.py
```

## Public exposure gate

Before creating public DNS or a Cloudflare Tunnel route:

1. map the hostname only to `http://wilayah-id-mcp:8000`, including `/mcp` and
   `/artifacts/*`;
2. apply Cloudflare Access or equivalent token-based authentication;
3. add rate limits and request-size limits;
4. retain the read-only database role and statement timeout;
5. validate the public URL with MCP Inspector and a real client;
6. monitor error rate, latency, and unusual tool-call volume;
7. configure `MCP_PUBLIC_BASE_URL` with the authenticated HTTPS origin and
   verify that expired and path-traversal artifact requests return 404.

The older `/sse` URL is a legacy transport and is not the default for this
deployment.

For a deliberately anonymous research demo, use an isolated hostname and
dataset, strict rate limits, and no sensitive or write-capable tools.
