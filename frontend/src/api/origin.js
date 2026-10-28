// HTTP lokal (IP Proxmox) memanggil backend langsung. HTTPS publik memakai path relatif
// supaya browser tidak memblokir Mixed Content; Nginx meneruskan /api dan /socket.io ke port 5001.
export function resolveApiOrigin() {
  if (window.location.protocol === 'https:') {
    return '/'
  }
  return `http://${window.location.hostname}:5001`
}
