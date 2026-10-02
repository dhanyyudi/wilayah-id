import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAccessConfig } from "@/lib/access/config";
import {
  evaluateAccess,
  PROXY_CLIENT_IP_HEADER,
  PROXY_TOKEN_HEADER,
} from "@/lib/access/policy";
import { getSharedLimiter } from "@/lib/access/rate-limit";
import { getPublicOrigins, getRuntimeRole } from "@/lib/public-config";

/**
 * Forward the visitor address to the API origin. The origin only trusts it
 * when the shared proxy token matches, so client-supplied copies are dropped.
 */
function proxyRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete(PROXY_TOKEN_HEADER);
  headers.delete(PROXY_CLIENT_IP_HEADER);

  const proxyToken = process.env.WILAYAH_PROXY_TOKEN;
  const clientIp = request.headers.get("cf-connecting-ip");
  if (proxyToken && clientIp) {
    headers.set(PROXY_TOKEN_HEADER, proxyToken);
    headers.set(PROXY_CLIENT_IP_HEADER, clientIp);
  }
  return headers;
}

// Keep the legacy middleware convention while OpenNext requires Edge middleware.
export async function middleware(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname === "/api/health") {
    return NextResponse.next();
  }

  const runtimeRole = getRuntimeRole();

  if (url.pathname.startsWith("/api/")) {
    if (runtimeRole === "origin") {
      const decision = await evaluateAccess(
        {
          method: request.method,
          pathname: url.pathname,
          searchParams: url.searchParams,
          headers: request.headers,
        },
        getAccessConfig(),
        getSharedLimiter(),
        Date.now(),
      );

      if (decision.action === "reject") {
        return NextResponse.json(
          {
            status: "error",
            code: decision.status,
            error: { code: decision.code, message: decision.message },
          },
          { status: decision.status, headers: decision.headers },
        );
      }
      return NextResponse.next({ headers: decision.headers });
    }

    const origins = getPublicOrigins();
    return NextResponse.rewrite(
      new URL(`${url.pathname}${url.search}`, origins.api),
      { request: { headers: proxyRequestHeaders(request) } },
    );
  }

  if (url.pathname.startsWith("/tiles/")) {
    const origins = getPublicOrigins();
    const tilePath = url.pathname.slice("/tiles".length);
    return NextResponse.rewrite(
      new URL(`${tilePath}${url.search}`, origins.tiles),
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/tiles/:path*"],
};
