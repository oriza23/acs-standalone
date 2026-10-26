import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Lock, User } from 'lucide-react'
import api from './api/axios.js'
import { hasValidToken, saveSession } from './api/auth.js'
import ThemeToggle from './ThemeToggle.jsx'

function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sessionExpired = searchParams.get('expired') === '1'

  if (hasValidToken()) {
    return <Navigate to="/acs" replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await api.post('/api/auth/login', {
        username: username.trim(),
        password,
      })

      if (response.data?.token) {
        saveSession(response.data)
        navigate('/acs', { replace: true })
      } else {
        setError('Login gagal, token tidak diterima.')
      }
    } catch (requestError) {
      if (requestError.response) {
        setError(requestError.response.data?.message || 'Username atau password salah')
      } else {
        setError('Tidak dapat terhubung ke server.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-gray-50 px-4 transition-colors duration-300 dark:bg-gray-900">
      <div className="pointer-events-none absolute -top-24 -left-16 h-72 w-72 rounded-full bg-cyan-400/30 blur-3xl dark:bg-cyan-500/20" />
      <div className="pointer-events-none absolute -right-10 -bottom-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl dark:bg-blue-500/10" />
      <ThemeToggle tone="surface" className="absolute top-4 right-4 z-10" />

      <section className="relative w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-xl transition-colors duration-300 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-linear-to-br from-cyan-600 to-cyan-800 text-xl font-bold text-white" aria-hidden="true">
            G
          </span>
          <div>
            <p className="m-0 text-xs font-bold tracking-[0.14em] text-cyan-700 uppercase dark:text-cyan-300">GenieACS</p>
            <h1 className="m-0 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Masuk ke akun Anda</h1>
          </div>
        </div>

        <p className="mt-4 mb-0 text-sm text-gray-500 dark:text-gray-400">
          Kelola perangkat ONU dari satu tempat.
        </p>

        {sessionExpired && !error && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200" role="status">Sesi Anda berakhir, silakan login kembali.</p>
        )}
        {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200" role="alert">{error}</p>}

        <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
            <span>Username</span>
            <div className="flex h-12 items-center gap-2 rounded-xl border border-gray-300 bg-gray-50 px-3 text-gray-500 transition-colors duration-300 focus-within:border-cyan-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-cyan-600/15 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:focus-within:bg-gray-900">
              <User size={18} aria-hidden="true" />
              <input
                className="h-full w-full border-0 bg-transparent text-sm font-medium text-gray-900 outline-none dark:text-gray-100"
                type="text"
                name="username"
                autoComplete="username"
                placeholder="Masukkan username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                autoFocus
              />
            </div>
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
            <span>Password</span>
            <div className="flex h-12 items-center gap-2 rounded-xl border border-gray-300 bg-gray-50 px-3 text-gray-500 transition-colors duration-300 focus-within:border-cyan-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-cyan-600/15 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:focus-within:bg-gray-900">
              <Lock size={18} aria-hidden="true" />
              <input
                className="h-full w-full border-0 bg-transparent text-sm font-medium text-gray-900 outline-none dark:text-gray-100"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="Masukkan password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-gray-500 transition-colors duration-300 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <button className="h-12 cursor-pointer rounded-xl border-0 bg-linear-to-b from-cyan-700 to-cyan-900 text-[15px] font-bold text-white shadow-lg shadow-cyan-900/20 transition-colors duration-300 hover:from-cyan-600 disabled:cursor-wait disabled:opacity-70" type="submit" disabled={loading}>
            {loading ? 'Memeriksa...' : 'Login'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default Login
