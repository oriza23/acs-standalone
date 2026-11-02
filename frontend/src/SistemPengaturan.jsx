import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import { fireError, fireSuccess } from './swals.js'
import { TIMEZONE_CHANGED_EVENT } from './ServerClock.jsx'
import ServiceHealth from './ServiceHealth.jsx'

const API = '/settings'
const DEFAULT_TIMEZONE = 'Asia/Makassar'

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB)' },
  { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA)' },
  { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT)' },
]

const SETTING_CARD =
  'mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900'

function syncHeadBadgeClass(synced) {
  return synced
    ? 'inline-flex shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
    : 'inline-flex shrink-0 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
}

function rowBadgeClass(ok) {
  return ok
    ? 'inline-flex shrink-0 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-800 dark:bg-teal-950/40 dark:text-teal-300'
    : 'inline-flex shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
}

function SistemPengaturan() {
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)

  async function loadStatus() {
    try {
      const response = await api.get(`${API}/time-status`)
      setStatus(response.data)
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => {
    let ignore = false

    async function loadTimezone() {
      try {
        const response = await api.get(`${API}/timezone`)
        if (!ignore && response.data?.timezone) {
          setTimezone(response.data.timezone)
        }
      } catch {
        if (!ignore) {
          Swal.fire('Gagal', 'Pengaturan zona waktu gagal dimuat.', 'error')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadTimezone()
    loadStatus()
    const timer = setInterval(loadStatus, 5000)
    return () => {
      ignore = true
      clearInterval(timer)
    }
  }, [])

  async function handleSave(event) {
    event.preventDefault()
    const label = TIMEZONE_OPTIONS.find((item) => item.value === timezone)?.label || timezone
    const confirm = await Swal.fire({
      title: 'Terapkan zona waktu?',
      html: `Zona waktu <b>${label}</b> akan diterapkan ke Web, OS, Database, dan FreeRADIUS.<br/>MariaDB dan FreeRADIUS akan di-restart sebentar (beberapa detik).`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, terapkan',
      cancelButtonText: 'Batal',
    })
    if (!confirm.isConfirmed) {
      return
    }

    setSaving(true)
    Swal.fire({
      title: 'Menerapkan zona waktu...',
      text: 'Mohon tunggu, layanan sedang di-restart.',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    })
    try {
      const response = await api.post(`${API}/timezone`, { timezone })
      window.dispatchEvent(new Event(TIMEZONE_CHANGED_EVENT))
      if (response.data?.status) {
        setStatus(response.data.status)
      }
      await fireSuccess({
        title: 'Berhasil',
        text: 'Zona waktu berhasil diterapkan ke Web, OS, Database, dan FreeRADIUS.',
      }, () => { loadStatus() })
    } catch (requestError) {
      fireError({ title: 'Gagal', text: requestError.response?.data?.message || 'Pengaturan gagal disimpan.' })
      loadStatus()
    } finally {
      setSaving(false)
    }
  }

  const statusRows = status
    ? [
        { name: 'Web (Aplikasi)', time: status.web?.time, abbr: status.web?.abbr },
        { name: 'OS (Server)', time: status.os?.time, abbr: status.os?.abbr },
        { name: 'Database (MariaDB)', time: status.database?.time, abbr: status.database?.abbr },
      ]
    : []
  const targetAbbr = TIMEZONE_OPTIONS.find((item) => item.value === status?.target)?.label.match(/\((.+)\)/)?.[1]

  return (
    <section className="mx-auto max-w-3xl pb-8">
      <header className="mb-2">
        <p className="m-0 text-xs font-bold tracking-widest text-cyan-700 uppercase dark:text-cyan-400">Sistem</p>
        <h1 className="m-0 text-3xl font-bold tracking-tight text-slate-900 dark:text-gray-100">Pengaturan</h1>
      </header>

      <form className={SETTING_CARD} onSubmit={handleSave}>
        <h2 className="m-0 text-lg font-bold text-slate-900 dark:text-gray-100">Pengaturan Zona Waktu Server</h2>
        <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-end md:gap-4">
          <label className="grid min-w-0 flex-1 gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-gray-400">Zona Waktu</span>
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              disabled={loading || saving}
              className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-gray-100"
            >
              {TIMEZONE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={loading || saving}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-blue-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/40 active:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 md:min-w-[11rem]"
          >
            <Save size={16} strokeWidth={2.25} aria-hidden="true" />
            {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
          </button>
        </div>
      </form>

      <ServiceHealth />

      <div className={SETTING_CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-lg font-bold text-slate-900 dark:text-gray-100">Status Sinkronisasi Waktu</h2>
          {status && (
            <span className={syncHeadBadgeClass(status.synced)}>
              {status.synced ? 'Semua sama' : 'Belum sama'}
            </span>
          )}
        </div>
        {!status && <p className="mt-4 text-sm text-slate-500 dark:text-gray-400">Memuat status...</p>}
        {status && (
          <>
            <ul className="mt-4 divide-y divide-gray-100 dark:divide-slate-800" role="list">
              {statusRows.map((row) => (
                <li
                  key={row.name}
                  className="grid grid-cols-1 gap-2 py-3.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                >
                  <span className="text-sm font-semibold text-slate-800 dark:text-gray-100">{row.name}</span>
                  <span className="text-sm text-gray-500 tabular-nums sm:text-center dark:text-gray-400">{row.time || '-'}</span>
                  <span className={rowBadgeClass(row.abbr === targetAbbr)}>{row.abbr || '-'}</span>
                </li>
              ))}
              <li className="grid grid-cols-1 gap-2 py-3.5 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <span className="text-sm font-semibold text-slate-800 dark:text-gray-100">FreeRADIUS</span>
                <span className="text-sm text-gray-500 sm:text-center dark:text-gray-400">Mengikuti waktu Database &amp; OS</span>
                <span className={rowBadgeClass(status.radius?.active)}>{status.radius?.active ? 'Aktif' : 'Mati'}</span>
              </li>
            </ul>
            {!status.synced && (
              <p className="mt-4 text-sm text-slate-500 dark:text-gray-400">
                Waktu belum sama dengan pengaturan. Tekan Simpan Pengaturan untuk menyamakan semuanya.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export default SistemPengaturan
