// The installed app's service worker (Chrome needs one to install the app full-screen, without the browser
// bar). It stores nothing: every request goes to the network as usual, so client data is never kept on
// the phone. Only when a page can't load at all (no signal) does it show a short "You're offline" page.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hanna Clinic</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FBF7F0;color:#132A6E;
font:16px/1.5 "Segoe UI",-apple-system,system-ui,sans-serif;text-align:center;padding:24px}button{margin-top:16px;padding:12px 22px;border:0;
border-radius:999px;background:#0E7C78;color:#fff;font:700 14px/1 inherit;text-transform:uppercase;letter-spacing:.06em}</style></head>
<body><div><h1 style="margin:0 0 8px;font-size:22px">You’re offline</h1><p style="margin:0">Hanna Clinic needs the internet. Check the Wi-Fi or mobile data, then try again.</p>
<button onclick="location.reload()">Try Again</button></div></body></html>`

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return // everything else: the browser's normal network request
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })))
})
