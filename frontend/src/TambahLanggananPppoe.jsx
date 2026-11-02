import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Search, Trash2 } from 'lucide-react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import Swal from 'sweetalert2'
import { fireError, fireSuccess } from './swals.js'
import api from './api/axios.js'
import useDebouncedValue from './useDebouncedValue.js'

const PPN_RATE = 0.11
const KOORDINAT_PATTERN = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

// Pusat peta bawaan: Dompu, NTB.
const DEFAULT_CENTER = [-8.5333, 118.4667]
const DEFAULT_ZOOM = 13

// Ikon bawaan Leaflet tidak ditemukan otomatis oleh bundler, jadi didaftarkan manual.
const markerPinIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const REFERENCE_SOURCES = [
  { key: 'pelanggan', url: '/pelanggan', label: 'pelanggan' },
  { key: 'profiles', url: '/langganan/profil', label: 'profile langganan' },
  { key: 'routers', url: '/routers', label: 'router' },
  { key: 'outlets', url: '/outlets', label: 'mitra reseller' },
  { key: 'wilayah', url: '/wilayah', label: 'wilayah' },
  { key: 'servers', url: '/routers/servers', label: 'server' },
]

const KATEGORI_OPTIONS = ['PPP', 'Hotspot', 'Static', 'DHCP']
const MAC_PATTERN = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/
const IP_PATTERN = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/
const SIKLUS_OPTIONS = [
  { value: 'BULAN', label: 'Bulanan' },
  { value: 'HARI', label: 'Harian' },
]
const JENIS_TAGIHAN_OPTIONS = [
  { value: 'PRABAYAR', label: 'Prabayar' },
  { value: 'PASCABAYAR', label: 'Pascabayar' },
]
const PPN_OPTIONS = [
  { value: 'tidak', label: 'Tidak' },
  { value: 'ya', label: 'Ya (11%)' },
]

const inputClass = 'box-border h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors duration-300 placeholder:text-gray-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:disabled:bg-gray-800 dark:disabled:text-gray-400'
const textareaClass = `${inputClass} h-auto min-h-24 resize-y py-2`

