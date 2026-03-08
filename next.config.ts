import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    turbopackUseSystemTlsCerts: true,
  },
}

export default nextConfig
