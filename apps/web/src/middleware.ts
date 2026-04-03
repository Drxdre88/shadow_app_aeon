import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/demo', '/beta-terms']

export default auth((request) => {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/api/') || pathname.startsWith('/.well-known/') || pathname.startsWith('/share/')) {
    return NextResponse.next()
  }

  const isAuthenticated = !!request.auth

  if (pathname === '/') {
    const target = isAuthenticated ? '/dashboard' : '/login'
    return NextResponse.redirect(new URL(target, request.url))
  }

  if (!isAuthenticated) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|offline\\.html|aeon.*\\.png).*)'],
}
