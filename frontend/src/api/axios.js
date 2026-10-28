import axios from 'axios'
import { clearSession, getToken } from './auth.js'

const baseURL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:5001`

const api = axios.create({ baseURL })

// Tempelkan token JWT otomatis ke setiap request.
api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Token ditolak backend (kedaluwarsa/tidak valid) -> bersihkan sesi dan kembali ke halaman login.
api.interceptors.response.use(
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

export default api
