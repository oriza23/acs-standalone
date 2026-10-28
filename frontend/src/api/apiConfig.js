function isLocalHostname(hostname = window.location.hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')
}

// HTTPS (Cloudflare) menumpang ke domain yang sama. HTTP lokal memanggil port 5001.
export function apiBaseUrl() {
  if (window.location.protocol === 'https:') {
    return ''
  }
  if (isLocalHostname()) {
    return `http://${window.location.hostname}:5001`
  }
  return ''
}

// io(...socketIoClientArgs()) — HTTPS lewat path /socket.io, HTTP lokal ke port 5001.
export function socketIoClientArgs(options = {}) {
  if (window.location.protocol === 'https:') {
    return ['/', { path: '/socket.io', ...options }]
  }
  if (isLocalHostname()) {
    return [`http://${window.location.hostname}:5001`, { path: '/socket.io', ...options }]
  }
  return ['/', { path: '/socket.io', ...options }]
}
