import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.googleusercontent.com https://avatars.githubusercontent.com; font-src 'self' data:; connect-src 'self' https: wss://*.pusher.com; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com" },
]

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ['@aeon/shared'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // turbopackUseSystemTlsCerts was removed in Next 16.3 — system TLS certs
    // (needed on corp networks with TLS interception) are now the default.
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
  async rewrites() {
    // App Router won't serve a dot-prefixed folder, so map the OAuth discovery
    // well-knowns (and the resource-path-suffixed variants some MCP clients
    // probe) onto real /api routes.
    return [
      { source: '/.well-known/oauth-authorization-server', destination: '/api/well-known/oauth-authorization-server' },
      { source: '/.well-known/oauth-authorization-server/:path*', destination: '/api/well-known/oauth-authorization-server' },
      { source: '/.well-known/openid-configuration', destination: '/api/well-known/oauth-authorization-server' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/well-known/oauth-protected-resource' },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/well-known/oauth-protected-resource' },
    ]
  },
}

export default nextConfig
