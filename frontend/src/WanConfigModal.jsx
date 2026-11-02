import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Cable, Eye, EyeOff, KeyRound, Network, X } from 'lucide-react'
import Swal from 'sweetalert2'
import { fireError, fireSuccess } from './swals.js'

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback
}

const IPV4_FORM_PATTERN = '^((25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])$'
const IPV4_FORM_HINT = 'Format IPv4, contoh 192.168.1.1'

const formInput =
  'h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 dark:disabled:bg-slate-700'

// Tipe Perangkat menentukan Connection Name. Fiberhome membuat nama koneksi sendiri, jadi tidak dikirim.
export const WAN_DEVICE_TYPES = ['ZTE', 'Huawei', 'ChinaMobile', 'Fiberhome']
export const FIBERHOME_AUTO_NAME = 'Otomatis'

export function deviceTypeFromManufacturer(manufacturer) {
  const compact = String(manufacturer || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (compact.includes('fiberhome') || compact.includes('fhtt')) {
    return 'Fiberhome'
  }
  if (compact.includes('huawei')) {
    return 'Huawei'
  }
  if (compact.includes('chinamobile') || compact.includes('cmcc')) {
    return 'ChinaMobile'
  }
  return 'ZTE'
}

// Pilihan user, atau tebakan dari merek ONU yang terbaca di ACS bila belum dipilih.
export function resolveDeviceType(deviceType, manufacturer) {
  return WAN_DEVICE_TYPES.includes(deviceType) ? deviceType : deviceTypeFromManufacturer(manufacturer)
}

const WAN_SERVICE_OPTIONS = ['INTERNET', 'TR069', 'VOIP', 'IPTV', 'OTHER']
const WAN_IP_CONNECTION_OPTIONS = ['IP_Routed', 'IP_Bridged']
// Dropdown WAN PPP. ZTE/Huawei: ip-routed dan pppoe_bridged.
// FiberHome serta merek sejenis (firmware yang memajang PPPoE_Routed) menambah pppoe_routed.
const PPP_ROUTED_BRANDS = ['fhtt', 'cdata', 'c-data', 'vsol', 'hioso', 'optilink', 'bdcom']

function pppConnectionOptions(manufacturer, deviceType = '') {
  const name = String(manufacturer || '').toLowerCase()
  const compact = name.replace(/[^a-z0-9]+/g, '')
  const options = ['ip-routed', 'pppoe_bridged']
  const similar = PPP_ROUTED_BRANDS.some((brand) => name.includes(brand) || compact.includes(brand.replace(/-/g, '')))
  const pickedFiberhome = String(deviceType || '').toLowerCase() === 'fiberhome'
  if (pickedFiberhome || name.includes('fiberhome') || compact.includes('fiberhome') || similar) {
    options.push('pppoe_routed')
  }
  return options
}

function pppShowsAuth(connectionType) {
  return connectionType === 'ip-routed' || connectionType === 'ip_routed' || connectionType === 'pppoe_routed'
}

export function uiPppConnectionType(value) {
  const text = String(value || '').trim().toLowerCase().replace(/-/g, '_')
  if (text === 'pppoe_bridged') {
    return 'pppoe_bridged'
  }
  if (text === 'pppoe_routed') {
    return 'pppoe_routed'
  }
  return 'ip-routed'
}
const WAN_ADDRESSING_OPTIONS = ['DHCP', 'Static']
const WAN_LAN_PORTS = [
  { key: 'lan1', label: 'LAN1' },
  { key: 'lan2', label: 'LAN2' },
  { key: 'lan3', label: 'LAN3' },
  { key: 'lan4', label: 'LAN4' },
]
const WAN_SSID_PORTS = [1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({ key: `ssid${index}`, label: `SSID${index}` }))
const WAN_PORT_ORDER = [...WAN_LAN_PORTS, ...WAN_SSID_PORTS].map((port) => port.label)

function ssidSlotCount(ssidCount, selectedPorts = []) {
  const reported = Number(ssidCount)
  const base = Number.isInteger(reported) && reported >= 1 ? Math.min(8, reported) : 4
  const extra = (Array.isArray(selectedPorts) ? selectedPorts : []).reduce((max, label) => {
    const match = String(label || '').match(/^SSID(\d+)$/i)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return Math.min(8, Math.max(base, extra))
}

function ssidPortsFor(ssidCount, selectedPorts = []) {
  return WAN_SSID_PORTS.slice(0, ssidSlotCount(ssidCount, selectedPorts))
}

export function orderedPorts(labels) {
  const selected = new Set((Array.isArray(labels) ? labels : []).map((label) => String(label).toUpperCase()))
  return WAN_PORT_ORDER.filter((label) => selected.has(label))
}

export function isIpRoutedType(connectionType) {
  return connectionType === 'IP_Routed'
}

export function emptyWanForm() {
  return {
    deviceType: '',
    connectionName: '',
    enableConnection: true,
    natStatus: true,
    serviceList: 'INTERNET',
    connectionType: 'IP_Routed',
    vlanStatus: false,
    vlanId: '',
    priority: '0',
    mtu: '1492',
    username: '',
    password: '',
    addressing: 'DHCP',
    ipAddress: '',
    subnetMask: '',
    gateway: '',
    dnsServer: '',
    selectedPorts: [],
  }
}

function wanText(value) {
  return !value || value === '-' ? '' : String(value)
}

export function emptyWanPppForm() {
  return {
    ...emptyWanForm(),
    connectionType: 'ip-routed',
    priority: '0',
    mtu: '1492',
  }
}

export function emptyWanIpForm() {
  return {
    ...emptyWanForm(),
    connectionType: 'IP_Routed',
    natStatus: true,
    addressing: 'DHCP',
    username: '',
    password: '',
    selectedPorts: [],
  }
}

export function wanFormFrom(wan) {
  const ppp = wan.type === 'PPP' || wan.transport === 'PPPoE'
  return {
    ...emptyWanForm(),
    connectionName: wanText(wan.name),
    enableConnection: wan.status !== 'Disabled',
    natStatus: wan.nat === 'Enabled',
    serviceList: wanText(wan.service) || 'INTERNET',
    connectionType: ppp ? uiPppConnectionType(wan.connType) : (wanText(wan.connType) || 'IP_Routed'),
    vlanStatus: wan.vlanId !== '-',
    vlanId: wan.vlanId !== '-' ? String(wan.vlanId) : '',
    priority: wanText(wan.priority) || '0',
    mtu: wanText(wan.mtu) || (ppp ? '1492' : '1500'),
    username: wanText(wan.username),
    password: '',
    addressing: wan.ip !== '-' ? 'Static' : 'DHCP',
    ipAddress: wanText(wan.ip),
    gateway: wanText(wan.remoteIp),
    dnsServer: wanText(wan.dns),
    selectedPorts: orderedPorts(wan.boundPorts),
  }
}

function optionsWithCurrent(options, value) {
  if (!value || options.includes(value)) {
    return options
  }
  return [value, ...options]
}

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

function WanCheckControl({ label, checked, onChange, accentClass, className = '', disabled = false }) {
  return (
    <label className={`flex h-10 items-center gap-2.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium whitespace-nowrap text-gray-800 select-none dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${className}`}>
      <input
        type="checkbox"
        className={`h-4 w-4 shrink-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${accentClass}`}
        checked={checked}
        disabled={disabled}
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

// Form tambah/ubah koneksi WAN. Varian PPP mengirim seluruh isian ke ONU.
function WanBindMark({ label, bound }) {
  return (
    <span className={`inline-flex min-w-[4.5rem] items-center gap-1.5 text-xs font-semibold ${bound ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
      <span aria-hidden="true" className="w-3 text-center">{bound ? '✔' : '✖'}</span>
      <span>{label}</span>
      <span className="sr-only">{bound ? 'terikat' : 'tidak terikat'}</span>
    </span>
  )
}

function WanBindingStatus({ boundPorts, ssidCount }) {
  const bound = new Set(orderedPorts(boundPorts))
  const wifi = ssidPortsFor(ssidCount, boundPorts)
  const wifi24 = wifi.filter((port) => Number(port.label.slice(4)) <= 4)
  const wifi5 = wifi.filter((port) => Number(port.label.slice(4)) > 4)
  return (
    <div className="grid gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
      <div>
        <p className="m-0 mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">LAN BIND</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {WAN_LAN_PORTS.map((port) => (
            <WanBindMark key={port.label} label={port.label} bound={bound.has(port.label)} />
          ))}
        </div>
      </div>
      <div>
        <p className="m-0 mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">WIFI BIND</p>
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {wifi24.map((port) => (
              <WanBindMark key={port.label} label={port.label} bound={bound.has(port.label)} />
            ))}
          </div>
          {wifi5.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {wifi5.map((port) => (
                <WanBindMark key={port.label} label={port.label} bound={bound.has(port.label)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WanPortCheckbox({ label, checked, onChange, tone, disabled = false }) {
  const active = tone === 'ppp'
    ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:border-cyan-400 dark:bg-cyan-950/50 dark:text-cyan-100'
    : 'border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-100'
  return (
    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${checked ? active : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200 dark:hover:border-slate-500'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
      <input
        type="checkbox"
        className={`h-4 w-4 shrink-0 cursor-pointer ${tone === 'ppp' ? 'accent-cyan-600' : 'accent-blue-600'}`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

function WanPortPicker({ selectedPorts, ssidCount, onToggle, tone, disabled = false }) {
  const selected = new Set(orderedPorts(selectedPorts))
  const wifi = ssidPortsFor(ssidCount, selectedPorts)
  const wifi24 = wifi.filter((port) => Number(port.label.slice(4)) <= 4)
  const wifi5 = wifi.filter((port) => Number(port.label.slice(4)) > 4)
  const grid = (ports) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ports.map((port) => (
        <WanPortCheckbox
          key={port.label}
          label={port.label}
          checked={selected.has(port.label)}
          tone={tone}
          disabled={disabled}
          onChange={(checked) => onToggle(port.label, checked)}
        />
      ))}
    </div>
  )
  return (
    <div className="grid gap-4">
      <div>
        <p className="m-0 mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">LAN BIND</p>
        {grid(WAN_LAN_PORTS)}
      </div>
      <div>
        <p className="m-0 mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">WIFI BIND</p>
        <div className="grid gap-3">
          <div>
            {wifi5.length > 0 && <p className="m-0 mb-2 text-[11px] font-semibold text-gray-400 dark:text-gray-500">2.4 GHz</p>}
            {grid(wifi24)}
          </div>
          {wifi5.length > 0 && (
            <div>
              <p className="m-0 mb-2 text-[11px] font-semibold text-gray-400 dark:text-gray-500">5 GHz</p>
              {grid(wifi5)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WanSavingOverlay() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-labelledby="wan-saving-title" aria-describedby="wan-saving-text" aria-busy="true">
      <div className="flex max-w-sm transform flex-col items-center gap-5 rounded-2xl bg-white px-8 py-8 text-center shadow-2xl transition-all dark:bg-gray-800">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-500" />
        <h3 id="wan-saving-title" className="text-lg font-bold text-gray-800 dark:text-gray-100">Menyimpan Konfigurasi...</h3>
        <p id="wan-saving-text" className="text-sm text-gray-500 dark:text-gray-400">
          Memproses perintah TR-069 ke perangkat. Mohon jangan tutup halaman atau menekan tombol apa pun.
        </p>
      </div>
    </div>
  )
}

export function WanConfigModal({
  variant, editing = false, manufacturer = '', saving = false, form, ssidCount = 4, onChange, onPatch, onPortChange, onClose, onSave, onAfterSuccess,
}) {
  const isPpp = variant === 'ppp'
  const ipRouted = !isPpp && isIpRoutedType(form.connectionType)
  const staticIp = ipRouted && form.addressing === 'Static'
  const accentClass = isPpp ? 'accent-cyan-600' : 'accent-blue-600'
  const iconClass = isPpp
    ? 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/50 dark:text-cyan-300'
    : 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300'
  const saveClass = isPpp ? 'bg-cyan-500 hover:bg-cyan-600' : 'bg-blue-500 hover:bg-blue-600'
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const formAlive = useRef(true)
  const submitLock = useRef(false)
  const deviceType = resolveDeviceType(form.deviceType, manufacturer)
  const connectionOptions = isPpp ? pppConnectionOptions(manufacturer, deviceType) : WAN_IP_CONNECTION_OPTIONS
  // Fiberhome: nama opsional saat membuat WAN (kosong = ONT menamai sendiri, mis. 3_INTERNET_R_VID_2033).
  // Saat edit nama tidak diubah, jadi dikunci.
  const nameOptional = deviceType === 'Fiberhome'
  const autoName = nameOptional && editing
  const busy = isLoading || saving

  useEffect(() => {
    formAlive.current = true
    return () => {
      formAlive.current = false
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !busy) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, busy])

  function confirmSave() {
    if (isPpp) {
      return Swal.fire({
        title: editing ? 'Simpan perubahan WAN PPP?' : 'Buat koneksi WAN PPP?',
        text: 'Seluruh isian dikirim ke ONU sebagai parameter TR-069.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Ya, Simpan',
        cancelButtonText: 'Batal',
      })
    }
    const routed = isIpRoutedType(form.connectionType)
    return Swal.fire({
      title: editing ? 'Simpan perubahan WAN IP?' : 'Buat koneksi WAN IP?',
      text: routed
        ? 'Koneksi IP routed dikirim ke ONU beserta VLAN dan port binding.'
        : 'Koneksi IP bridge dikirim tanpa alamat IP, username, atau password.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Simpan',
      cancelButtonText: 'Batal',
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitLock.current || isLoading || saving || !onSave) {
      return
    }
    const confirm = await confirmSave()
    if (!confirm.isConfirmed) {
      return
    }
    submitLock.current = true
    setIsLoading(true)
    let outcome = null
    try {
      outcome = await onSave()
    } catch (error) {
      outcome = { ok: false, message: errorMessage(error, 'Gagal mengirim konfigurasi WAN.') }
    } finally {
      submitLock.current = false
      if (formAlive.current) {
        setIsLoading(false)
      }
    }
    if (!formAlive.current || !outcome || outcome.cancelled) {
      return
    }
    if (outcome.ok) {
      onClose()
      void fireSuccess({
        icon: outcome.partial ? 'warning' : 'success',
        title: outcome.partial ? 'Sebagian tersimpan' : 'Berhasil',
        text: outcome.message,
      }, onAfterSuccess)
      return
    }
    fireError({ title: 'Gagal', text: outcome.message || 'Gagal mengirim konfigurasi WAN.' })
  }

  const ipField = (field, label) => (
    <WanTextControl
      label={label}
      type="text"
      inputMode="decimal"
      placeholder="0.0.0.0"
      pattern={IPV4_FORM_PATTERN}
      title={IPV4_FORM_HINT}
      autoComplete="off"
      required
      disabled={busy}
      value={form[field]}
      onChange={(event) => onChange(field, event.target.value.trim())}
    />
  )

  const dialog = createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose()
        }
      }}
    >
      <form
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl dark:bg-slate-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wan-config-title"
        aria-busy={busy}
        autoComplete="off"
        onSubmit={handleSubmit}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-800">
          <div>
            <h2 id="wan-config-title" className="m-0 text-base font-bold text-gray-900 dark:text-gray-100">
              {isPpp ? 'Konfigurasi WAN PPP Connection' : 'Konfigurasi WAN IP'}
            </h2>
            <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {editing
                ? (isPpp
                  ? 'Ubah koneksi yang sudah ada. Sandi dikosongkan; isi ulang hanya bila ingin diganti.'
                  : 'Ubah koneksi IP yang sudah ada. Mode bridge tidak mengirim alamat IP.')
                : isPpp
                  ? 'Atur autentikasi PPPoE, VLAN, 802.1p, MTU, dan port binding koneksi baru.'
                  : 'Atur koneksi IP routed atau bridge, VLAN, dan port LAN/SSID yang diikat.'}
            </p>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
            aria-label="Tutup"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <WanSelectControl
              label="Tipe Perangkat"
              value={deviceType}
              options={WAN_DEVICE_TYPES}
              onChange={(value) => {
                if (!isPpp) {
                  onChange('deviceType', value)
                  return
                }
                const nextOptions = pppConnectionOptions(manufacturer, value)
                const patch = { deviceType: value }
                if (!nextOptions.includes(form.connectionType)) {
                  patch.connectionType = 'ip-routed'
                  patch.natStatus = true
                }
                onPatch(patch)
              }}
              disabled={busy}
            />
            <WanTextControl
              label="Connection Name"
              type="text"
              name="connectionName"
              placeholder={nameOptional ? 'Kosongkan = otomatis oleh ONT' : 'Nama koneksi'}
              maxLength={128}
              required={!nameOptional}
              autoFocus={!autoName}
              disabled={autoName || busy}
              title={autoName ? 'Nama koneksi Fiberhome tidak diubah saat edit' : undefined}
              value={autoName ? FIBERHOME_AUTO_NAME : form.connectionName}
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
              checked={isPpp ? form.natStatus && form.connectionType !== 'pppoe_bridged' : ipRouted}
              accentClass={accentClass}
              disabled={!isPpp || form.connectionType === 'pppoe_bridged' || busy}
              onChange={(checked) => onChange('natStatus', checked)}
            />
          </div>

          <div className={`grid grid-cols-1 items-end gap-4 sm:grid-cols-2 ${isPpp ? 'lg:grid-cols-3' : 'md:grid-cols-[minmax(0,1.15fr)_minmax(0,1.4fr)_auto_minmax(0,0.85fr)_minmax(0,1fr)]'}`}>
            <WanSelectControl
              label="Service List"
              value={form.serviceList}
              options={optionsWithCurrent(WAN_SERVICE_OPTIONS, form.serviceList)}
              onChange={(value) => onChange('serviceList', value)}
              disabled={busy}
            />
            <WanSelectControl
              label="Connection Type"
              value={form.connectionType}
              options={optionsWithCurrent(connectionOptions, form.connectionType)}
              onChange={(value) => {
                if (isPpp) {
                  const bridgedPpp = value === 'pppoe_bridged'
                  onPatch({
                    connectionType: value,
                    natStatus: !bridgedPpp,
                    ...(bridgedPpp ? { username: '', password: '' } : {}),
                  })
                  return
                }
                const routed = value === 'IP_Routed'
                onPatch({
                  connectionType: value,
                  natStatus: routed,
                  ...(routed ? {} : {
                    addressing: 'DHCP',
                    ipAddress: '',
                    subnetMask: '',
                    gateway: '',
                    dnsServer: '',
                  }),
                })
              }}
              disabled={busy}
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
            {!isPpp && ipRouted && (
              <WanSelectControl
                label="Addressing Type"
                value={form.addressing}
                options={WAN_ADDRESSING_OPTIONS}
                disabled={busy}
                onChange={(value) => onPatch({
                  addressing: value,
                  ...(value === 'Static' ? {} : {
                    ipAddress: '',
                    subnetMask: '',
                    gateway: '',
                    dnsServer: '',
                  }),
                })}
              />
            )}
            <WanTextControl
              label="802.1p"
              type="number"
              name="priority"
              inputMode="numeric"
              min={0}
              max={7}
              step={1}
              placeholder="0-7"
              disabled={!form.vlanStatus || busy}
              value={form.priority}
              onChange={(event) => onChange('priority', event.target.value)}
            />
            {isPpp && (
              <WanTextControl
                label="MTU"
                type="number"
                name="mtu"
                inputMode="numeric"
                min={576}
                max={1540}
                step={1}
                placeholder="1492"
                required
                disabled={busy}
                value={form.mtu}
                onChange={(event) => onChange('mtu', event.target.value)}
              />
            )}
          </div>

          {isPpp && pppShowsAuth(form.connectionType) && (
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
          )}
          {staticIp && (
            <WanSection icon={Network} title="IP Addressing Details" iconClass={iconClass}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {ipField('ipAddress', 'IP Address')}
                {ipField('subnetMask', 'Subnet Mask')}
                {ipField('gateway', 'Default Gateway')}
                {ipField('dnsServer', 'DNS')}
              </div>
            </WanSection>
          )}

          <WanSection icon={Cable} title="Port Binding" iconClass={iconClass}>
            <WanPortPicker
              selectedPorts={form.selectedPorts}
              ssidCount={ssidCount}
              tone={isPpp ? 'ppp' : 'ip'}
              disabled={busy}
              onToggle={onPortChange}
            />
          </WanSection>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-800">
          <button
            type="button"
            className="cursor-pointer rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-700"
            onClick={onClose}
            disabled={busy}
          >
            Batal
          </button>
          <button
            type="submit"
            className={`rounded-lg border-0 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${busy ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${saveClass}`}
            disabled={busy}
          >
            Simpan Konfigurasi
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )

  return (
    <>
      {dialog}
      {isLoading && createPortal(<WanSavingOverlay />, document.body)}
    </>
  )
}

export default WanConfigModal