function todayKey() {
  const date = new Date()
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function emptyForm() {
  const today = todayKey()
  return {
    // Seksi 1 - Pelanggan
    id_pelanggan: '',
    nama_pelanggan: '',
    phone: '',
    no_layanan: Date.now().toString().slice(-8),
    // Seksi 2 - Wilayah dan kordinat
    wilayah: '',
    koordinat: '',
    alamat_pemasangan: '',
    // Seksi 3 - Internet dan hardware
    mitra: '',
    router: '',
    server: '',
    address_list: '',
    kategori_layanan: 'PPP',
    username_internet: '',
    password: '',
    mac_address: '',
    ip_address: '',
    // Seksi 4 - Billing
    tgl_pasang: today,
    profil_id: '',
    siklus: 'BULAN',
    jenis_tagihan: 'PRABAYAR',
    tgl_mulai_aktif: today,
    tgl_isolir: '',
    tgl_invoice_perdana: today,
    jatuh_tempo: '',
    harga_prorata: '',
    komisi_reseller: '',
    kode_unik: '',
    ppn: 'tidak',
    catatan: '',
    // Footer
    kirim_wa: false,
  }
}

// "lat, lng" -> [lat, lng]; null jika format atau rentang tidak valid.
function parseKoordinat(text) {
  const match = KOORDINAT_PATTERN.exec(text)
  if (!match) {
    return null
  }
  const lat = Number(match[1])
  const lng = Number(match[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null
}

function formatKoordinat(lat, lng) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

function formatRupiah(value) {
  return `Rp${(Number(value) || 0).toLocaleString('id-ID')}`
}

function itemTotal(item) {
  return item.ditagihkan ? (Number(item.qty) || 0) * (Number(item.harga) || 0) : 0
}

function Field({ label, htmlFor, required = false, hint, className = '', children }) {
  return (
    <div className={`grid min-w-0 content-start gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && <p className="m-0 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  )
}

function SectionCard({ number, title, children }) {
  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm transition-colors duration-300 dark:border-gray-700 dark:bg-gray-800">
      <header className="flex items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-bold text-white" aria-hidden="true">
          {number}
        </span>
        <h2 className="m-0 text-sm font-bold tracking-widest text-gray-800 uppercase dark:text-gray-100">{title}</h2>
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

// Input pencarian dengan daftar pilihan. Nilai hanya bisa diisi lewat pilihan,
// sehingga data yang tersimpan selalu berasal dari master.
function SearchCombo({ id, selectedLabel, options, onSelect, placeholder, loading = false, required = false }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }
    function closeOnOutside(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', closeOnOutside)
    return () => document.removeEventListener('mousedown', closeOnOutside)
  }, [open])

  const keyword = query.trim().toLowerCase()
  const filtered = options
    .filter((option) => !keyword || `${option.label} ${option.hint || ''}`.toLowerCase().includes(keyword))
    .slice(0, 50)

  function choose(option) {
    onSelect(option)
    setOpen(false)
    setQuery('')
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (filtered[active]) {
        choose(filtered[active])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        className={`${inputClass} pr-10`}
        placeholder={placeholder}
        required={required}
        value={open ? query : selectedLabel}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setActive(0)
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      <Search size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-400" aria-hidden="true" />

      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full list-none overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          {loading && <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Memuat data...</li>}
          {!loading && filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Data tidak ditemukan.</li>
          )}
          {filtered.map((option, index) => (
            <li
              key={option.key}
              role="option"
              aria-selected={index === active}
              className={`cursor-pointer rounded-md px-3 py-2 text-sm ${index === active ? 'bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100' : 'text-gray-800 dark:text-gray-100'}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                choose(option)
              }}
            >
              <span className="block font-medium">{option.label}</span>
              {option.hint && <span className="block text-xs text-gray-500 dark:text-gray-400">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Menggeser peta ke marker hanya jika marker berada di luar area yang sedang terlihat
// (mis. koordinat diketik manual), supaya peta tidak melompat setiap kali pin digeser.
function MapFollow({ position }) {
  const map = useMap()
  useEffect(() => {
    if (!map.getBounds().contains(position)) {
      map.setView(position, map.getZoom())
    }
  }, [map, position])
  return null
}

function KoordinatMap({ position, onMove }) {
  const followPosition = useDebouncedValue(position)

  return (
    <div className="relative z-0 h-64 overflow-hidden rounded-lg border border-gray-300 md:h-80 dark:border-gray-600">
      <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          position={position}
          icon={markerPinIcon}
          draggable
          eventHandlers={{
            dragend(event) {
              const { lat, lng } = event.target.getLatLng().wrap()
              onMove(lat, lng)
            },
          }}
        />
        <MapFollow position={followPosition} />
      </MapContainer>
    </div>
  )
}

function ToggleSwitch({ id, checked, onChange, label }) {
  return (
    <div className="flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-600/40 focus-visible:outline-none ${checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
        onClick={() => onChange(!checked)}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
      </button>
      <label htmlFor={id} className="cursor-pointer text-sm font-semibold text-gray-700 select-none dark:text-gray-300">
        {label}
        <span className={`ml-2 text-xs font-bold ${checked ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>
          {checked ? 'ON' : 'OFF'}
        </span>
      </label>
    </div>
  )
}

function TambahLanggananPppoe() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = location.state?.returnTo
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState([])
  const [reference, setReference] = useState({ pelanggan: [], profiles: [], routers: [], outlets: [], wilayah: [], servers: [] })
  const [referenceLoading, setReferenceLoading] = useState(true)
  const [referenceError, setReferenceError] = useState('')
  const [saving, setSaving] = useState(false)
  const [markerPos, setMarkerPos] = useState(DEFAULT_CENTER)
  const nextItemId = useRef(1)

  useEffect(() => {
    let ignore = false

    async function load() {
      const results = await Promise.allSettled(REFERENCE_SOURCES.map((source) => api.get(source.url)))
      if (ignore) {
        return
      }
      const next = {}
      const failed = []
      results.forEach((result, index) => {
        const source = REFERENCE_SOURCES[index]
        if (result.status === 'fulfilled' && Array.isArray(result.value.data)) {
          next[source.key] = result.value.data
        } else {
          next[source.key] = []
          failed.push(source.label)
        }
      })
      setReference(next)
      setReferenceError(failed.length > 0 ? `Gagal memuat data: ${failed.join(', ')}.` : '')
      setReferenceLoading(false)
    }

    load()
    return () => {
      ignore = true
    }
  }, [])

  const pelangganOptions = useMemo(() => reference.pelanggan.map((row) => ({
    key: row.id,
    label: row.nama_pelanggan,
    hint: `ID ${row.user_id}${row.phone ? ` · ${row.phone}` : ''}`,
    data: row,
  })), [reference.pelanggan])

  const mitraOptions = useMemo(() => reference.outlets.map((row) => ({
    key: row.id,
    label: row.nama_outlet,
    hint: row.pemilik || '',
  })), [reference.outlets])

  // Server berasal dari menu Router: ALL SERVER, lalu server milik router terpilih
  // (ALL ROUTER menampilkan server dari semua router).
  // Kategori Hotspot memakai server Hotspot, kategori lain memakai server PPPoE.
  const serverJenis = form.kategori_layanan === 'Hotspot' ? 'hotspot' : 'pppoe'
  const serverOptions = useMemo(() => [
    'ALL SERVER',
    ...new Set(
      reference.servers
        .filter((row) => row.jenis === serverJenis && (form.router === 'ALL ROUTER' || row.nama_router === form.router))
        .map((row) => row.nama),
    ),
  ], [reference.servers, serverJenis, form.router])

  const subTotal = items.reduce((sum, item) => sum + itemTotal(item), 0)
  const ppnNominal = form.ppn === 'ya' ? Math.round(subTotal * PPN_RATE) : 0
  const grandTotal = subTotal + ppnNominal

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function bind(key) {
    return {
      value: form[key],
      onChange: (event) => update(key, event.target.value),
    }
  }

  async function fetchWilayah() {
    const response = await api.get('/wilayah')
    const rows = Array.isArray(response.data) ? response.data : []
    setReference((current) => ({ ...current, wilayah: rows }))
    return rows
  }

  async function handleAddWilayah() {
    const { value, isConfirmed } = await Swal.fire({
      title: 'Tambah Wilayah Baru',
      input: 'text',
      inputPlaceholder: 'Masukkan nama wilayah...',
      inputAttributes: { maxlength: 100 },
      showCancelButton: true,
      confirmButtonText: 'Simpan',
      cancelButtonText: 'Batal',
    })
    if (!isConfirmed) {
      return
    }
    const nama = typeof value === 'string' ? value.trim() : ''
    if (!nama) {
      await Swal.fire('Nama kosong', 'Masukkan nama wilayah.', 'warning')
      return
    }
    try {
      const { data } = await api.post('/wilayah', { nama_wilayah: nama })
      update('wilayah', data.nama_wilayah || nama)
      await fireSuccess({
        title: 'Berhasil',
        text: `Wilayah "${data.nama_wilayah || nama}" ditambahkan dan dipilih.`,
      }, () => { void fetchWilayah() })
    } catch (requestError) {
      fireError({ title: 'Gagal', text: requestError.response?.data?.message || 'Wilayah gagal disimpan.' })
    }
  }

  function handleKoordinatChange(text) {
    update('koordinat', text)
    const point = parseKoordinat(text)
    if (point) {
      setMarkerPos(point)
    }
  }

  function handleMarkerMove(lat, lng) {
    const point = [Number(lat.toFixed(6)), Number(lng.toFixed(6))]
    setMarkerPos(point)
    update('koordinat', formatKoordinat(point[0], point[1]))
  }

  function selectPelanggan(option) {
    const row = option.data
    setForm((current) => ({
      ...current,
      id_pelanggan: row.user_id,
      nama_pelanggan: row.nama_pelanggan,
      phone: row.phone || '',
      alamat_pemasangan: current.alamat_pemasangan || row.alamat || '',
    }))
  }

  function selectProfile(profileId) {
    const profile = reference.profiles.find((row) => String(row.id) === profileId)
    setForm((current) => ({
      ...current,
      profil_id: profileId,
      komisi_reseller: profile ? String(profile.komisi || 0) : '',
    }))
    // Baris pertama item invoice mengikuti profile yang dipilih (selama belum diubah manual).
    setItems((current) => {
      const others = current.filter((item) => !item.auto)
      if (!profile) {
        return others
      }
      const existing = current.find((item) => item.auto)
      const autoItem = {
        id: existing ? existing.id : nextItemId.current++,
        deskripsi: `Langganan ${profile.nama_profile}`,
        qty: 1,
        ditagihkan: true,
        harga: String(profile.harga || 0),
        auto: true,
      }
      return [autoItem, ...others]
    })
  }

  function addItem() {
    setItems((current) => [
      ...current,
      { id: nextItemId.current++, deskripsi: '', qty: 1, ditagihkan: true, harga: '', auto: false },
    ])
  }

  function updateItem(id, patch) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch, auto: false } : item)))
  }

  function removeItem(id) {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  function buildPayload() {
    const authKategori = form.kategori_layanan === 'PPP' || form.kategori_layanan === 'Hotspot'
    const networkKategori = form.kategori_layanan === 'Static' || form.kategori_layanan === 'DHCP'
    return {
      nolayanan: form.no_layanan.trim(),
      pelanggan: form.nama_pelanggan,
      ktg: form.kategori_layanan,
      profil_id: form.profil_id || null,
      jns_tagihan: form.jenis_tagihan,
      siklus: form.siklus,
      tgl_aktif: form.tgl_mulai_aktif || null,
      tgl_isolir: form.tgl_isolir,
      username: authKategori ? form.username_internet.trim() : (form.no_layanan.trim() || form.id_pelanggan),
      password: authKategori ? form.password : '',
      ip_address: networkKategori ? form.ip_address.trim() : '',
      mac_address: networkKategori ? form.mac_address.trim() : '',
      router: form.router,
      server: form.server,
      addr_list: form.address_list.trim(),
      wilayah: form.wilayah,
      alamat_pasang: form.alamat_pemasangan.trim(),
      tgl_pasang: form.tgl_pasang || null,
      mitra: form.mitra,
      kode_unik: form.kode_unik.trim(),
      note: form.catatan.trim(),
      status: 'Aktif',
      id_pelanggan: form.id_pelanggan,
      phone: form.phone,
      koordinat: form.koordinat.trim(),
      tgl_invoice_perdana: form.tgl_invoice_perdana || null,
      jatuh_tempo: form.jatuh_tempo || null,
      harga_prorata: Number(form.harga_prorata) || 0,
      komisi_reseller: Number(form.komisi_reseller) || 0,
      ppn: form.ppn === 'ya',
      kirim_wa: form.kirim_wa,
      // Total dihitung ulang oleh server dari item di bawah ini.
      items: items.map(({ deskripsi, qty, ditagihkan, harga }) => ({
        deskripsi: deskripsi.trim(),
        qty: Number(qty) || 0,
        ditagihkan,
        harga: Number(harga) || 0,
      })),
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (!form.id_pelanggan) {
      Swal.fire('Pelanggan belum dipilih', 'Cari dan pilih pelanggan terlebih dahulu.', 'warning')
      document.getElementById('cari-pelanggan')?.focus()
      return
    }
    if (!parseKoordinat(form.koordinat)) {
      Swal.fire('Titik kordinat tidak valid', 'Gunakan format "latitude, longitude", contoh: -8.533300, 118.466700.', 'warning')
      document.getElementById('titik-kordinat')?.focus()
      return
    }
    if (items.some((item) => !item.deskripsi.trim())) {
      Swal.fire('Item invoice belum lengkap', 'Deskripsi setiap item invoice wajib diisi.', 'warning')
      return
    }
    if (form.kategori_layanan === 'PPP' || form.kategori_layanan === 'Hotspot') {
      if (!form.username_internet.trim() || !form.password) {
        Swal.fire('Kredensial belum lengkap', 'Username dan password wajib diisi untuk layanan PPP dan Hotspot.', 'warning')
        document.getElementById('username-internet')?.focus()
        return
      }
    }
    if ((form.kategori_layanan === 'Static' || form.kategori_layanan === 'DHCP') && form.mac_address.trim() && !MAC_PATTERN.test(form.mac_address.trim())) {
      Swal.fire('MAC Address tidak valid', 'Gunakan format AA:BB:CC:DD:EE:FF.', 'warning')
      document.getElementById('mac-address')?.focus()
      return
    }
    if (form.kategori_layanan === 'DHCP' && !form.mac_address.trim()) {
      Swal.fire('MAC Address wajib', 'Layanan DHCP membutuhkan MAC Address perangkat.', 'warning')
      document.getElementById('mac-address')?.focus()
      return
    }
    if ((form.kategori_layanan === 'Static' || form.kategori_layanan === 'DHCP') && form.ip_address.trim() && !IP_PATTERN.test(form.ip_address.trim())) {
      Swal.fire('IP Address tidak valid', 'Gunakan alamat IPv4, contoh: 10.0.0.10.', 'warning')
      document.getElementById('ip-address')?.focus()
      return
    }
    if (form.kategori_layanan === 'Static' && !form.ip_address.trim()) {
      Swal.fire('IP Address wajib', 'Layanan Static membutuhkan IP Address.', 'warning')
      document.getElementById('ip-address')?.focus()
      return
    }

    setSaving(true)
    try {
      await api.post('/langganan/data', buildPayload())
      await fireSuccess({ title: 'Berhasil', text: 'Data langganan berhasil disimpan.' }, () => {
        if (returnTo) {
          navigate(returnTo, { replace: true })
        } else {
          navigate('/langganan/data')
        }
      })
    } catch (requestError) {
      fireError({ title: 'Gagal', text: requestError.response?.data?.message || 'Data langganan gagal disimpan.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 mb-1.5 text-[13px] font-bold tracking-[0.12em] text-cyan-700 uppercase transition-colors duration-300 dark:text-cyan-300">
            Langganan
          </p>
          <h1 className="m-0 text-3xl font-bold tracking-tight text-gray-900 transition-colors duration-300 dark:text-gray-100">
            Tambah Langganan PPPoE
          </h1>
        </div>
        <Link
          to="/langganan/data"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 text-sm font-semibold text-gray-700 no-underline transition-colors duration-300 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <ArrowLeft size={16} />
          Kembali
        </Link>
      </header>

      {referenceError && (
        <p role="alert" className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {referenceError}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        {/* Seksi 1 */}
        <SectionCard number={1} title="Pelanggan">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Cari pelanggan" htmlFor="cari-pelanggan" className="md:col-span-3">
              <SearchCombo
                id="cari-pelanggan"
                selectedLabel={form.nama_pelanggan}
                options={pelangganOptions}
                onSelect={selectPelanggan}
                placeholder="Ketik nama, ID, atau nomor telepon pelanggan"
                loading={referenceLoading}
              />
            </Field>
            <Field label="Nama pelanggan" htmlFor="nama-pelanggan" required>
              <input id="nama-pelanggan" type="text" className={inputClass} value={form.nama_pelanggan} placeholder="-" disabled readOnly />
            </Field>
            <Field label="ID pelanggan" htmlFor="id-pelanggan">
              <input id="id-pelanggan" type="text" className={inputClass} value={form.id_pelanggan} placeholder="-" disabled readOnly />
            </Field>
            <Field label="Phone" htmlFor="phone">
              <input id="phone" type="text" className={inputClass} value={form.phone} placeholder="-" disabled readOnly />
            </Field>
            <Field label="No. layanan" htmlFor="no-layanan" className="md:col-span-1">
              <input
                id="no-layanan"
                type="text"
                inputMode="numeric"
                className={inputClass}
                value={form.no_layanan}
                onChange={(event) => update('no_layanan', event.target.value.replace(/\D/g, ''))}
              />
            </Field>
          </div>
        </SectionCard>

        {/* Seksi 2 */}
        <SectionCard number={2} title="Wilayah dan Kordinat">
          <div className="grid grid-cols-1 gap-4">
            <Field label="Pilih wilayah" htmlFor="wilayah" required>
              <div className="flex items-center gap-2">
                <select id="wilayah" className={`${inputClass} min-w-0 flex-1`} required {...bind('wilayah')}>
                  <option value="">Pilih wilayah</option>
                  {reference.wilayah.map((row) => <option key={row.id} value={row.nama_wilayah}>{row.nama_wilayah}</option>)}
                </select>
                <button
                  type="button"
                  className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition-colors duration-300 hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600/40 focus-visible:outline-none"
                  onClick={handleAddWilayah}
                >
                  <Plus size={16} strokeWidth={2.5} />
                  Tambah
                </button>
              </div>
            </Field>

            <KoordinatMap position={markerPos} onMove={handleMarkerMove} />

            <Field
              label="Titik Kordinat"
              htmlFor="titik-kordinat"
              required
              hint="Geser pin pada peta atau ketik manual dengan format: latitude, longitude"
            >
              <input
                id="titik-kordinat"
                type="text"
                className={inputClass}
                placeholder="-8.533300, 118.466700"
                required
                value={form.koordinat}
                onChange={(event) => handleKoordinatChange(event.target.value)}
              />
            </Field>
            <Field label="Alamat pemasangan" htmlFor="alamat-pemasangan" required>
              <textarea
                id="alamat-pemasangan"
                className={textareaClass}
                rows={3}
                placeholder="Alamat lengkap lokasi pemasangan"
                required
                {...bind('alamat_pemasangan')}
              />
            </Field>
          </div>
        </SectionCard>

        {/* Seksi 3 */}
        <SectionCard number={3} title="Internet dan Hardware">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Mitra reseller" htmlFor="mitra-reseller" required className="md:col-span-2">
              <SearchCombo
                id="mitra-reseller"
                selectedLabel={form.mitra}
                options={mitraOptions}
                onSelect={(option) => update('mitra', option.label)}
                placeholder="Cari mitra reseller"
                loading={referenceLoading}
                required
              />
            </Field>
            <Field label="Router" htmlFor="router" required>
              <select
                id="router"
                className={inputClass}
                required
                value={form.router}
                onChange={(event) => {
                  // Server milik router tertentu, jadi pilihan server dikosongkan saat router berganti.
                  setForm((current) => ({ ...current, router: event.target.value, server: '' }))
                }}
              >
                <option value="">Pilih router</option>
                <option value="ALL ROUTER">ALL ROUTER</option>
                {reference.routers.map((row) => <option key={row.id} value={row.nama_router}>{row.nama_router}</option>)}
              </select>
            </Field>
            <Field label="Server" htmlFor="server" required>
              <select id="server" className={inputClass} required {...bind('server')}>
                <option value="">Pilih server</option>
                {serverOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </Field>
            <Field label="Address list" htmlFor="address-list" className="md:col-span-2">
              <input id="address-list" type="text" className={inputClass} placeholder="Nama address list di router" {...bind('address_list')} />
            </Field>
            <Field label="Kategori layanan" htmlFor="kategori-layanan" required className="md:col-span-2">
              <select
                id="kategori-layanan"
                className={inputClass}
                required
                value={form.kategori_layanan}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  kategori_layanan: event.target.value,
                  server: '',
                }))}
              >
                <option value="">Pilih kategori layanan</option>
                {KATEGORI_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </Field>

            {(form.kategori_layanan === 'PPP' || form.kategori_layanan === 'Hotspot') && (
              <div key={form.kategori_layanan} className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2 animate-kategori-in">
                <Field
                  label={form.kategori_layanan === 'PPP' ? 'Username PPP / Internet' : 'Username Hotspot'}
                  htmlFor="username-internet"
                  required
                >
                  <input
                    id="username-internet"
                    type="text"
                    className={inputClass}
                    maxLength={100}
                    autoComplete="off"
                    required
                    placeholder={form.kategori_layanan === 'PPP' ? 'Username PPPoE' : 'Username hotspot'}
                    {...bind('username_internet')}
                  />
                </Field>
                <Field label="Password" htmlFor="password-layanan" required>
                  <input
                    id="password-layanan"
                    type="password"
                    className={inputClass}
                    maxLength={100}
                    autoComplete="new-password"
                    required
                    placeholder="Password"
                    {...bind('password')}
                  />
                </Field>
              </div>
            )}

            {(form.kategori_layanan === 'Static' || form.kategori_layanan === 'DHCP') && (
              <div key={form.kategori_layanan} className="grid grid-cols-1 gap-4 md:col-span-2 md:grid-cols-2 animate-kategori-in">
                <Field
                  label="MAC Address"
                  htmlFor="mac-address"
                  required={form.kategori_layanan === 'DHCP'}
                  hint={form.kategori_layanan === 'DHCP' ? 'Wajib untuk layanan DHCP.' : 'Opsional untuk layanan Static.'}
                >
                  <input
                    id="mac-address"
                    type="text"
                    className={inputClass}
                    maxLength={17}
                    autoComplete="off"
                    required={form.kategori_layanan === 'DHCP'}
                    placeholder="AA:BB:CC:DD:EE:FF"
                    {...bind('mac_address')}
                  />
                </Field>
                <Field
                  label="IP Address"
                  htmlFor="ip-address"
                  required={form.kategori_layanan === 'Static'}
                  hint={form.kategori_layanan === 'Static' ? 'Wajib untuk layanan Static.' : 'Opsional. Isi jika IP direservasi.'}
                >
                  <input
                    id="ip-address"
                    type="text"
                    className={inputClass}
                    maxLength={50}
                    autoComplete="off"
                    required={form.kategori_layanan === 'Static'}
                    placeholder="10.0.0.10"
                    {...bind('ip_address')}
                  />
                </Field>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Seksi 4 */}
        <SectionCard number={4} title="Billing">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Tanggal Pasang" htmlFor="tgl-pasang">
              <input id="tgl-pasang" type="date" className={inputClass} {...bind('tgl_pasang')} />
            </Field>
            <Field label="Profile langganan" htmlFor="profil-langganan" required>
              <select
                id="profil-langganan"
                className={inputClass}
                required
                value={form.profil_id}
                onChange={(event) => selectProfile(event.target.value)}
              >
                <option value="">Pilih profile langganan</option>
                {reference.profiles.map((row) => (
                  <option key={row.id} value={row.id}>{row.nama_profile} - {formatRupiah(row.harga)}</option>
                ))}
              </select>
            </Field>
            <Field label="Siklus tagihan" htmlFor="siklus-tagihan">
              <select id="siklus-tagihan" className={inputClass} {...bind('siklus')}>
                {SIKLUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Jenis tagihan" htmlFor="jenis-tagihan">
              <select id="jenis-tagihan" className={inputClass} {...bind('jenis_tagihan')}>
                {JENIS_TAGIHAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Tanggal mulai aktif" htmlFor="tgl-mulai-aktif">
              <input id="tgl-mulai-aktif" type="date" className={inputClass} {...bind('tgl_mulai_aktif')} />
            </Field>
            <Field label="Tanggal isolir" htmlFor="tgl-isolir">
              <input id="tgl-isolir" type="date" className={inputClass} {...bind('tgl_isolir')} />
            </Field>
            <Field label="Tgl terbit invoice perdana" htmlFor="tgl-invoice-perdana">
              <input id="tgl-invoice-perdana" type="date" className={inputClass} {...bind('tgl_invoice_perdana')} />
            </Field>
            <Field label="Jatuh tempo pembayaran" htmlFor="jatuh-tempo">
              <input id="jatuh-tempo" type="date" className={inputClass} {...bind('jatuh_tempo')} />
            </Field>
            <Field label="Harga prorata" htmlFor="harga-prorata">
              <input id="harga-prorata" type="number" min="0" step="1" inputMode="numeric" className={inputClass} placeholder="0" {...bind('harga_prorata')} />
            </Field>
            <Field label="Komisi reseller" htmlFor="komisi-reseller" hint="Terisi otomatis dari profile, bisa diubah.">
              <input id="komisi-reseller" type="number" min="0" step="1" inputMode="numeric" className={inputClass} placeholder="0" {...bind('komisi_reseller')} />
            </Field>
            <Field label="Kode unik" htmlFor="kode-unik" hint="Angka 10-999. Kosongkan agar dibuat otomatis.">
              <input
                id="kode-unik"
                type="text"
                inputMode="numeric"
                maxLength={3}
                className={inputClass}
                placeholder="Otomatis"
                value={form.kode_unik}
                onChange={(event) => update('kode_unik', event.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label="PPN 11%" htmlFor="ppn">
              <select id="ppn" className={inputClass} {...bind('ppn')}>
                {PPN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Catatan" htmlFor="catatan" className="md:col-span-2">
              <textarea id="catatan" className={textareaClass} rows={3} placeholder="Catatan tambahan (opsional)" {...bind('catatan')} />
            </Field>
          </div>
        </SectionCard>

        {/* Seksi 5 */}
        <SectionCard number={5} title="Item Invoice">
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-blue-600 px-3 text-xs font-bold text-white transition-colors duration-300 hover:bg-blue-700"
              onClick={addItem}
            >
              <Plus size={14} strokeWidth={2.5} />
              Tambah item
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full min-w-170 border-collapse text-sm">
              <thead>
                <tr className="bg-teal-600 text-xs tracking-wider text-white uppercase dark:bg-teal-700">
                  <th className="px-3 py-3 text-left font-bold">Deskripsi</th>
                  <th className="w-24 px-3 py-3 text-left font-bold">Qty</th>
                  <th className="w-32 px-3 py-3 text-left font-bold">Ditagihkan</th>
                  <th className="w-40 px-3 py-3 text-left font-bold">Harga</th>
                  <th className="w-40 px-3 py-3 text-right font-bold">Total</th>
                  <th className="w-12 px-3 py-3"><span className="sr-only">Aksi</span></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                      Belum ada item. Pilih profile langganan atau klik &quot;Tambah item&quot;.
                    </td>
                  </tr>
                ) : items.map((item, index) => (
                  <tr key={item.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        className={inputClass}
                        aria-label={`Deskripsi item ${index + 1}`}
                        placeholder="Deskripsi item"
                        value={item.deskripsi}
                        onChange={(event) => updateItem(item.id, { deskripsi: event.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className={inputClass}
                        aria-label={`Qty item ${index + 1}`}
                        value={item.qty}
                        onChange={(event) => updateItem(item.id, { qty: event.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={inputClass}
                        aria-label={`Ditagihkan item ${index + 1}`}
                        value={item.ditagihkan ? 'ya' : 'tidak'}
                        onChange={(event) => updateItem(item.id, { ditagihkan: event.target.value === 'ya' })}
                      >
                        <option value="ya">Ya</option>
                        <option value="tidak">Tidak</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className={inputClass}
                        aria-label={`Harga item ${index + 1}`}
                        placeholder="0"
                        value={item.harga}
                        onChange={(event) => updateItem(item.id, { harga: event.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold whitespace-nowrap text-gray-800 dark:text-gray-100">
                      {formatRupiah(itemTotal(item))}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-rose-600 transition-colors duration-300 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
                        aria-label={`Hapus item ${index + 1}`}
                        onClick={() => removeItem(item.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <dl className="mt-5 ml-auto grid w-full max-w-sm gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="font-semibold tracking-wide text-gray-600 uppercase dark:text-gray-400">Sub total</dt>
              <dd className="m-0 font-semibold text-gray-900 dark:text-gray-100">{formatRupiah(subTotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="font-semibold tracking-wide text-gray-600 uppercase dark:text-gray-400">PPN 11%</dt>
              <dd className="m-0 font-semibold text-gray-900 dark:text-gray-100">{formatRupiah(ppnNominal)}</dd>
            </div>
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-gray-200 pt-3 dark:border-gray-700">
              <dt className="font-bold tracking-wide text-gray-800 uppercase dark:text-gray-200">Total</dt>
              <dd className="m-0 text-2xl font-bold text-blue-700 dark:text-blue-400">{formatRupiah(grandTotal)}</dd>
            </div>
          </dl>
        </SectionCard>

        {/* Footer form */}
        <footer className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors duration-300 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-gray-800">
          <ToggleSwitch
            id="kirim-wa"
            checked={form.kirim_wa}
            onChange={(value) => update('kirim_wa', value)}
            label="Kirim WA Notifikasi"
          />
          <button
            type="submit"
            disabled={saving}
            className="h-12 cursor-pointer rounded-lg border-0 bg-blue-600 px-10 text-base font-bold text-white shadow-md shadow-blue-600/30 transition-colors duration-300 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Menyimpan...' : 'Simpan Data'}
          </button>
        </footer>
      </form>
    </section>
  )
}

export default TambahLanggananPppoe
