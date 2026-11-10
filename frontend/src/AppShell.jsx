import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Swal from 'sweetalert2'
import { ChevronDown, KeyRound, Lock, LogOut, Menu, Network, Shield, X } from 'lucide-react'
import api from './api/axios.js'
import { clearSession, getUsername } from './api/auth.js'
import ThemeToggle from './ThemeToggle.jsx'

const profileFieldClass =
  'flex h-11 items-center gap-2 rounded-xl border border-gray-300 bg-gray-50 px-3 text-gray-500 transition-colors duration-300 focus-within:border-cyan-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-cyan-600/15 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:focus-within:bg-gray-900'
const profileInputClass =
  'h-full w-full border-0 bg-transparent text-sm font-medium text-gray-900 outline-none dark:text-gray-100'

const navLinkClass = ({ isActive }) =>
  [
    'flex h-11 w-full items-center justify-between gap-3 rounded-xl px-3.5 text-left text-[15px] font-semibold text-sky-100 no-underline transition-colors duration-300',
    isActive ? 'bg-white/15 text-white shadow-[inset_3px_0_0_#67e8f9]' : 'hover:bg-white/10 hover:text-white',
  ].join(' ')

function SidebarNavLink({ to, label, icon: Icon }) {
  return (
    <NavLink to={to} className={navLinkClass}>
      <span className="flex min-w-0 items-center gap-2.5">
        {Icon ? <Icon size={18} strokeWidth={2.1} className="shrink-0 text-sky-200/90" aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
      </span>
    </NavLink>
  )
}

function pageLabel(pathname) {
  if (pathname.startsWith('/akun')) {
    return 'Akun'
  }
  return 'GenieACS'
}

function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [username, setUsername] = useState(getUsername)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ old_password: '', new_password: '', confirm_password: '' })
  const [passwordState, setPasswordState] = useState({ loading: false, error: '', ok: '' })
  const accountMenuRef = useRef(null)

  useEffect(() => {
    setIsSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const syncUsername = () => setUsername(getUsername())
    syncUsername()
    window.addEventListener('admin-session-changed', syncUsername)
    window.addEventListener('storage', syncUsername)
    return () => {
      window.removeEventListener('admin-session-changed', syncUsername)
      window.removeEventListener('storage', syncUsername)
    }
  }, [])

  useEffect(() => {
    if (!accountMenuOpen) {
      return undefined
    }
    function handleDocumentPointer(event) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDocumentPointer)
    document.addEventListener('touchstart', handleDocumentPointer)
    return () => {
      document.removeEventListener('mousedown', handleDocumentPointer)
      document.removeEventListener('touchstart', handleDocumentPointer)
    }
  }, [accountMenuOpen])

  function openPasswordModal() {
    setAccountMenuOpen(false)
    setPasswordForm({ old_password: '', new_password: '', confirm_password: '' })
    setPasswordState({ loading: false, error: '', ok: '' })
    setPasswordModalOpen(true)
  }

  function closePasswordModal() {
    if (passwordState.loading) {
      return
    }
    setPasswordModalOpen(false)
    setPasswordForm({ old_password: '', new_password: '', confirm_password: '' })
    setPasswordState({ loading: false, error: '', ok: '' })
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault()
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordState({ loading: false, error: 'Konfirmasi password tidak sama', ok: '' })
      return
    }
    setPasswordState({ loading: true, error: '', ok: '' })
    try {
      const response = await api.put('/api/admins/password', passwordForm)
      setPasswordForm({ old_password: '', new_password: '', confirm_password: '' })
      setPasswordState({ loading: false, error: '', ok: response.data?.message || 'Password berhasil diubah' })
      await Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: response.data?.message || 'Password berhasil diubah',
        confirmButtonText: 'OK',
      })
      closePasswordModal()
    } catch (error) {
      setPasswordState({
        loading: false,
        error: error.response?.data?.message || 'Gagal mengubah password',
        ok: '',
      })
    }
  }

  async function handleLogout() {
    const result = await Swal.fire({
      title: 'Yakin ingin keluar?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya',
      cancelButtonText: 'Batal',
    })
    if (!result.isConfirmed) {
      return
    }

    clearSession()
    navigate('/')
  }

  const sidebarClass = [
    'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 transform flex-col gap-5 bg-linear-to-b from-slate-950 to-cyan-900 px-4 py-5 text-sky-50 transition-transform duration-300 ease-in-out',
    isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
    'md:sticky md:top-0 md:bottom-auto md:left-auto md:z-auto md:h-svh md:w-70 md:translate-x-0 md:gap-7 md:px-4.5 md:py-7',
  ].join(' ')

  return (
    <div className="flex min-h-svh flex-col bg-gray-50 font-sans text-gray-900 transition-colors duration-300 md:flex-row dark:bg-gray-900 dark:text-gray-100">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside id="app-sidebar" className={sidebarClass}>
        <div className="flex items-center gap-3 px-2">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-linear-to-br from-cyan-600 to-cyan-800 text-xl font-bold" aria-hidden="true">
            G
          </span>
          <div>
            <p className="m-0 text-xs font-bold tracking-[0.12em] text-sky-200 uppercase">GenieACS</p>
            <strong className="mt-0.5 block text-[15px] font-semibold">Panel Admin</strong>
          </div>
        </div>

        <nav className="grid flex-1 content-start gap-1.5 overflow-x-hidden overflow-y-auto pr-1 custom-sidebar-scrollbar" aria-label="Menu utama">
          <SidebarNavLink to="/acs" label="GenieACS" icon={Network} />
          <SidebarNavLink to="/akun" label="Akun Admin" icon={Shield} />
        </nav>

        <ThemeToggle />
        <button
          type="button"
          className="h-11 cursor-pointer rounded-xl border-0 bg-rose-600 text-[15px] font-bold text-white shadow-lg shadow-rose-600/30 transition-colors duration-300 hover:bg-rose-700"
          onClick={handleLogout}
        >
          Logout
        </button>
      </aside>

      <main className="min-w-0 flex-1 bg-gray-50 p-6 text-gray-900 transition-colors duration-300 md:px-10 md:py-9 dark:bg-gray-900 dark:text-gray-100">
        <header className="sticky top-0 z-30 -mx-6 -mt-6 mb-5 flex h-14 items-center gap-3 border-b border-gray-200 bg-white/95 px-3 backdrop-blur-sm md:-mx-10 md:-mt-9 md:px-6 dark:border-gray-700 dark:bg-gray-900/95">
          <button
            type="button"
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl border-0 bg-transparent text-gray-800 transition-colors duration-300 hover:bg-gray-100 md:hidden dark:text-gray-100 dark:hover:bg-gray-800"
            aria-label="Buka menu"
            aria-controls="app-sidebar"
            aria-expanded={isSidebarOpen}
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={22} strokeWidth={2.2} />
          </button>
          <span className="text-sm font-bold tracking-[0.08em] text-gray-900 uppercase md:hidden dark:text-gray-100">
            {pageLabel(location.pathname)}
          </span>
          <div className="relative ml-auto" ref={accountMenuRef}>
            <button
              type="button"
              className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm transition-colors duration-300 hover:border-cyan-300 hover:bg-cyan-50/60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-cyan-700 dark:hover:bg-gray-700"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-linear-to-br from-cyan-600 to-cyan-800 text-xs font-bold text-white" aria-hidden="true">
                {(username || 'A').charAt(0).toUpperCase()}
              </span>
              <span className="hidden max-w-[10rem] truncate sm:inline">Halo, {username || 'Admin'}</span>
              <ChevronDown size={16} className={`shrink-0 text-gray-500 transition-transform duration-200 dark:text-gray-400 ${accountMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {accountMenuOpen && (
              <div
                className="absolute top-[calc(100%+0.4rem)] right-0 z-50 min-w-[12.5rem] overflow-hidden rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl dark:border-gray-600 dark:bg-gray-800"
                role="menu"
              >
                <p className="m-0 truncate px-3.5 py-2 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">
                  {username || 'Admin'}
                </p>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3.5 py-2.5 text-left text-sm font-semibold text-gray-800 transition-colors duration-200 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                  onClick={openPasswordModal}
                >
                  <KeyRound size={17} className="text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
                  Ganti password
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-3.5 py-2.5 text-left text-sm font-semibold text-rose-700 transition-colors duration-200 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  onClick={() => {
                    setAccountMenuOpen(false)
                    handleLogout()
                  }}
                >
                  <LogOut size={17} aria-hidden="true" />
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        {passwordModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" role="presentation" onClick={closePasswordModal}>
            <div
              className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
              role="dialog"
              aria-labelledby="password-modal-title"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-xs font-bold tracking-[0.12em] text-cyan-700 uppercase dark:text-cyan-300">Akun</p>
                  <h2 id="password-modal-title" className="m-0 mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">
                    Ganti password
                  </h2>
                </div>
                <button
                  type="button"
                  className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border-0 bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                  aria-label="Tutup"
                  onClick={closePasswordModal}
                  disabled={passwordState.loading}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>

              {passwordState.error && (
                <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200" role="alert">
                  {passwordState.error}
                </p>
              )}

              <form className="grid gap-3" onSubmit={handlePasswordSubmit}>
                <label className="grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
                  <span>Password lama</span>
                  <div className={profileFieldClass}>
                    <Lock size={17} aria-hidden="true" />
                    <input
                      className={profileInputClass}
                      type="password"
                      name="old_password"
                      autoComplete="current-password"
                      value={passwordForm.old_password}
                      onChange={(event) => setPasswordForm((current) => ({ ...current, old_password: event.target.value }))}
                      required
                      disabled={passwordState.loading}
                    />
                  </div>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
                  <span>Password baru</span>
                  <div className={profileFieldClass}>
                    <Lock size={17} aria-hidden="true" />
                    <input
                      className={profileInputClass}
                      type="password"
                      name="new_password"
                      autoComplete="new-password"
                      value={passwordForm.new_password}
                      onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
                      required
                      disabled={passwordState.loading}
                    />
                  </div>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
                  <span>Konfirmasi password baru</span>
                  <div className={profileFieldClass}>
                    <Lock size={17} aria-hidden="true" />
                    <input
                      className={profileInputClass}
                      type="password"
                      name="confirm_password"
                      autoComplete="new-password"
                      value={passwordForm.confirm_password}
                      onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))}
                      required
                      disabled={passwordState.loading}
                    />
                  </div>
                </label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    className="h-11 flex-1 cursor-pointer rounded-xl border border-gray-300 bg-white text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700"
                    onClick={closePasswordModal}
                    disabled={passwordState.loading}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="h-11 flex-1 cursor-pointer rounded-xl border-0 bg-linear-to-b from-cyan-700 to-cyan-900 text-sm font-bold text-white shadow-lg shadow-cyan-900/20 transition-colors hover:from-cyan-600 disabled:cursor-wait disabled:opacity-70"
                    disabled={passwordState.loading}
                  >
                    {passwordState.loading ? 'Menyimpan…' : 'Simpan password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <Outlet />
      </main>
    </div>
  )
}

export default AppShell
