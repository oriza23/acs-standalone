import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Swal from 'sweetalert2'
import { Menu } from 'lucide-react'
import { clearSession } from './api/auth.js'
import ThemeToggle from './ThemeToggle.jsx'

const navLinkClass = ({ isActive }) =>
  [
    'flex h-11 w-full items-center justify-between rounded-xl px-3.5 text-left text-[15px] font-semibold text-sky-100 no-underline transition-colors duration-300',
    isActive ? 'bg-white/15 text-white shadow-[inset_3px_0_0_#67e8f9]' : 'hover:bg-white/10 hover:text-white',
  ].join(' ')

function Dashboard() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  useEffect(() => {
    setIsSidebarOpen(false)
  }, [location.pathname])

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
          <NavLink to="/acs" className={navLinkClass}>
            GenieACS
          </NavLink>
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
        <header className="sticky top-0 z-30 -mx-6 -mt-6 mb-5 flex h-14 items-center gap-3 border-b border-gray-200 bg-white/95 px-3 backdrop-blur-sm md:hidden dark:border-gray-700 dark:bg-gray-900/95">
          <button
            type="button"
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl border-0 bg-transparent text-gray-800 transition-colors duration-300 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-800"
            aria-label="Buka menu"
            aria-controls="app-sidebar"
            aria-expanded={isSidebarOpen}
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={22} strokeWidth={2.2} />
          </button>
          <span className="text-sm font-bold tracking-[0.08em] text-gray-900 uppercase dark:text-gray-100">
            GenieACS
          </span>
        </header>
        <Outlet />
      </main>
    </div>
  )
}

export default Dashboard
