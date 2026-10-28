function isLocalHostname(hostname = window.location.hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')
}

// IP lokal memanggil API di port 5001. Domain publik memakai path relatif pada origin yang sama.
export function apiBaseUrl() {
  if (isLocalHostname()) {
    return `http://${window.location.hostname}:5001`
  }
  return ''
}

// io(...socketIoClientArgs()) — lokal ke port 5001, publik lewat path /socket.io di domain yang sama.
export function socketIoClientArgs(options = {}) {
  if (isLocalHostname()) {
    return [`http://${window.location.hostname}:5001`, { path: '/socket.io', ...options }]
  }
  return ['/', { path: '/socket.io', ...options }]
}
