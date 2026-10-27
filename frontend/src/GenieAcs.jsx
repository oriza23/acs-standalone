import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cable, Eye, EyeOff, Flag, Globe, KeyRound, Network, Pencil, Server, Trash2, TriangleAlert, X } from 'lucide-react'
import Swal from 'sweetalert2'
import {
  createAcsServer,
  deleteAcsDevices,
  deleteAcsServer,
  getAcsDevice,
  getAcsDeviceHosts,
  getAcsDeviceLan,
  deleteAcsWan,
  getAcsDeviceWans,
  getAcsDeviceWlans,
  getAcsDevices,
  getAcsServers,
  rebootAcsDevices,
  resetAcsDevices,
  summonAcsDevices,
  syncAcs,
  updateAcsLan,
  updateAcsWlan,
} from './api/acs.js'
import ServerPagination from './ServerPagination.jsx'

const LIMIT_OPTIONS = [10, 50, 100]
const FILTER_OPTIONS = [
  { value: 'all', label: 'Semua ONU' },
  { value: 'online', label: 'Online' },
  { value: 'off24', label: 'Off < 24 Jam' },
  { value: 'off24plus', label: 'Off > 24 Jam' },
]
const EMPTY_STATS = { total: 0, online: 0, off24: 0, off24plus: 0 }
// ONU dianggap online bila inform terakhirnya tidak lebih lama dari ini.
const ONLINE_WINDOW_MINUTES = 30
const EMPTY_SERVER_FORM = { nama_server: '', ip_domain: '', port: '7557' }

const COLUMNS = [
  'FLAG', 'USERNAME', 'IP PPPOE', 'IP TR069', 'SN ONU', 'PON', 'MANUFAKTUR', 'TYPE', 'SSID',
  'USER', 'RX ONU', 'TEMP', 'UPTIME', 'LAST INFORM', 'REGISTERED', 'DEVICE ID', 'TAGS',
]

const STAT_CARDS = [
  { key: 'total', label: 'TOTAL ONU', className: 'bg-blue-600 shadow-blue-600/30' },
  { key: 'online', label: 'ONLINE', className: 'bg-green-600 shadow-green-600/30' },
  { key: 'off24', label: 'OFF < 24H', className: 'bg-orange-500 shadow-orange-500/30' },
  { key: 'off24plus', label: 'OFF > 24H', className: 'bg-red-600 shadow-red-600/30' },
]

const FLAG_STYLE = {
  online: { className: 'text-green-500', title: 'Online' },
  off24: { className: 'text-orange-500', title: 'Off kurang dari 24 jam' },
  off24plus: { className: 'text-red-500', title: 'Off lebih dari 24 jam' },
}

const btnBase =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border-0 px-5 text-[13px] font-bold tracking-wide text-white shadow-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50'
const inputBase =
  'h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
const thClass =
  'whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3 py-3 text-left text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400'
const tdClass = 'whitespace-nowrap px-3 py-2.5 text-[13px] text-gray-700 dark:text-gray-200'

// Tombol aksi multi-select. `run` menerima (serverId, ids) dan mengembalikan hasil backend.
const BULK_ACTIONS = [
  {
    key: 'summon',
    label: 'SUMMON',
    className: 'bg-cyan-600 hover:bg-cyan-700',
    run: summonAcsDevices,
    confirm: { title: 'Summon ONU?', text: (n) => `${n} ONU akan dipaksa inform/refresh.`, button: 'Ya, Summon' },
  },
  {
    key: 'reboot',
    label: 'REBOOT',
    className: 'bg-amber-500 hover:bg-amber-600',
    run: rebootAcsDevices,
    confirm: { title: 'Reboot ONU?', text: (n) => `${n} ONU akan di-reboot.`, button: 'Ya, Reboot' },
  },
  {
    key: 'delete',
    label: 'DELETE',
    className: 'bg-red-600 hover:bg-red-700',
    run: deleteAcsDevices,
    clearsSelection: true,
    reloads: true,
    confirm: {
      title: 'Hapus ONU?',
      text: (n) => `${n} ONU akan dihapus dari GenieACS dan dari database web. Tindakan ini tidak dapat dibatalkan.`,
      button: 'Ya, Hapus',
      danger: true,
    },
  },
  {
    key: 'reset',
    label: 'RESET',
    className: 'bg-purple-600 hover:bg-purple-700',
    run: resetAcsDevices,
    confirm: {
      title: 'Factory Reset ONU?',
      text: (n) => `${n} ONU akan di-reset ke pengaturan pabrik. Semua konfigurasi ONU akan hilang!`,
      button: 'Ya, Reset',
      danger: true,
    },
  },
]

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback
}

function formatDate(value) {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' })
}

