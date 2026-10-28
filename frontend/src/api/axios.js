import axios from 'axios'
import { clearSession, getToken } from './auth.js'

const currentHostname = window.location.hostname
// Cek apakah hostname berupa angka IP (misal 192.168.x.x) atau localhost
const isLocal = /^[0-9.]+$/.test(currentHostname) || currentHostname === 'localhost'

// Jika lokal, tembak port backend. Jika domain publik, gunakan relative path agar di-handle Reverse Proxy/Cloudflare.
const API_URL = isLocal ? `http://${currentHostname}:5001` : ''

const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
})

// Tempelkan token JWT otomatis ke setiap request.
apiClient.interceptors.request.use((config) => {
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
    const isLoginRequest = error.config?.url?.includes('/api/auth/login')
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
