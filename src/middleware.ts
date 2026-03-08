import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/demo']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const sessionToken =
    request.cookies.get('authjs.session-token')?.value ||
    request.cookies.get('__Secure-authjs.session-token')?.value

  if (pathname === '/') {
    const target = sessionToken ? '/dashboard' : '/login'
    return NextResponse.redirect(new URL(target, request.url))
  }

  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/api/') || pathname.startsWith('/.well-known/')) {
    return NextResponse.next()
  }

  if (!sessionToken) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
