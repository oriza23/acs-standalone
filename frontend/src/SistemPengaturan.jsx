import { useEffect, useState } from 'react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import { TIMEZONE_CHANGED_EVENT } from './ServerClock.jsx'
import ServiceHealth from './ServiceHealth.jsx'
import './SistemPengaturan.css'

const API = '/api/settings'
const DEFAULT_TIMEZONE = 'Asia/Makassar'

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB)' },
  { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA)' },
  { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT)' },
]

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
      Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: 'Zona waktu berhasil diterapkan ke Web, OS, Database, dan FreeRADIUS.',
        timer: 2000,
        showConfirmButton: false,
      })
    } catch (requestError) {
      Swal.fire('Gagal', requestError.response?.data?.message || 'Pengaturan gagal disimpan.', 'error')
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
    <section className="setting-page">
      <header className="setting-header">
        <p>Sistem</p>
        <h1>Pengaturan</h1>
      </header>

      <form className="setting-card" onSubmit={handleSave}>
        <h2>Pengaturan Zona Waktu Server</h2>
        <label className="setting-field">
          <span>Zona Waktu</span>
          <select value={timezone} onChange={(event) => setTimezone(event.target.value)} disabled={loading || saving}>
            {TIMEZONE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <div className="setting-actions">
          <button type="submit" className="setting-save" disabled={loading || saving}>
            {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
          </button>
        </div>
      </form>

      <ServiceHealth />

      <div className="setting-card">
        <div className="setting-status-head">
          <h2>Status Sinkronisasi Waktu</h2>
          {status && (
            <span className={status.synced ? 'setting-badge is-ok' : 'setting-badge is-warn'}>
              {status.synced ? 'Semua sama' : 'Belum sama'}
            </span>
          )}
        </div>
        {!status && <p className="setting-hint">Memuat status...</p>}
        {status && (
          <>
            <table className="setting-status-table">
              <tbody>
                {statusRows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.time || '-'}</td>
                    <td className={row.abbr === targetAbbr ? 'is-ok' : 'is-warn'}>{row.abbr || '-'}</td>
                  </tr>
                ))}
                <tr>
                  <td>FreeRADIUS</td>
                  <td>Mengikuti waktu Database &amp; OS</td>
                  <td className={status.radius?.active ? 'is-ok' : 'is-warn'}>{status.radius?.active ? 'Aktif' : 'Mati'}</td>
                </tr>
              </tbody>
            </table>
            {!status.synced && (
              <p className="setting-hint">Waktu belum sama dengan pengaturan. Tekan Simpan Pengaturan untuk menyamakan semuanya.</p>
            )}
          </>
        )}
      </div>
    </section>
  )
}

export default SistemPengaturan