function ServerModal({ servers, onClose, onChanged }) {
  const [form, setForm] = useState(EMPTY_SERVER_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await createAcsServer({
        nama_server: form.nama_server.trim(),
        ip_domain: form.ip_domain.trim(),
        port: form.port === '' ? undefined : Number(form.port),
      })
      setForm(EMPTY_SERVER_FORM)
      await onChanged()
      Swal.fire({ icon: 'success', title: 'Berhasil!', text: 'Server ACS disimpan', timer: 1500, showConfirmButton: false })
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: errorMessage(error, 'Gagal menyimpan server ACS.') })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(server) {
    const confirm = await Swal.fire({
      title: `Hapus server "${server.nama_server}"?`,
      text: 'Data ONU server ini di database web ikut dihapus (data di GenieACS tidak berubah).',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, Hapus!',
      cancelButtonText: 'Batal',
    })
    if (!confirm.isConfirmed) {
      return
    }
    setDeletingId(server.id)
    try {
      await deleteAcsServer(server.id)
      await onChanged(server.id)
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: errorMessage(error, 'Gagal menghapus server ACS.') })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="max-h-[90svh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acs-server-title"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="acs-server-title" className="m-0 text-lg font-bold text-gray-900 dark:text-gray-100">Server ACS</h2>
          <button
            type="button"
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            aria-label="Tutup"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <form className="grid gap-3" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-[13px] font-semibold text-gray-700 dark:text-gray-200">
            Nama Server
            <input
              className={inputBase}
              type="text"
              maxLength={100}
              placeholder="ACS Pusat"
              value={form.nama_server}
              onChange={(event) => updateField('nama_server', event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1 text-[13px] font-semibold text-gray-700 dark:text-gray-200">
            IP / Domain (Publik atau Lokal)
            <input
              className={inputBase}
              type="text"
              placeholder="192.168.1.10 atau acs.contoh.com"
              value={form.ip_domain}
              onChange={(event) => updateField('ip_domain', event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1 text-[13px] font-semibold text-gray-700 dark:text-gray-200">
            Port NBI
            <input
              className={inputBase}
              type="number"
              min={1}
              max={65535}
              placeholder="7557"
              value={form.port}
              onChange={(event) => updateField('port', event.target.value)}
            />
          </label>
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" className={`${btnBase} bg-gray-500 hover:bg-gray-600`} onClick={onClose}>
              BATAL
            </button>
            <button type="submit" className={`${btnBase} bg-blue-600 hover:bg-blue-700`} disabled={saving}>
              {saving ? 'MENYIMPAN...' : 'SIMPAN'}
            </button>
          </div>
        </form>

        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
          <h3 className="m-0 mb-2 text-[13px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">
            Server tersimpan
          </h3>
          {servers.length === 0 ? (
            <p className="m-0 text-sm text-gray-500 dark:text-gray-400">Belum ada server ACS.</p>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {servers.map((server) => (
                <li
                  key={server.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700"
                >
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{server.nama_server}</p>
                    <p className="m-0 truncate text-xs text-gray-500 dark:text-gray-400">{server.ip_domain}:{server.port}</p>
                  </div>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md border-0 bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                    onClick={() => handleDelete(server)}
                    disabled={deletingId === server.id}
                  >
                    {deletingId === server.id ? '...' : 'HAPUS'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// Detik -> "2d 5h 30m". Hari/jam dihilangkan bila 0; tidak valid -> '-'.
function formatUptime(seconds) {
  const total = Number(seconds)
  if (seconds === null || seconds === undefined || seconds === '' || !Number.isFinite(total) || total < 0) {
    return '-'
  }
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return [days > 0 && `${days}d`, (days > 0 || hours > 0) && `${hours}h`, `${minutes}m`].filter(Boolean).join(' ')
}

// Rentang redaman fiber yang wajar (dBm). Di luar ini tetap ditampilkan apa adanya, dengan penanda.
const RX_NORMAL_MIN = -40
const RX_NORMAL_MAX = -10

function IpLink({ ip }) {
  if (!ip || ip === '-') {
    return '-'
  }
  return (
    <a
      href={'http://' + ip}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
      onClick={(event) => event.stopPropagation()}
    >
      {ip}
    </a>
  )
}

function informMillis(value) {
  if (!value) {
    return null
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function statusFromInform(lastInform, now) {
  const time = informMillis(lastInform)
  if (time !== null) {
    const age = now - time
    if (age <= ONLINE_WINDOW_MINUTES * 60 * 1000) {
      return 'online'
    }
    if (age <= 24 * 60 * 60 * 1000) {
      return 'off24'
    }
  }
  return 'off24plus'
}

function deviceIsOffline(device, now = Date.now()) {
  if (device?.last_inform) {
    return statusFromInform(device.last_inform, now) !== 'online'
  }
  if (device?.status) {
    return device.status !== 'online'
  }
  return true
}

// last_inform baru lebih baru daripada nilai yang disimpan saat Summon diklik.
function isNewerInform(next, previous) {
  const nextTime = informMillis(next)
  if (nextTime === null) {
    return false
  }
  const previousTime = informMillis(previous)
  return previousTime === null || nextTime > previousTime
}

// Data ONU dari backend sudah bersih dan terstandarisasi (sn, ip_pppoe, rx_onu, ...).
// Di sini hanya ditambah status online (dari last_inform) dan kunci urut registrasi.
function toRow(item, now) {
  return {
    ...item,
    tags: Array.isArray(item.tags) ? item.tags : [],
    status: statusFromInform(item.last_inform, now),
    sortKey: informMillis(item.registered) ?? 0,
  }
}

function matchesSearch(item, term) {
  return [item.username, item.pon, item.ssid, item.sn, item.manufaktur, item.tipe, item.id, item.ip_pppoe, item.ip_tr069, item.tags.join(' ')]
    .some((value) => String(value ?? '').toLowerCase().includes(term))
}

const DETAIL_TABS = ['TERHUBUNG', 'WLAN', 'LAN', 'WAN']
const HOST_COLUMNS = ['No', 'HOSTNAME', 'IP ADDRESS', 'MAC ADDRESS', 'TYPE']
const WLAN_COLUMNS = ['ID', 'SSID', 'PASSWORD', 'SECURITY', 'FREQ', 'BAND', 'CONNECTED', 'STATUS']

const STATUS_BADGE = {
  online: { label: 'ONLINE', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  off24: { label: 'OFF < 24H', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  off24plus: { label: 'OFF > 24H', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
}

// Sandi WiFi disembunyikan secara bawaan; klik ikon mata untuk melihatnya.
function WlanPassword({ value }) {
  const [revealed, setRevealed] = useState(false)
  if (!value || value === '-') {
    return '-'
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs">{revealed ? value : '••••••••'}</span>
      <button
        type="button"
        className="grid h-6 w-6 cursor-pointer place-items-center rounded border-0 bg-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
        aria-label={revealed ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  )
}

const WLAN_SECURITY_OPTIONS = ['WPA/WPA2-PSK', 'WPA2-PSK', 'WPA-PSK', 'Open System']
const EMPTY_WLAN_FORM = { ssid: '', security: '', password: '', status: true }

function isOpenSecurity(security) {
  return security === 'Open System' || security === 'None'
}

// Nilai keamanan dari ACS (BeaconType TR-098 / ModeEnabled TR-181) -> label yang ramah di form.
function securityLabel(raw) {
  const value = String(raw ?? '').trim()
  const known = {
    '11i': 'WPA2-PSK',
    WPA: 'WPA-PSK',
    WPAand11i: 'WPA/WPA2-PSK',
    'WPA2-Personal': 'WPA2-PSK',
    'WPA-Personal': 'WPA-PSK',
    'WPA-WPA2-Personal': 'WPA/WPA2-PSK',
    None: 'Open System',
  }
  return known[value] ?? (value || 'Open System')
}

function wlanFormFrom(wlan) {
  const security = securityLabel(wlan.security)
  return {
    ssid: wlan.ssid === 'N/A' ? '' : wlan.ssid,
    security,
    password: !wlan.password || wlan.password === '-' || isOpenSecurity(security) ? '' : wlan.password,
    status: Boolean(wlan.status),
  }
}

const formInput =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 dark:disabled:bg-slate-700'

function FormField({ label, hint, children }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[8rem_1fr] sm:gap-4">
      <span className="pt-2 text-[13px] font-bold text-gray-700 dark:text-gray-200">{label}</span>
      <div>
        {children}
        {hint && <p className="m-0 mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>
    </div>
  )
}

// Pop-up edit WLAN (berlapis di atas modal detail). Perubahan dikirim ke ONU lewat onSubmit.
function EditWlanModal({ wlan, form, updating, onChange, onClose, onSubmit }) {
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const isOpen = isOpenSecurity(form.security)
  const securityOptions = WLAN_SECURITY_OPTIONS.includes(form.security) || !form.security
    ? WLAN_SECURITY_OPTIONS
    : [...WLAN_SECURITY_OPTIONS, form.security]

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <form
        className="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acs-wlan-edit-title"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div>
            <h2 id="acs-wlan-edit-title" className="m-0 text-base font-bold tracking-wide text-gray-900 dark:text-gray-100">
              UPDATE WLAN
            </h2>
            <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-gray-400">WLAN {wlan.id} · {wlan.freq}</p>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
            aria-label="Tutup"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-5 px-6 py-5">
          <FormField label="SSID" hint="Min 1 max 32 Characters">
            <input
              className={formInput}
              type="text"
              minLength={1}
              maxLength={32}
              required
              disabled={updating}
              value={form.ssid}
              onChange={(event) => onChange('ssid', event.target.value)}
            />
          </FormField>

          <FormField label="Security Mode">
            <select
              className={formInput}
              disabled={updating}
              value={form.security}
              onChange={(event) => {
                const value = event.target.value
                onChange('security', value)
                if (isOpenSecurity(value)) {
                  onChange('password', '')
                }
              }}
            >
              {securityOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Password" hint={isOpen ? 'Tidak diperlukan untuk Open System' : 'Min 8 max 20 Characters'}>
            <div className="relative">
              <input
                className={`${formInput} pr-10`}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                minLength={8}
                maxLength={20}
                required={!isOpen}
                disabled={isOpen || updating}
                value={form.password}
                onChange={(event) => onChange('password', event.target.value)}
              />
              <button
                type="button"
                className="absolute top-1/2 right-1.5 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed dark:text-gray-300 dark:hover:bg-slate-700"
                aria-label={showPassword ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
                disabled={isOpen}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </FormField>

          <FormField label="Status">
            <select
              className={formInput}
              disabled={updating}
              value={String(form.status)}
              onChange={(event) => onChange('status', event.target.value === 'true')}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </FormField>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <button
            type="button"
            className="h-10 cursor-pointer rounded-lg border-0 bg-gray-500 px-5 text-[13px] font-bold text-white transition-colors hover:bg-gray-600"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="submit"
            className="h-10 cursor-pointer rounded-lg border-0 bg-blue-600 px-5 text-[13px] font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={updating}
          >
            {updating ? 'Updating...' : 'Update'}
          </button>
        </div>
      </form>
    </div>
  )
}

// Kartu pada tab LAN: header (ikon + judul) dan isi.
function LanCard({ icon: Icon, iconClass, title, className = '', children }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800 ${className}`}>
      <div className="mb-4 flex items-center gap-2 border-b border-gray-100 pb-3 dark:border-slate-700">
        <Icon size={18} className={iconClass} />
        <h3 className="m-0 text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function LanRow({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="min-w-0 break-words font-semibold text-gray-900 sm:text-right dark:text-gray-100">{children}</span>
    </div>
  )
}

function wanStatusClass(status) {
  const value = String(status || '').trim().toLowerCase()
  return value === 'connected' || value === 'up' ? 'text-green-600' : 'text-red-500'
}

function WanField({ label, value, mono = false }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`m-0 mt-1 break-words font-semibold text-slate-800 dark:text-gray-100 ${mono ? 'font-mono text-xs' : 'text-sm'}`}>
        {value || '-'}
      </p>
    </div>
  )
}

const wanButtonClass = 'cursor-pointer rounded border-0 px-3 py-1.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60'

const WAN_SERVICE_OPTIONS = ['INTERNET', 'TR069', 'VOIP', 'IPTV', 'OTHER']
const WAN_CONNECTION_OPTIONS = ['IP_Routed', 'IP_Bridged', 'PPPoE_Bridged']
const WAN_ADDRESSING_OPTIONS = ['DHCP', 'Static']
const WAN_PORT_GROUPS = [
  {
    label: 'LAN',
    ports: [
      { key: 'lan1', label: 'LAN1' },
      { key: 'lan2', label: 'LAN2' },
      { key: 'lan3', label: 'LAN3' },
      { key: 'lan4', label: 'LAN4' },
    ],
  },
  {
    label: 'SSID',
    ports: [
      { key: 'ssid1', label: 'SSID1' },
      { key: 'ssid2', label: 'SSID2' },
      { key: 'ssid3', label: 'SSID3' },
      { key: 'ssid4', label: 'SSID4' },
    ],
  },
]

function emptyWanForm() {
  return {
    connectionName: '',
    enableConnection: true,
    natStatus: true,
    serviceList: 'INTERNET',
    connectionType: 'IP_Routed',
    vlanStatus: false,
    vlanId: '',
    username: '',
    password: '',
    addressing: 'DHCP',
    ipAddress: '',
    subnetMask: '',
    gateway: '',
    dnsServer: '',
    ports: { lan1: false, lan2: false, lan3: false, lan4: false, ssid1: false, ssid2: false, ssid3: false, ssid4: false },
  }
}

function wanText(value) {
  return !value || value === '-' ? '' : String(value)
}

function wanFormFrom(wan) {
  return {
    ...emptyWanForm(),
    connectionName: wanText(wan.name),
    enableConnection: wan.status !== 'Disabled',
    natStatus: wan.nat === 'Enabled',
    serviceList: wanText(wan.service) || 'INTERNET',
    connectionType: wan.transport === 'PPPoE' ? 'IP_Routed' : (wanText(wan.connType) || 'IP_Routed'),
    vlanStatus: wan.vlanId !== '-',
    vlanId: wan.vlanId !== '-' ? String(wan.vlanId) : '',
    username: wanText(wan.username),
    password: '',
    addressing: wan.ip !== '-' ? 'Static' : 'DHCP',
    ipAddress: wanText(wan.ip),
    gateway: wanText(wan.remoteIp),
    dnsServer: wanText(wan.dns),
  }
}

function optionsWithCurrent(options, value) {
  if (!value || options.includes(value)) {
    return options
  }
  return [value, ...options]
}

function WanPanel({ wans, loading, error, onOverlayChange, setWanToDelete, deletingWanPath }) {
  const [isWanPppOpen, setIsWanPppOpen] = useState(false)
  const [isWanIpOpen, setIsWanIpOpen] = useState(false)
  const [editingWanPath, setEditingWanPath] = useState(null)
  const [wanForm, setWanForm] = useState(emptyWanForm)
  const hasWans = Array.isArray(wans) && wans.length > 0

  useEffect(() => {
    onOverlayChange(isWanPppOpen || isWanIpOpen)
  }, [isWanPppOpen, isWanIpOpen, onOverlayChange])

  useEffect(() => () => onOverlayChange(false), [onOverlayChange])

  function updateWanField(key, value) {
    setWanForm((current) => ({ ...current, [key]: value }))
  }

  function updateWanPort(key, checked) {
    setWanForm((current) => ({
      ...current,
      ports: { ...current.ports, [key]: checked },
    }))
  }

  function closeWanModal() {
    setIsWanPppOpen(false)
    setIsWanIpOpen(false)
    setEditingWanPath(null)
    setWanForm(emptyWanForm())
  }

  function openAddWan(kind) {
    setEditingWanPath(null)
    setWanForm(emptyWanForm())
    setIsWanPppOpen(kind === 'ppp')
    setIsWanIpOpen(kind === 'ip')
  }

  function openEditWan(wan) {
    setEditingWanPath(wan.fullPath || null)
    setWanForm(wanFormFrom(wan))
    const ppp = wan.type === 'PPP' || wan.transport === 'PPPoE'
    setIsWanPppOpen(ppp)
    setIsWanIpOpen(!ppp)
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <button type="button" className={`${wanButtonClass} bg-green-500 hover:bg-green-600`} onClick={() => openAddWan('ip')}>
          Add WAN IP
        </button>
        <button type="button" className={`${wanButtonClass} bg-cyan-500 hover:bg-cyan-600`} onClick={() => openAddWan('ppp')}>
          Add WAN PPP
        </button>
      </div>

      {hasWans ? (
        wans.map((wan) => (
          <article key={wan.id} className="mb-4 overflow-hidden rounded border border-gray-200 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900">
            <header className="flex flex-wrap items-center justify-between gap-2 bg-cyan-500 px-4 py-2 text-white">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <span className="text-sm font-bold tracking-wide">WAN {wan.type}</span>
                <span className={`rounded-full bg-white px-2.5 py-0.5 text-xs font-bold ${wanStatusClass(wan.status)}`}>
                  {wan.status || '-'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="grid h-7 w-7 cursor-pointer place-items-center rounded border-0 bg-transparent text-white hover:bg-white/20"
                  aria-label={`Edit WAN ${wan.type}`}
                  onClick={() => openEditWan(wan)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="grid h-7 w-7 cursor-pointer place-items-center rounded border-0 bg-transparent text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Hapus WAN ${wan.type}`}
                  disabled={deletingWanPath === wan.fullPath}
                  onClick={() => setWanToDelete(wan)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </header>
            <div className="grid grid-cols-1 gap-4 p-4 text-sm md:grid-cols-4">
              <div className="grid gap-3">
                <WanField label="Status" value={wan.status} />
                <WanField label="IPAddress" value={wan.ip} />
                <WanField label="Username" value={wan.username} />
                <WanField label="VLANStatus" value={wan.vlanStatus} />
              </div>
              <div className="grid gap-3">
                <WanField label="ConnName" value={wan.name} />
                <WanField label="RemoteAddress" value={wan.remoteIp} />
                <WanField label="Password" value={wan.password} />
                <WanField label="VLANID" value={wan.vlanId} />
              </div>
              <div className="grid gap-3">
                <WanField label="Service" value={wan.service} />
                <WanField label="DNSServer" value={wan.dns} />
                <WanField label="ConnectionTrigger" value={wan.connTrigger} />
                <WanField label="NAT" value={wan.nat} />
              </div>
              <div className="grid gap-3">
                <WanField label="TransportType" value={wan.transport} />
                <WanField label="MACAddress" value={wan.mac} mono />
                <WanField label="ConnType" value={wan.connType} />
                <WanField label="Uptime" value={formatUptime(wan.uptime)} />
              </div>
            </div>
          </article>
        ))
      ) : (
        <p className="m-0 rounded-lg border border-gray-200 py-10 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-gray-400">
          {loading && 'Memuat koneksi WAN...'}
          {!loading && error && <span className="font-semibold text-red-600 dark:text-red-400">{error}</span>}
          {!loading && !error && 'Data koneksi WAN tidak ditemukan.'}
        </p>
      )}

      {isWanPppOpen && (
        <WanConfigModal
          variant="ppp"
          editing={Boolean(editingWanPath)}
          form={wanForm}
          onChange={updateWanField}
          onPortChange={updateWanPort}
          onClose={closeWanModal}
        />
      )}
      {isWanIpOpen && (
        <WanConfigModal
          variant="ip"
          editing={Boolean(editingWanPath)}
          form={wanForm}
          onChange={updateWanField}
          onPortChange={updateWanPort}
          onClose={closeWanModal}
        />
      )}
    </div>
  )
}

const EMPTY_LAN_FORM = {
  ip: '', subnet: '', dhcpEnabled: false, dhcpMin: '', dhcpMax: '', leaseTime: '', dns1: '', dns2: '', dns3: '',
}

// Pola IPv4 untuk validasi isian form (0-255 per segmen).
const IPV4_FORM_PATTERN = '^((25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$'
const IPV4_FORM_HINT = 'Format IPv4, contoh 192.168.1.1'

const wanFieldLabel = 'mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300'

function WanFieldCaption({ children }) {
  return <span className={wanFieldLabel}>{children}</span>
}

function WanTextControl({ label, className = '', ...props }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <WanFieldCaption>{label}</WanFieldCaption>
      <input className={formInput} {...props} />
    </label>
  )
}

function WanSelectControl({ label, value, options, onChange, className = '', disabled = false }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <WanFieldCaption>{label}</WanFieldCaption>
      <select className={formInput} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function WanCheckControl({ label, checked, onChange, accentClass, className = '' }) {
  return (
    <label className={`flex h-10 cursor-pointer items-center gap-2.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium whitespace-nowrap text-gray-800 select-none dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 ${className}`}>
      <input
        type="checkbox"
        className={`h-4 w-4 shrink-0 cursor-pointer ${accentClass}`}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

function WanSection({ icon: Icon, title, iconClass, children }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2.5 border-b border-gray-100 pb-2.5 dark:border-slate-700">
        <span className={`grid h-7 w-7 place-items-center rounded-md ${iconClass}`}>
          <Icon size={15} />
        </span>
        <h3 className="m-0 text-xs font-bold tracking-wider text-gray-700 uppercase dark:text-gray-200">{title}</h3>
      </div>
      {children}
    </section>
  )
}

// Form tambah koneksi WAN. Penyimpanan ke ONU belum dihubungkan.
function WanConfigModal({ variant, editing = false, form, onChange, onPortChange, onClose }) {
  const isPpp = variant === 'ppp'
  const dhcp = form.addressing === 'DHCP'
  const accentClass = isPpp ? 'accent-cyan-600' : 'accent-blue-600'
  const iconClass = isPpp
    ? 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/50 dark:text-cyan-300'
    : 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300'
  const saveClass = isPpp ? 'bg-cyan-500 hover:bg-cyan-600' : 'bg-blue-500 hover:bg-blue-600'
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const ipField = (field, label) => (
    <WanTextControl
      label={label}
      type="text"
      inputMode="decimal"
      placeholder="0.0.0.0"
      pattern={IPV4_FORM_PATTERN}
      title={IPV4_FORM_HINT}
      autoComplete="off"
      disabled={dhcp}
      readOnly={dhcp}
      required={!dhcp}
      value={form[field]}
      onChange={(event) => onChange(field, event.target.value.trim())}
    />
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <form
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wan-config-title"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault()
          onClose()
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-800">
          <div>
            <h2 id="wan-config-title" className="m-0 text-base font-bold text-gray-900 dark:text-gray-100">
              {isPpp ? 'Konfigurasi WAN PPP Connection' : 'Konfigurasi WAN IP'}
            </h2>
            <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {editing
                ? 'Ubah koneksi yang sudah ada. Sandi dikosongkan; isi ulang hanya bila ingin diganti.'
                : isPpp
                  ? 'Atur autentikasi PPPoE, VLAN, dan port binding koneksi baru.'
                  : 'Atur pengalamatan IP, VLAN, dan port binding koneksi baru.'}
            </p>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
            aria-label="Tutup"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3">
            <WanTextControl
              label="Connection Name"
              type="text"
              name="connectionName"
              placeholder="Nama koneksi"
              maxLength={128}
              required
              autoFocus
              value={form.connectionName}
              onChange={(event) => onChange('connectionName', event.target.value)}
            />
            <WanCheckControl
              label="Active"
              checked={form.enableConnection}
              accentClass={accentClass}
              onChange={(checked) => onChange('enableConnection', checked)}
            />
            <WanCheckControl
              label="Enable NAT"
              checked={form.natStatus}
              accentClass={accentClass}
              onChange={(checked) => onChange('natStatus', checked)}
            />
          </div>

          <div className={`grid grid-cols-1 items-end gap-4 sm:grid-cols-2 ${isPpp ? 'md:grid-cols-4' : 'md:grid-cols-[minmax(0,1.15fr)_minmax(0,1.4fr)_auto_minmax(0,0.85fr)_minmax(0,1fr)]'}`}>
            <WanSelectControl
              label="Service List"
              value={form.serviceList}
              options={optionsWithCurrent(WAN_SERVICE_OPTIONS, form.serviceList)}
              onChange={(value) => onChange('serviceList', value)}
            />
            <WanSelectControl
              label="Connection Type"
              value={form.connectionType}
              options={optionsWithCurrent(WAN_CONNECTION_OPTIONS, form.connectionType)}
              onChange={(value) => onChange('connectionType', value)}
            />
            <WanCheckControl
              label="VLAN Tagging"
              checked={form.vlanStatus}
              accentClass={accentClass}
              onChange={(checked) => onChange('vlanStatus', checked)}
            />
            <WanTextControl
              label="VLAN ID"
              type="number"
              name="vlanId"
              inputMode="numeric"
              min={1}
              max={4094}
              placeholder="1-4094"
              disabled={!form.vlanStatus}
              required={form.vlanStatus}
              value={form.vlanId}
              onChange={(event) => onChange('vlanId', event.target.value)}
            />
            {!isPpp && (
              <WanSelectControl
                label="Addressing"
                value={form.addressing}
                options={WAN_ADDRESSING_OPTIONS}
                onChange={(value) => onChange('addressing', value)}
              />
            )}
          </div>

          {isPpp ? (
            <WanSection icon={KeyRound} title="PPPoE Authentication" iconClass={iconClass}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <WanTextControl
                  label="Username"
                  type="text"
                  name="username"
                  autoComplete="off"
                  required
                  value={form.username}
                  onChange={(event) => onChange('username', event.target.value)}
                />
                <label className="block min-w-0">
                  <WanFieldCaption>Password</WanFieldCaption>
                  <div className="relative">
                    <input
                      className={`${formInput} pr-10`}
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      autoComplete="new-password"
                      required={!editing}
                      placeholder={editing ? 'Kosongkan jika tidak diubah' : undefined}
                      value={form.password}
                      onChange={(event) => onChange('password', event.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute top-1/2 right-1.5 grid h-7 w-7 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
                      aria-label={showPassword ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>
              </div>
            </WanSection>
          ) : (
            <WanSection icon={Network} title="IP Addressing Details" iconClass={iconClass}>
              {dhcp && (
                <p className="m-0 text-xs text-gray-500 dark:text-gray-400">
                  Mode DHCP aktif. Alamat IP, subnet, gateway, dan DNS diisi otomatis.
                </p>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {ipField('ipAddress', 'IP Address')}
                {ipField('subnetMask', 'Subnet Mask')}
                {ipField('gateway', 'Gateway')}
                {ipField('dnsServer', 'DNS Server')}
              </div>
            </WanSection>
          )}

          <WanSection icon={Cable} title="Port Binding" iconClass={iconClass}>
            <div className="grid gap-4">
              {WAN_PORT_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="m-0 mb-2 text-[11px] font-bold tracking-wider text-gray-400 uppercase">{group.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {group.ports.map((port) => {
                      const checked = Boolean(form.ports[port.key])
                      return (
                        <label
                          key={port.key}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${checked
                            ? isPpp
                              ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:border-cyan-500 dark:bg-cyan-950/40 dark:text-cyan-100'
                              : 'border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-100'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200 dark:hover:border-slate-500'}`}
                        >
                          <input
                            type="checkbox"
                            className={`h-4 w-4 shrink-0 cursor-pointer ${accentClass}`}
                            checked={checked}
                            onChange={(event) => onPortChange(port.key, event.target.checked)}
                          />
                          {port.label}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </WanSection>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-800">
          <button
            type="button"
            className="cursor-pointer rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-700"
            onClick={onClose}
          >
            Batal
          </button>
          <button
            type="submit"
            className={`cursor-pointer rounded-lg border-0 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors ${saveClass}`}
          >
            Simpan Konfigurasi
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

// Backend memakai '-' untuk nilai yang tidak ada; di form itu harus menjadi isian kosong.
function blankIfDash(value) {
  return !value || value === '-' ? '' : String(value)
}

function lanFormFrom(lanConfig) {
  return {
    ip: blankIfDash(lanConfig?.ip),
    subnet: blankIfDash(lanConfig?.subnet),
    dhcpEnabled: Boolean(lanConfig?.dhcpEnabled),
    dhcpMin: blankIfDash(lanConfig?.dhcpMin),
    dhcpMax: blankIfDash(lanConfig?.dhcpMax),
    leaseTime: blankIfDash(lanConfig?.leaseTime),
    dns1: blankIfDash(lanConfig?.dns?.[0]),
    dns2: blankIfDash(lanConfig?.dns?.[1]),
    dns3: blankIfDash(lanConfig?.dns?.[2]),
  }
}

function LanFormRow({ label, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-1/3 shrink-0 text-[13px] font-semibold text-gray-700 dark:text-gray-200">{label}</span>
      <div className="w-2/3">{children}</div>
    </div>
  )
}

function LanSectionTitle({ number, circleClass, children }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-white ${circleClass}`}>{number}</span>
      <h3 className="m-0 text-sm font-bold text-gray-900 dark:text-gray-100">{children}</h3>
    </div>
  )
}

// Pop-up edit LAN (berlapis di atas modal detail). Saat ini belum mengirim perubahan ke ONU.
function EditLanModal({ form, updating, onChange, onClose, onSubmit }) {
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const dhcpOff = !form.dhcpEnabled
  // Input alamat IPv4 (opsional kecuali required); disabled bila bagian DHCP dimatikan.
  const ipInput = (field, { required = false, disabled = false } = {}) => (
    <input
      className={formInput}
      type="text"
      inputMode="decimal"
      placeholder="0.0.0.0"
      pattern={IPV4_FORM_PATTERN}
      title={IPV4_FORM_HINT}
      required={required}
      disabled={disabled || updating}
      value={form[field]}
      onChange={(event) => onChange(field, event.target.value.trim())}
    />
  )

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <form
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acs-lan-edit-title"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-slate-700">
          <div>
            <h2 id="acs-lan-edit-title" className="m-0 text-base font-bold text-gray-900 dark:text-gray-100">
              Pengaturan Jaringan LAN
            </h2>
            <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Ubah konfigurasi IP dan layanan DHCP perangkat
            </p>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
            aria-label="Tutup"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          <LanSectionTitle number="1" circleClass="bg-blue-600">Konfigurasi IP Dasar</LanSectionTitle>

          <div className="grid gap-3.5">
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 dark:bg-slate-900/40">
              <span className="text-[13px] font-bold tracking-wide text-gray-700 dark:text-gray-200">DHCP SERVER</span>
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">Aktifkan</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.dhcpEnabled}
                  aria-label="Aktifkan DHCP Server"
                  disabled={updating}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-0 transition-colors ${form.dhcpEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-600'}`}
                  onClick={() => onChange('dhcpEnabled', !form.dhcpEnabled)}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${form.dhcpEnabled ? 'translate-x-5.5' : 'translate-x-0.5'}`}
                  />
                </button>
              </div>
            </div>

            <LanFormRow label="IP Gateway">{ipInput('ip', { required: true })}</LanFormRow>
            <LanFormRow label="Subnet Mask">{ipInput('subnet', { required: true })}</LanFormRow>

            <div className={dhcpOff ? 'grid gap-3.5 opacity-50' : 'grid gap-3.5'}>
              <LanFormRow label="DHCP Start IP">{ipInput('dhcpMin', { required: !dhcpOff, disabled: dhcpOff })}</LanFormRow>
              <LanFormRow label="DHCP End IP">{ipInput('dhcpMax', { required: !dhcpOff, disabled: dhcpOff })}</LanFormRow>
              <LanFormRow label="Lease Time">
                <div className="flex items-center gap-2">
                  <input
                    className={formInput}
                    type="text"
                    inputMode="numeric"
                    placeholder="86400"
                    pattern="[0-9]+"
                    title="Angka dalam detik"
                    disabled={dhcpOff || updating}
                    required={!dhcpOff}
                    value={form.leaseTime}
                    onChange={(event) => onChange('leaseTime', event.target.value.trim())}
                  />
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">sec</span>
                </div>
              </LanFormRow>
            </div>
          </div>

          <hr className="my-5 border-0 border-t border-gray-200 dark:border-slate-700" />

          <LanSectionTitle number="2" circleClass="bg-green-600">Domain Name Server (DNS)</LanSectionTitle>
          <div className="grid gap-3.5">
            <LanFormRow label="DNS Server 1">{ipInput('dns1')}</LanFormRow>
            <LanFormRow label="DNS Server 2">{ipInput('dns2')}</LanFormRow>
            <LanFormRow label="DNS Server 3">{ipInput('dns3')}</LanFormRow>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-slate-700">
          <button
            type="button"
            className="cursor-pointer rounded border-0 bg-transparent px-5 py-2 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
            onClick={onClose}
          >
            Batal
          </button>
          <button
            type="submit"
            className="cursor-pointer rounded border-0 bg-blue-600 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={updating}
          >
            {updating ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </form>
    </div>
  )
}

function DetailRow({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-gray-100 py-2 last:border-b-0 md:flex-row md:items-baseline md:justify-between md:gap-3 dark:border-slate-700">
      <dt className="shrink-0 text-xs font-bold tracking-wide text-gray-500 uppercase dark:text-gray-400">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-left text-sm font-medium text-gray-900 md:text-right dark:text-gray-100">{children}</dd>
    </div>
  )
}

function DetailIndicator({ label, children }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="m-0 text-xs font-bold tracking-widest text-gray-500 uppercase dark:text-gray-400">{label}</p>
      <div className="mt-2 text-lg font-bold text-gray-900 dark:text-gray-100">{children}</div>
    </div>
  )
}

// Modal detail satu ONU. Data diambil dari baris yang diklik (sudah bersih dari backend).
// Info pelanggan / host LAN belum punya sumber data, jadi memakai placeholder.
function DeviceDetailModal({
  device, activeTab, onTabChange, onClose, onSummon, summoning, hostsLoading, hostsError, wlansLoading, wlansError, lanLoading, lanError, wansLoading, wansError, onEditWlan, onEditLan, editOpen, renderRx, renderTemp, setWanToDelete, deletingWanPath, deleteConfirmOpen,
}) {
  const [wanOverlayOpen, setWanOverlayOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(event) {
      // Esc menutup modal detail hanya bila pop-up berlapis (WLAN, LAN, WAN) sedang tertutup.
      if (event.key === 'Escape' && !editOpen && !wanOverlayOpen && !deleteConfirmOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, editOpen, wanOverlayOpen, deleteConfirmOpen])

  const badge = STATUS_BADGE[device.status] || STATUS_BADGE.off24plus
  const hasHosts = Boolean(device?.connected_hosts && device.connected_hosts.length > 0)
  const hasWlans = Boolean(device?.wlans && device.wlans.length > 0)
  const lan = device?.lanConfig

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center overflow-x-hidden bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="max-h-[90vh] w-full min-w-0 max-w-5xl overflow-x-hidden overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="acs-detail-title"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6 dark:border-slate-700 dark:bg-slate-800">
          <h2 id="acs-detail-title" className="m-0 min-w-0 break-words text-base font-bold tracking-wide text-gray-900 dark:text-gray-100">
            DETAIL PERANGKAT
          </h2>
          <button
            type="button"
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
            aria-label="Tutup"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid min-w-0 gap-6 p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <DetailIndicator label="REDAMAN ONU">{renderRx(device.rx_onu)}</DetailIndicator>
            <DetailIndicator label="TEMPERATURE">{renderTemp(device.temp)}</DetailIndicator>
            <DetailIndicator label="UPTIME">{formatUptime(device.uptime)}</DetailIndicator>
          </div>

          <button
            type="button"
            className="w-full cursor-pointer rounded-md border-0 bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto md:justify-self-start"
            disabled={summoning}
            onClick={onSummon}
          >
            {summoning ? 'Memanggil...' : 'Summon'}
          </button>

          <div className="grid grid-cols-1 gap-x-8 gap-y-2 md:grid-cols-3">
            <dl className="m-0">
              <DetailRow label="Nama Pelanggan">{device.username ?? '-'}</DetailRow>
              <DetailRow label="No Layanan">-</DetailRow>
              <DetailRow label="Tgl Isolir">-</DetailRow>
            </dl>
            <dl className="m-0">
              <DetailRow label="Username">{device.username ?? '-'}</DetailRow>
              <DetailRow label="IP TR069"><IpLink ip={device.ip_tr069} /></DetailRow>
              <DetailRow label="SuperAdmin">-</DetailRow>
            </dl>
            <dl className="m-0">
              <DetailRow label="Status">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badge.className}`}>{badge.label}</span>
              </DetailRow>
              <DetailRow label="SerialNumber">{device.sn || '-'}</DetailRow>
              <DetailRow label="Last Inform">{formatDate(device.last_inform)}</DetailRow>
            </dl>
          </div>

          <div className="min-w-0">
            <div className="border-b border-gray-200 dark:border-slate-700">
              <div className="flex flex-wrap gap-1" role="tablist">
                {DETAIL_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-3 py-2.5 text-[13px] font-bold tracking-wide transition-colors sm:px-4 ${activeTab === tab ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                    onClick={() => onTabChange(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4">
              {activeTab === 'TERHUBUNG' ? (
                <div className="w-full max-w-[100vw] overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
                  <table className="w-full min-w-max border-collapse">
                    <thead>
                      <tr>
                        {HOST_COLUMNS.map((column) => (
                          <th key={column} className={thClass}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {hasHosts ? (
                        device.connected_hosts.map((host, index) => (
                          <tr key={`${host.mac}-${host.ip}-${index}`} className="border-b border-gray-100 last:border-b-0 dark:border-slate-700">
                            <td className={tdClass}>{index + 1}</td>
                            <td className={`${tdClass} font-semibold`}>{host.hostname}</td>
                            <td className={tdClass}>{host.ip}</td>
                            <td className={`${tdClass} font-mono text-xs`}>{host.mac}</td>
                            <td className={tdClass}>{host.type}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={HOST_COLUMNS.length} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                            {hostsLoading && 'Memuat daftar perangkat terhubung...'}
                            {!hostsLoading && hostsError && <span className="font-semibold text-red-600 dark:text-red-400">{hostsError}</span>}
                            {!hostsLoading && !hostsError && 'Tidak ada perangkat yang terhubung.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : activeTab === 'WLAN' ? (
                <div className="w-full max-w-[100vw] overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
                  <table className="w-full min-w-max border-collapse">
                    <thead>
                      <tr>
                        {WLAN_COLUMNS.map((column) => (
                          <th key={column} className={thClass}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {hasWlans ? (
                        device.wlans.map((wlan) => (
                          <tr
                            key={wlan.id}
                            className="cursor-pointer border-b border-gray-100 last:border-b-0 hover:bg-gray-100 dark:border-slate-700 dark:hover:bg-slate-700"
                            onClick={() => onEditWlan(wlan)}
                          >
                            <td className={tdClass}>{wlan.id}</td>
                            <td className={`${tdClass} font-semibold`}>{wlan.ssid}</td>
                            <td className={tdClass} onClick={(event) => event.stopPropagation()}><WlanPassword value={wlan.password} /></td>
                            <td className={tdClass}>{wlan.security}</td>
                            <td className={tdClass}>{wlan.freq}</td>
                            <td className={tdClass}>{wlan.band}</td>
                            <td className={tdClass}>{wlan.connected}</td>
                            <td className={tdClass}>
                              {wlan.status ? (
                                <span className="rounded border border-blue-600 px-2 py-1 text-xs font-bold text-blue-600 dark:border-blue-400 dark:text-blue-400">ENABLED</span>
                              ) : (
                                <span className="rounded border border-orange-500 px-2 py-1 text-xs font-bold text-orange-500">DISABLED</span>
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={WLAN_COLUMNS.length} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                            {wlansLoading && 'Memuat data WLAN...'}
                            {!wlansLoading && wlansError && <span className="font-semibold text-red-600 dark:text-red-400">{wlansError}</span>}
                            {!wlansLoading && !wlansError && 'Data WLAN tidak ditemukan.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : activeTab === 'LAN' ? (
                <div>
                  <div className="mb-4 flex justify-end">
                    <button
                      type="button"
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded border-0 bg-emerald-500 px-3 py-1 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
                      onClick={onEditLan}
                    >
                      <Pencil size={14} /> Edit LAN
                    </button>
                  </div>

                  {lan ? (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <LanCard icon={Server} iconClass="text-blue-600 dark:text-blue-400" title="IP GATEWAY">
                        <LanRow label="IP Gateway">{lan.ip || '-'}</LanRow>
                        <LanRow label="Subnet Mask">{lan.subnet || '-'}</LanRow>
                        <LanRow label="MAC Address"><span className="font-mono text-xs">{lan.mac || '-'}</span></LanRow>
                      </LanCard>

                      <LanCard icon={Network} iconClass="text-green-600 dark:text-green-400" title="DHCP SERVER">
                        <LanRow label="DHCP Status">
                          {lan.dhcpEnabled ? (
                            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-bold text-green-700 dark:bg-green-900/40 dark:text-green-300">ENABLED</span>
                          ) : (
                            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/40 dark:text-red-300">DISABLED</span>
                          )}
                        </LanRow>
                        <LanRow label="Rentang IP">
                          {!lan.dhcpMin || lan.dhcpMin === '-' || !lan.dhcpMax || lan.dhcpMax === '-' ? '-' : `${lan.dhcpMin} - ${lan.dhcpMax}`}
                        </LanRow>
                        <LanRow label="Lease Time">{!lan.leaseTime || lan.leaseTime === '-' ? '-' : `${lan.leaseTime} sec`}</LanRow>
                      </LanCard>

                      <LanCard
                        icon={Globe}
                        iconClass="text-green-600 dark:text-green-400"
                        title="Domain Name Server (DNS)"
                        className="md:col-span-2"
                      >
                        <div className="grid grid-cols-1 gap-4 text-center sm:grid-cols-3">
                          {[0, 1, 2].map((index) => (
                            <div key={index}>
                              <p className="m-0 text-xs text-gray-500 dark:text-gray-400">DNS Server {index + 1}</p>
                              <p className="m-0 mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">{lan.dns?.[index] || '-'}</p>
                            </div>
                          ))}
                        </div>
                      </LanCard>
                    </div>
                  ) : (
                    <p className="m-0 rounded-lg border border-gray-200 py-10 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-gray-400">
                      {lanLoading && 'Memuat konfigurasi LAN...'}
                      {!lanLoading && lanError && <span className="font-semibold text-red-600 dark:text-red-400">{lanError}</span>}
                      {!lanLoading && !lanError && 'Data LAN tidak ditemukan.'}
                    </p>
                  )}
                </div>
              ) : activeTab === 'WAN' ? (
                <WanPanel
                  wans={device?.wans}
                  loading={wansLoading}
                  error={wansError}
                  onOverlayChange={setWanOverlayOpen}
                  setWanToDelete={setWanToDelete}
                  deletingWanPath={deletingWanPath}
                />
              ) : (
                <p className="m-0 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  Tab {activeTab} belum tersedia.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function GenieAcs() {
  const [servers, setServers] = useState([])
  // Server wajib dipilih manual: kosong ('') = belum dipilih, data tidak dimuat.
  const [selectedServer, setSelectedServer] = useState('')
  const [serverModalOpen, setServerModalOpen] = useState(false)
  const [dataOnu, setDataOnu] = useState([])
  const [fetchedAt, setFetchedAt] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(10)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [activeTab, setActiveTab] = useState('TERHUBUNG')
  const [hostsState, setHostsState] = useState({ loading: false, error: '' })
  const [hostsReloadKey, setHostsReloadKey] = useState(0)
  const [wlansState, setWlansState] = useState({ loading: false, error: '' })
  const [wlansReloadKey, setWlansReloadKey] = useState(0)
  const [lanState, setLanState] = useState({ loading: false, error: '' })
  const [lanReloadKey, setLanReloadKey] = useState(0)
  const [wansState, setWansState] = useState({ loading: false, error: '' })
  const [wansReloadKey, setWansReloadKey] = useState(0)
  const [deletingWanPath, setDeletingWanPath] = useState(null)
  const [wanToDelete, setWanToDelete] = useState(null)
  const [editingWlan, setEditingWlan] = useState(null)
  const [wlanForm, setWlanForm] = useState(EMPTY_WLAN_FORM)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isEditLanOpen, setIsEditLanOpen] = useState(false)
  const [isUpdatingLan, setIsUpdatingLan] = useState(false)
  const [lanForm, setLanForm] = useState(EMPTY_LAN_FORM)
  const [isSummoning, setIsSummoning] = useState(false)
  const summonWaitRef = useRef(null)
  const selectedDeviceIdRef = useRef(null)
  const lastInformRef = useRef(null)

  const hasServer = selectedServer !== ''

  // RX ONU (dBm, sudah dikonversi backend): angka + dot warna + teks status. Kosong -> '-'.
  function renderRx(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '-'
    }
    const rx = Number(value)
    let label = 'Buruk'
    let warnaDot = 'bg-red-500'
    if (rx >= -20) {
      label = 'Bagus'
      warnaDot = 'bg-green-500'
    } else if (rx >= -25) {
      label = 'Sedang'
      warnaDot = 'bg-yellow-500'
    }
    // Di luar rentang wajar tetap ditampilkan apa adanya, hanya diberi tanda *.
    const abnormal = rx > RX_NORMAL_MAX || rx < RX_NORMAL_MIN
    return (
      <div
        className="flex items-center gap-1.5 whitespace-nowrap"
        title={abnormal ? `Di luar rentang wajar fiber (${RX_NORMAL_MIN} s/d ${RX_NORMAL_MAX} dBm)` : undefined}
      >
        <span>{rx.toFixed(2)}{abnormal && '*'}</span>
        <span className={`w-2.5 h-2.5 rounded-full ${warnaDot}`} />
        <span>{label}</span>
      </div>
    )
  }

  // TEMP (°C, sudah dikonversi backend). Kosong -> '-'.
  function renderTemp(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return '-'
    }
    return `${Number(value).toFixed(1)} °C`
  }

  const rows = useMemo(() => {
    if (!selectedServer) {
      return []
    }
    return dataOnu
      .filter((item) => item && item.id)
      .map((item) => toRow(item, fetchedAt))
      .sort((first, second) => second.sortKey - first.sortKey)
  }, [dataOnu, fetchedAt, selectedServer])

  // Statistik untuk seluruh ONU di server terpilih (tidak ikut filter/pencarian).
  const stats = useMemo(() => {
    const result = { ...EMPTY_STATS, total: rows.length }
    rows.forEach((row) => {
      result[row.status] += 1
    })
    return result
  }, [rows])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => (filter === 'all' || row.status === filter) && (!term || matchesSearch(row, term)))
  }, [rows, filter, search])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / limit))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * limit, currentPage * limit)
  const allSelected = pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))

  // Memuat daftar server untuk dropdown. Pilihan saat ini dipertahankan bila masih ada;
  // tidak pernah memilih server otomatis.
  const loadServers = useCallback(async (removedId = null) => {
    const list = await getAcsServers()
    const items = Array.isArray(list) ? list : []
    setServers(items)
    setSelectedServer((current) => {
      if (removedId !== null && current === String(removedId)) {
        return ''
      }
      return items.some((server) => String(server.id) === current) ? current : ''
    })
  }, [])

  useEffect(() => {
    loadServers().catch((requestError) => {
      setError(errorMessage(requestError, 'Gagal memuat daftar server ACS.'))
    })
  }, [loadServers])

  // Tarik data ONU dari GenieACS setiap server berubah (atau reload dipicu).
  useEffect(() => {
    // Guard: jangan fetch bila server belum dipilih.
    if (!selectedServer) {
      return undefined
    }
    const controller = new AbortController()

    async function load() {
      setIsLoading(true)
      setError('')
      try {
        const data = await getAcsDevices(selectedServer, { signal: controller.signal })
        if (controller.signal.aborted) {
          return
        }
        setDataOnu(Array.isArray(data) ? data : [])
        setFetchedAt(Date.now())
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }
        setDataOnu([])
        setError(errorMessage(requestError, 'Gagal terhubung ke server GenieACS'))
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    load()
    return () => controller.abort()
  }, [selectedServer, reloadKey])

  const reload = () => setReloadKey((key) => key + 1)

  // Daftar klien terhubung diambil per perangkat saat modal dibuka (tidak ikut daftar ONU).
  const selectedDeviceId = selectedDevice?.id ?? null

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDevice?._id || selectedDevice?.id || null
    lastInformRef.current = selectedDevice?.last_inform ?? null
  }, [selectedDevice])

  // GET /api/acs/devices/:id — ringkasan mutakhir satu ONU. Tidak menghapus data tab (host, WLAN, LAN, WAN).
  const fetchDeviceDetail = useCallback(async (id, config = {}) => {
    const device = await getAcsDevice(selectedServer, id, config)
    const fresh = {
      ...device,
      id: String(device.id),
      _id: String(device.id),
      status: statusFromInform(device.last_inform, Date.now()),
    }
    setSelectedDevice((current) => {
      if (!current || (current._id || current.id) !== id) {
        return current
      }
      return {
        ...current,
        ...fresh,
        connected_hosts: current.connected_hosts,
        wlans: current.wlans,
        lanConfig: current.lanConfig,
        wans: current.wans,
      }
    })
    setDataOnu((current) => current.map((item) => (item.id === id ? { ...item, ...device, id: fresh.id } : item)))
    setFetchedAt(Date.now())
    return fresh
  }, [selectedServer])

  // Auto-refresh saat modal terbuka. Hanya id yang didengarkan: hasil fetch memperbarui
  // objek yang sama dan tidak boleh memicu permintaan berulang.
  useEffect(() => {
    if (!selectedDeviceId || !selectedServer) {
      return undefined
    }
    const controller = new AbortController()

    async function loadDetail() {
      try {
        await fetchDeviceDetail(selectedDeviceId, { signal: controller.signal })
      } catch {
        // Data yang sudah tampil di modal tetap dipakai bila penyegaran gagal.
      }
    }

    loadDetail()
    return () => controller.abort()
  }, [selectedDeviceId, selectedServer, fetchDeviceDetail])

  useEffect(() => {
    if (!selectedDeviceId || !selectedServer) {
      return undefined
    }
    const controller = new AbortController()

    async function loadHosts() {
      setHostsState({ loading: true, error: '' })
      try {
        const result = await getAcsDeviceHosts(selectedServer, selectedDeviceId, { signal: controller.signal })
        if (controller.signal.aborted) {
          return
        }
        const connectedHosts = Array.isArray(result?.connected_hosts) ? result.connected_hosts : []
        setSelectedDevice((current) => (current && current.id === selectedDeviceId
          ? { ...current, connected_hosts: connectedHosts }
          : current))
        setHostsState({ loading: false, error: '' })
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }
        setHostsState({ loading: false, error: errorMessage(requestError, 'Gagal memuat perangkat terhubung.') })
      }
    }

    loadHosts()
    return () => controller.abort()
  }, [selectedDeviceId, selectedServer, hostsReloadKey])

  // Konfigurasi LAN diambil saat tab LAN dibuka (data lama tetap tampil selama dimuat ulang).
  const lanTabActive = activeTab === 'LAN'
  useEffect(() => {
    if (!selectedDeviceId || !selectedServer || !lanTabActive) {
      return undefined
    }
    const controller = new AbortController()

    async function loadLan() {
      setLanState({ loading: true, error: '' })
      try {
        const result = await getAcsDeviceLan(selectedServer, selectedDeviceId, { signal: controller.signal })
        if (controller.signal.aborted) {
          return
        }
        const lanConfig = result?.lanConfig ?? null
        setSelectedDevice((current) => (current && current.id === selectedDeviceId ? { ...current, lanConfig } : current))
        setLanState({ loading: false, error: '' })
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }
        setLanState({ loading: false, error: errorMessage(requestError, 'Gagal memuat konfigurasi LAN.') })
      }
    }

    loadLan()
    return () => controller.abort()
  }, [selectedDeviceId, selectedServer, lanTabActive, lanReloadKey])

  // Daftar koneksi WAN diambil saat tab WAN dibuka.
  const wanTabActive = activeTab === 'WAN'
  useEffect(() => {
    if (!selectedDeviceId || !selectedServer || !wanTabActive) {
      return undefined
    }
    const controller = new AbortController()

    async function loadWans() {
      setWansState({ loading: true, error: '' })
      try {
        const result = await getAcsDeviceWans(selectedServer, selectedDeviceId, { signal: controller.signal })
        if (controller.signal.aborted) {
          return
        }
        const wans = Array.isArray(result?.wans) ? result.wans : []
        setSelectedDevice((current) => (current && current.id === selectedDeviceId ? { ...current, wans } : current))
        setWansState({ loading: false, error: '' })
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }
        setWansState({ loading: false, error: errorMessage(requestError, 'Gagal memuat koneksi WAN.') })
      }
    }

    loadWans()
    return () => controller.abort()
  }, [selectedDeviceId, selectedServer, wanTabActive, wansReloadKey])

  useLayoutEffect(() => {
    if (editingWlan) {
      setWlanForm(wlanFormFrom(editingWlan))
    }
  }, [editingWlan])

  // Daftar WiFi diambil saat tab WLAN dibuka (data lama tetap tampil selama dimuat ulang).
  const wlanTabActive = activeTab === 'WLAN'
  useEffect(() => {
    if (!selectedDeviceId || !selectedServer || !wlanTabActive) {
      return undefined
    }
    const controller = new AbortController()

    async function loadWlans() {
      setWlansState({ loading: true, error: '' })
      try {
        const result = await getAcsDeviceWlans(selectedServer, selectedDeviceId, { signal: controller.signal })
        if (controller.signal.aborted) {
          return
        }
        const wlans = Array.isArray(result?.wlans) ? result.wlans : []
        setSelectedDevice((current) => (current && current.id === selectedDeviceId ? { ...current, wlans } : current))
        setWlansState({ loading: false, error: '' })
      } catch (requestError) {
        if (controller.signal.aborted) {
          return
        }
        setWlansState({ loading: false, error: errorMessage(requestError, 'Gagal memuat data WLAN.') })
      }
    }

    loadWlans()
    return () => controller.abort()
  }, [selectedDeviceId, selectedServer, wlanTabActive, wlansReloadKey])

  function resetView() {
    setPage(1)
    setSelected(new Set())
  }

  function stopSummonWait() {
    const wait = summonWaitRef.current
    if (!wait || wait.settled) {
      return false
    }
    wait.settled = true
    clearInterval(wait.intervalId)
    clearTimeout(wait.timeoutId)
    wait.controller.abort()
    summonWaitRef.current = null
    setIsSummoning(false)
    return true
  }

  useEffect(() => () => {
    const wait = summonWaitRef.current
    if (!wait) {
      return
    }
    wait.settled = true
    clearInterval(wait.intervalId)
    clearTimeout(wait.timeoutId)
    wait.controller.abort()
    summonWaitRef.current = null
  }, [])

  function closeDevice() {
    stopSummonWait()
    setIsSummoning(false)
    setEditingWlan(null)
    setIsEditLanOpen(false)
    setWanToDelete(null)
    setSelectedDevice(null)
  }

  function handleTabChange(tab) {
    if (tab === 'WLAN') {
      setWlansState({ loading: true, error: '' })
    }
    if (tab === 'LAN') {
      setLanState({ loading: true, error: '' })
    }
    if (tab === 'WAN') {
      setWansState({ loading: true, error: '' })
    }
    setActiveTab(tab)
  }

  function openDevice(item) {
    const id = item?._id || item?.id
    setActiveTab('TERHUBUNG')
    setWlansState({ loading: false, error: '' })
    setLanState({ loading: false, error: '' })
    setWansState({ loading: false, error: '' })
    setHostsState({ loading: true, error: '' })
    setSelectedDevice({ ...item, id, _id: id })
  }

  function handleServerChange(event) {
    const value = event.target.value
    setSelectedServer(value)
    closeDevice()
    setDataOnu([])
    setError('')
    resetView()
  }

  function toggleOne(id) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current)
      pageRows.forEach((row) => (allSelected ? next.delete(row.id) : next.add(row.id)))
      return next
    })
  }

  function requireServer() {
    if (hasServer) {
      return true
    }
    Swal.fire({ icon: 'warning', title: 'Pilih server', text: 'Pilih server ACS terlebih dahulu.' })
    return false
  }

  async function confirmDeleteWan(wan) {
    const id = selectedDevice?._id || selectedDevice?.id
    if (!requireServer() || !id || deletingWanPath) {
      return
    }
    if (!wan?.fullPath) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: 'Path WAN tidak tersedia. Muat ulang tab WAN.' })
      return
    }
    setDeletingWanPath(wan.fullPath)
    try {
      const result = await deleteAcsWan({
        server_id: selectedServer,
        deviceId: id,
        wanPath: wan.fullPath,
      })
      await fetchDeviceDetail(id)
      setWansReloadKey((key) => key + 1)
      setWanToDelete(null)
      Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: result.message,
        timer: 2200,
        showConfirmButton: false,
      })
    } catch (requestError) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: errorMessage(requestError, 'Gagal menghapus koneksi WAN.') })
    } finally {
      setDeletingWanPath(null)
    }
  }

  // Summon satu ONU dari modal detail. Perangkat offline ditolak sebelum request.
  // Bila GenieACS menerima (terkirim atau diantrekan), alert hijau ditampilkan,
  // lalu data dimuat ulang sampai last_inform berubah atau 35 detik.
  async function handleSummonDevice(device) {
    if (!requireServer() || isSummoning) {
      return
    }
    const id = device?._id || device?.id
    if (!id) {
      return
    }
    if (deviceIsOffline(device)) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal',
        text: 'Gagal: Perangkat sedang offline, tidak dapat melakukan summon.',
      })
      return
    }
    stopSummonWait()
    const previousInform = device.last_inform
    setIsSummoning(true)
    let baseline = previousInform
    let accepted = null
    try {
      const result = await summonAcsDevices(selectedServer, [id])
      if (selectedDeviceIdRef.current !== id) {
        setIsSummoning(false)
        return
      }
      if (!result?.success) {
        setIsSummoning(false)
        Swal.fire({
          icon: 'error',
          title: 'Gagal',
          text: result?.message || 'Gagal menjalankan Summon.',
        })
        return
      }
      accepted = result
    } catch (requestError) {
      if (selectedDeviceIdRef.current !== id) {
        setIsSummoning(false)
        return
      }
      setIsSummoning(false)
      Swal.fire({ icon: 'error', title: 'Gagal', text: errorMessage(requestError, 'Gagal menjalankan Summon.') })
      return
    }

    if (selectedDeviceIdRef.current !== id) {
      setIsSummoning(false)
      return
    }

    const acceptedText = accepted?.results?.length === 1
      ? accepted.results[0].message
      : accepted?.message
    setIsSummoning(false)
    Swal.fire({
      icon: 'success',
      title: 'Berhasil',
      text: acceptedText || 'Summon berhasil.',
      timer: 2200,
      showConfirmButton: false,
    })

    // Inform yang masuk saat modal baru dibuka (sebelum ONT menjawab Summon) bukan bukti respons.
    if (isNewerInform(lastInformRef.current, previousInform)) {
      baseline = lastInformRef.current
    }

    const controller = new AbortController()
    const wait = { controller, intervalId: 0, timeoutId: 0, settled: false, polling: false }
    summonWaitRef.current = wait

    async function poll() {
      if (wait.settled || wait.polling) {
        return
      }
      wait.polling = true
      try {
        const fresh = await fetchDeviceDetail(id, { signal: controller.signal })
        if (selectedDeviceIdRef.current !== id || summonWaitRef.current !== wait) {
          return
        }
        if (!wait.settled && isNewerInform(fresh?.last_inform, baseline) && stopSummonWait()) {
          setHostsReloadKey((key) => key + 1)
          setWlansReloadKey((key) => key + 1)
          setLanReloadKey((key) => key + 1)
          setWansReloadKey((key) => key + 1)
        }
      } catch {
        // Dibatalkan atau ACS belum terjangkau. Polling berlanjut sampai batas waktu.
      } finally {
        wait.polling = false
      }
    }

    poll()
    wait.intervalId = setInterval(poll, 3000)
    wait.timeoutId = setTimeout(() => {
      if (summonWaitRef.current === wait) {
        stopSummonWait()
      }
    }, 35000)
  }

  // Push perubahan WLAN ke ONU (POST /api/acs/update-wlan -> setParameterValues di GenieACS).
  async function handleUpdateWlan() {
    if (!requireServer() || !selectedDevice || !editingWlan || isUpdating) {
      return
    }

    const confirm = await Swal.fire({
      title: 'Kirim perubahan WLAN?',
      text: 'Perubahan dikirim ke ONU. Perangkat yang tersambung lewat WiFi ini bisa terputus sementara.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Update',
      cancelButtonText: 'Batal',
    })
    if (!confirm.isConfirmed) {
      return
    }

    setIsUpdating(true)
    try {
      const result = await updateAcsWlan({
        server_id: selectedServer,
        deviceId: selectedDevice.id,
        wlanId: editingWlan.id,
        ssid: wlanForm.ssid,
        security: wlanForm.security,
        password: isOpenSecurity(wlanForm.security) ? '' : wlanForm.password,
        status: wlanForm.status,
      })
      setEditingWlan(null)
      Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: result.message,
        timer: 2500,
        showConfirmButton: false,
      })
      // Beri waktu ONU melapor balik ke ACS, lalu muat ulang daftar WLAN dan tabel utama.
      setTimeout(() => {
        setWlansReloadKey((key) => key + 1)
        reload()
      }, 2500)
    } catch (requestError) {
      // Pop-up tetap terbuka supaya isian tidak hilang dan bisa dicoba lagi.
      Swal.fire({ icon: 'error', title: 'Gagal', text: errorMessage(requestError, 'Gagal mengirim perubahan WLAN.') })
    } finally {
      setIsUpdating(false)
    }
  }

  // Tombol Edit LAN: isi form dari konfigurasi LAN saat ini lalu buka pop-up.
  function handleEditLan() {
    setLanForm(lanFormFrom(selectedDevice?.lanConfig))
    setIsEditLanOpen(true)
  }

  // Push perubahan LAN ke ONU (POST /api/acs/update-lan -> setParameterValues di GenieACS).
  async function handleUpdateLan() {
    if (!requireServer() || !selectedDevice || isUpdatingLan) {
      return
    }

    // Mengubah IP/subnet LAN memutus akses lokal ke ONU lewat alamat lama, jadi konfirmasinya lebih tegas.
    const current = selectedDevice.lanConfig
    const addressChanged = lanForm.ip !== blankIfDash(current?.ip) || lanForm.subnet !== blankIfDash(current?.subnet)
    const confirm = await Swal.fire({
      title: 'Simpan pengaturan LAN?',
      html: addressChanged
        ? 'IP Gateway / Subnet Mask <b>berubah</b>. Akses lokal ke ONU lewat alamat lama akan terputus dan perangkat di jaringan LAN perlu mendapat IP baru.'
        : 'Perubahan akan dikirim ke ONU.',
      icon: addressChanged ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Simpan',
      confirmButtonColor: addressChanged ? '#dc2626' : undefined,
      cancelButtonText: 'Batal',
    })
    if (!confirm.isConfirmed) {
      return
    }

    setIsUpdatingLan(true)
    try {
      const result = await updateAcsLan({
        server_id: selectedServer,
        deviceId: selectedDevice.id,
        ...lanForm,
      })
      setIsEditLanOpen(false)
      Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: result.message,
        timer: 2500,
        showConfirmButton: false,
      })
      // Beri waktu ONU melapor balik ke ACS, lalu muat ulang konfigurasi LAN agar tampilan terbarui.
      setTimeout(() => setLanReloadKey((key) => key + 1), 2500)
    } catch (requestError) {
      // Pop-up tetap terbuka supaya isian tidak hilang dan bisa dicoba lagi.
      Swal.fire({ icon: 'error', title: 'Gagal', text: errorMessage(requestError, 'Gagal mengirim perubahan LAN.') })
    } finally {
      setIsUpdatingLan(false)
    }
  }

  async function handleSync() {
    if (!requireServer()) {
      return
    }
    setBusy('sync')
    try {
      const result = await syncAcs(selectedServer)
      await Swal.fire({ icon: 'success', title: 'Sinkron selesai', text: result.message, timer: 2500, showConfirmButton: false })
      resetView()
      reload()
    } catch (requestError) {
      Swal.fire({ icon: 'error', title: 'Sinkron gagal', text: errorMessage(requestError, 'Gagal sinkron dengan GenieACS.') })
    } finally {
      setBusy('')
    }
  }

  async function handleBulkAction(action) {
    if (!requireServer()) {
      return
    }
    if (selected.size === 0) {
      Swal.fire({ icon: 'warning', title: 'Belum ada ONU dipilih', text: 'Centang minimal satu ONU di tabel.' })
      return
    }

    const ids = [...selected]
    if (action.key === 'summon') {
      const chosen = dataOnu.filter((item) => selected.has(item.id))
      if (chosen.length > 0 && chosen.every((item) => deviceIsOffline(item))) {
        Swal.fire({
          icon: 'error',
          title: 'Gagal',
          text: 'Gagal: Perangkat sedang offline, tidak dapat melakukan summon.',
        })
        return
      }
    }
    const confirm = await Swal.fire({
      title: action.confirm.title,
      text: action.confirm.text(ids.length),
      icon: action.confirm.danger ? 'warning' : 'question',
      showCancelButton: true,
      confirmButtonText: action.confirm.button,
      confirmButtonColor: action.confirm.danger ? '#dc2626' : undefined,
      cancelButtonText: 'Batal',
    })
    if (!confirm.isConfirmed) {
      return
    }

    setBusy(action.key)
    try {
      const result = await action.run(selectedServer, ids)
      let icon = 'warning'
      if (result.success) {
        icon = 'success'
      } else if (result.berhasil === 0) {
        icon = 'error'
      }
      await Swal.fire({ icon, title: action.label, text: result.message })
      if (action.clearsSelection) {
        setSelected(new Set())
      }
      if (action.reloads) {
        reload()
      }
    } catch (requestError) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: errorMessage(requestError, `Gagal menjalankan ${action.label}.`) })
    } finally {
      setBusy('')
    }
  }

  async function handleServersChanged(removedId = null) {
    await loadServers(removedId)
    if (removedId !== null && String(removedId) === selectedServer) {
      // Server yang sedang dipilih dihapus: bersihkan data dan error miliknya.
      setDataOnu([])
      setError('')
    }
    resetView()
  }

  const actionsDisabled = Boolean(busy)

  return (
    <section className="grid gap-5">
      <header>
        <p className="m-0 mb-1.5 text-[13px] font-bold tracking-[0.12em] text-cyan-700 uppercase dark:text-cyan-300">
          Manajemen Perangkat
        </p>
        <h1 className="m-0 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">GenieACS</h1>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAT_CARDS.map((card) => (
          <div key={card.key} className={`rounded-2xl p-5 text-white shadow-lg ${card.className}`}>
            <p className="m-0 text-xs font-bold tracking-widest opacity-90">{card.label}</p>
            <p className="m-0 mt-2 text-3xl font-extrabold">{(stats[card.key] ?? 0).toLocaleString('id-ID')}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          {BULK_ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              className={`${btnBase} ${action.className}`}
              disabled={actionsDisabled}
              onClick={() => handleBulkAction(action)}
            >
              {busy === action.key ? '...' : action.label}
            </button>
          ))}
          <button
            type="button"
            className={`${btnBase} bg-emerald-600 hover:bg-emerald-700`}
            disabled={actionsDisabled}
            onClick={handleSync}
          >
            {busy === 'sync' ? 'MENYINKRON...' : 'SINKRON'}
          </button>
          <button
            type="button"
            className={`${btnBase} bg-indigo-600 hover:bg-indigo-700`}
            onClick={() => setServerModalOpen(true)}
          >
            SERVER
          </button>
          {selected.size > 0 && (
            <span className="ml-auto text-[13px] font-semibold text-gray-600 dark:text-gray-300">
              {selected.size} ONU dipilih
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_minmax(0,1.5fr)]">
          <select
            className={inputBase}
            aria-label="Pilih server"
            value={selectedServer}
            onChange={handleServerChange}
          >
            <option value="" disabled hidden>--- Pilih Server ACS ---</option>
            {servers.map((server) => (
              <option key={server.id} value={String(server.id)}>{server.nama_server}</option>
            ))}
          </select>
          <select
            className={inputBase}
            aria-label="Filter status ONU"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
              resetView()
            }}
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className={inputBase}
            aria-label="Jumlah data per halaman"
            value={limit}
            onChange={(event) => {
              setLimit(Number(event.target.value))
              resetView()
            }}
          >
            {LIMIT_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <input
            className={inputBase}
            type="search"
            placeholder="Cari username, SN, IP, SSID..."
            aria-label="Pencarian"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse">
            <thead>
              <tr>
                <th className={`${thClass} w-10`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-blue-600"
                    aria-label="Pilih semua di halaman ini"
                    checked={allSelected}
                    disabled={pageRows.length === 0 || isLoading}
                    onChange={toggleAll}
                  />
                </th>
                {COLUMNS.map((column) => (
                  <th key={column} className={thClass}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading || pageRows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    {hasServer && isLoading && 'Loading data dari server...'}
                    {!(hasServer && isLoading) && error && <span className="font-semibold text-red-600 dark:text-red-400">{error}</span>}
                    {!error && !hasServer && 'Silakan pilih Server ACS terlebih dahulu untuk menampilkan data perangkat.'}
                    {!isLoading && !error && hasServer && rows.length === 0 && 'Server GenieACS ini belum memiliki perangkat.'}
                    {!isLoading && !error && hasServer && rows.length > 0 && 'Tidak ada ONU yang cocok dengan filter/pencarian.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((item) => {
                  const flag = FLAG_STYLE[item.status] || FLAG_STYLE.off24plus
                  const isSelected = selected.has(item.id)
                  return (
                    <tr
                      key={item.id}
                      className={`cursor-pointer border-b border-gray-100 last:border-b-0 dark:border-gray-700 ${isSelected ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-gray-100 dark:hover:bg-slate-700'}`}
                      onClick={() => openDevice(item)}
                    >
                      <td className={tdClass} onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-blue-600"
                          aria-label={`Pilih ${item.sn || item.id}`}
                          checked={isSelected}
                          onChange={() => toggleOne(item.id)}
                        />
                      </td>
                      <td className={tdClass}>
                        <span title={flag.title} className="inline-flex">
                          <Flag size={16} className={flag.className} fill="currentColor" aria-label={flag.title} />
                        </span>
                      </td>
                      <td className={`${tdClass} font-semibold`}>{item.username ?? '-'}</td>
                      <td className={tdClass}><IpLink ip={item.ip_pppoe} /></td>
                      <td className={tdClass}><IpLink ip={item.ip_tr069} /></td>
                      <td className={tdClass}>{item.sn || '-'}</td>
                      <td className={tdClass}>{item.pon ?? '-'}</td>
                      <td className={tdClass}>{item.manufaktur || '-'}</td>
                      <td className={tdClass}>{item.tipe || '-'}</td>
                      <td className={tdClass}>{item.ssid ?? '-'}</td>
                      <td className={tdClass}>{item.user ?? '-'}</td>
                      <td className={tdClass}>{renderRx(item.rx_onu)}</td>
                      <td className={tdClass}>{renderTemp(item.temp)}</td>
                      <td className={tdClass}>{formatUptime(item.uptime)}</td>
                      <td className={tdClass}>{formatDate(item.last_inform)}</td>
                      <td className={tdClass}>{formatDate(item.registered)}</td>
                      <td className={`${tdClass} max-w-64 truncate font-mono text-xs`} title={item.id}>
                        {item.id}
                      </td>
                      <td className={tdClass}>
                        {item.tags.length > 0 ? (
                          <div className="flex gap-1">
                            {item.tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-900/50 dark:text-sky-200"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : '-'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <ServerPagination
          page={currentPage}
          totalPages={totalPages}
          totalData={filteredRows.length}
          limit={limit}
          disabled={isLoading}
          label="Navigasi halaman ONU"
          onPageChange={setPage}
        />
      </div>

      {selectedDevice && (
        <DeviceDetailModal
          device={selectedDevice}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onClose={closeDevice}
          onEditWlan={setEditingWlan}
          editOpen={Boolean(editingWlan) || isEditLanOpen}
          onSummon={() => handleSummonDevice(selectedDevice)}
          summoning={isSummoning}
          hostsLoading={hostsState.loading}
          hostsError={hostsState.error}
          wlansLoading={wlansState.loading}
          wlansError={wlansState.error}
          lanLoading={lanState.loading}
          lanError={lanState.error}
          wansLoading={wansState.loading}
          wansError={wansState.error}
          onEditLan={handleEditLan}
          setWanToDelete={setWanToDelete}
          deletingWanPath={deletingWanPath}
          deleteConfirmOpen={Boolean(wanToDelete)}
          renderRx={renderRx}
          renderTemp={renderTemp}
        />
      )}

      {selectedDevice && editingWlan && (
        <EditWlanModal
          wlan={editingWlan}
          form={wlanForm}
          updating={isUpdating}
          onChange={(field, value) => setWlanForm((current) => {
            const next = { ...current, [field]: value }
            if (field === 'security' && isOpenSecurity(value)) {
              next.password = ''
            }
            return next
          })}
          onClose={() => setEditingWlan(null)}
          onSubmit={handleUpdateWlan}
        />
      )}

      {selectedDevice && isEditLanOpen && (
        <EditLanModal
          form={lanForm}
          updating={isUpdatingLan}
          onChange={(field, value) => setLanForm((current) => ({ ...current, [field]: value }))}
          onClose={() => setIsEditLanOpen(false)}
          onSubmit={handleUpdateLan}
        />
      )}

      {serverModalOpen && (
        <ServerModal
          servers={servers}
          onClose={() => setServerModalOpen(false)}
          onChanged={handleServersChanged}
        />
      )}

      {wanToDelete && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black bg-opacity-60 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 text-center shadow-xl dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="wan-delete-title">
            <TriangleAlert className="mx-auto text-amber-500" size={48} aria-hidden="true" />
            <h2 id="wan-delete-title" className="m-0 mt-4 text-lg font-bold text-gray-900 dark:text-gray-100">Hapus Koneksi WAN?</h2>
            <p className="m-0 mt-2 text-sm text-gray-500 dark:text-gray-400">
              Apakah Anda yakin ingin menghapus WAN {wanToDelete.name && wanToDelete.name !== '-' ? wanToDelete.name : wanToDelete.type}? Tindakan ini akan memutuskan koneksi terkait.
            </p>
            <div className="mt-6 flex justify-center gap-4">
              <button
                type="button"
                className="cursor-pointer rounded-md border-0 bg-gray-500 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={Boolean(deletingWanPath)}
                onClick={() => setWanToDelete(null)}
              >
                Batal
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-md border-0 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={Boolean(deletingWanPath)}
                onClick={() => confirmDeleteWan(wanToDelete)}
              >
                {deletingWanPath ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}

export default GenieAcs
