const CACHE_NAME = 'aeon-v3'
const STATIC_EXTENSIONS = /\.(js|css|woff2?|ttf|png|svg|ico|webp)$/
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/webpack-hmr')) return

  if (url.hostname === 'localhost') return

  if (STATIC_EXTENSIONS.test(url.pathname) || url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
      })
    )
    return
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL))
  )
})
