import axios from 'axios'
import { clearSession, getToken } from './auth.js'

const currentHostname = window.location.hostname
const isLocal = /^[0-9.]+$/.test(currentHostname) || currentHostname === 'localhost'

// Jika lokal, langsung tembak port 5001. Jika via Cloudflare, gunakan origin saat ini agar path relatif bekerja sempurna.
const API_URL = isLocal ? `http://${currentHostname}:5001` : window.location.origin

const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

apiClient.interceptors.request.use((config) => {
  if (typeof config.url === 'string' && !/^https?:\/\//i.test(config.url)) {
    const path = config.url.startsWith('/') ? config.url : `/${config.url}`
    config.url = path === '/api' || path.startsWith('/api/') ? path : `/api${path}`
  }
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Token ditolak backend (kedaluwarsa/tidak valid) -> bersihkan sesi dan kembali ke halaman login.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || ''
    const isLoginRequest = requestUrl.includes('/api/login') || requestUrl.includes('/api/auth/login')
    if (error.response?.status === 401 && !isLoginRequest) {
      clearSession()
      if (window.location.pathname !== '/') {
        window.location.assign('/?expired=1')
      }
    }
    return Promise.reject(error)
  },
)

export default apiClient
