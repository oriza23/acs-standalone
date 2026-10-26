import api from './axios.js'

// Semua request memakai instance axios bersama (token JWT ditempel otomatis).
const BASE = '/api/acs'

// ---- Server ACS ----
export const getAcsServers = () => api.get(`${BASE}/server`).then((res) => res.data)

// payload: { nama_server, ip_domain, port }
export const createAcsServer = (payload) => api.post(`${BASE}/server`, payload).then((res) => res.data)

export const deleteAcsServer = (id) => api.delete(`${BASE}/server/${id}`).then((res) => res.data)

// ---- Data ONU ----
// Daftar perangkat langsung dari NBI GenieACS (lewat backend) -> array JSON GenieACS.
export const getAcsDevices = (serverId, config = {}) =>
  api.get(`${BASE}/devices`, { ...config, params: { server_id: serverId } }).then((res) => res.data)

// Ringkasan satu ONU langsung dari NBI (last_inform, RX, suhu, uptime, ...).
// deviceId = _id GenieACS. Dipakai saat modal dibuka dan saat polling setelah Summon.
export const getAcsDevice = (serverId, deviceId, config = {}) =>
  api.get(`${BASE}/devices/${encodeURIComponent(deviceId)}`, {
    ...config,
    params: { server_id: serverId },
  }).then((res) => res.data)

// SINKRON: selaraskan DB web dengan GenieACS.
export const syncAcs = (serverId) => api.post(`${BASE}/sync`, { server_id: serverId }).then((res) => res.data)

// ---- Aksi multi-select: ids = array _id perangkat GenieACS (kolom DEVICE ID) ----
const postAction = (path, serverId, ids) =>
  api.post(`${BASE}/${path}`, { server_id: serverId, ids }).then((res) => res.data)

export const resetAcsDevices = (serverId, ids) => postAction('reset', serverId, ids)
export const rebootAcsDevices = (serverId, ids) => postAction('reboot', serverId, ids)
export const summonAcsDevices = (serverId, ids) => postAction('summon', serverId, ids)
export const deleteAcsDevices = (serverId, ids) => postAction('delete', serverId, ids)

// Klien terhubung (Host LAN/WLAN) satu perangkat -> { connected_hosts: [{ hostname, ip, mac, type, active }] }
// deviceId = _id GenieACS. Diambil saat modal detail dibuka.
export const getAcsDeviceHosts = (serverId, deviceId, config = {}) =>
  api.get(`${BASE}/devices/hosts`, { ...config, params: { server_id: serverId, id: deviceId } }).then((res) => res.data)

// Daftar WiFi (WLAN) satu perangkat -> { wlans: [{ id, ssid, password, security, freq, band, connected, status }] }
// Berisi sandi WiFi, jadi hanya bisa diakses admin. Diambil saat tab WLAN dibuka.
export const getAcsDeviceWlans = (serverId, deviceId, config = {}) =>
  api.get(`${BASE}/devices/wlans`, { ...config, params: { server_id: serverId, id: deviceId } }).then((res) => res.data)

// Push perubahan WLAN ke ONU (setParameterValues lewat GenieACS). Hanya admin.
// payload: { server_id, deviceId (_id GenieACS), wlanId, ssid, password, status (boolean) }
// -> { success, applied, changed, message }
export const updateAcsWlan = (payload) => api.post(`${BASE}/update-wlan`, payload).then((res) => res.data)

// Konfigurasi LAN (IP gateway, DHCP server, DNS) satu perangkat ->
// { lanConfig: { ip, subnet, mac, dhcpEnabled, dhcpMin, dhcpMax, leaseTime, dns: [3] } }. Diambil saat tab LAN dibuka.
export const getAcsDeviceLan = (serverId, deviceId, config = {}) =>
  api.get(`${BASE}/devices/lan`, { ...config, params: { server_id: serverId, id: deviceId } }).then((res) => res.data)

// Daftar koneksi WAN satu perangkat -> { wans: [{ id, type, name, status, ip, ... }] }.
// Diambil saat tab WAN dibuka. Sandi PPPoE sudah disamarkan backend.
export const getAcsDeviceWans = (serverId, deviceId, config = {}) =>
  api.get(`${BASE}/devices/wans`, { ...config, params: { server_id: serverId, id: deviceId } }).then((res) => res.data)

// Push perubahan LAN (IP gateway, DHCP, DNS) ke ONU lewat GenieACS. Hanya admin.
// payload: { server_id, deviceId (_id GenieACS), ip, subnet, dhcpEnabled, dhcpMin, dhcpMax, leaseTime, dns1, dns2, dns3 }
// -> { success, applied, changed, message }
export const updateAcsLan = (payload) => api.post(`${BASE}/update-lan`, payload).then((res) => res.data)

// Hapus satu koneksi WAN (DeleteObject). Hanya admin.
// payload: { server_id, deviceId (_id GenieACS), wanPath }
// -> { success, applied, message }
export const deleteAcsWan = (payload) => api.post(`${BASE}/delete-wan`, payload).then((res) => res.data)
