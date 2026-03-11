import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone()
  
  // Proxy API requests to the homeserver
  if (url.pathname.startsWith('/api/')) {
    const backendUrl = new URL(url.pathname + url.search, 'https://wilayah-id-api.dhanypedia.it.com')
    return NextResponse.rewrite(backendUrl)
  }
  
  // Proxy Tile requests to the homeserver's dedicated tile server
  if (url.pathname.startsWith('/tiles/')) {
    const backendUrl = new URL(url.pathname.replace('/tiles', '') + url.search, 'https://tiles.dhanypedia.it.com')
    return NextResponse.rewrite(backendUrl)
  }

  return NextResponse.next()
}

// Only run middleware on /api and /tiles paths
export const config = {
  matcher: ['/api/:path*', '/tiles/:path*'],
}
