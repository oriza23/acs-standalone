const TOKEN_KEY = 'token'
const USER_KEY = 'admin_user'
const ROLE_KEY = 'admin_role'
const ID_KEY = 'admin_id'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUsername() {
  return localStorage.getItem(USER_KEY) || ''
}

export function setUsername(username) {
  localStorage.setItem(USER_KEY, username)
  window.dispatchEvent(new Event('admin-session-changed'))
}

export function getUserId() {
  const id = Number(localStorage.getItem(ID_KEY))
  return Number.isInteger(id) && id > 0 ? id : null
}

// Membaca waktu kedaluwarsa (exp) dari payload JWT, tanpa verifikasi (verifikasi dilakukan backend).
function readExpiry(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).exp
  } catch {
    return null
  }
}

export function hasValidToken() {
  const token = getToken()
  if (!token) {
    return false
  }
  const exp = readExpiry(token)
  return !exp || exp * 1000 > Date.now()
}

export function saveSession({ token, username, role, id }) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, username)
  localStorage.setItem(ROLE_KEY, role || 'admin')
  const adminId = Number(id)
  if (Number.isInteger(adminId) && adminId > 0) {
    localStorage.setItem(ID_KEY, String(adminId))
  }
  window.dispatchEvent(new Event('admin-session-changed'))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(ROLE_KEY)
  localStorage.removeItem(ID_KEY)
}
