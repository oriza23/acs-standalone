import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import { fireError, fireSuccess } from './swals.js'
import {
  Ban,
  CalendarPlus,
  Download,
  ExternalLink,
  FileText,
  Hash,
  KeyRound,
  Menu,
  Pencil,
  Plus,
  Receipt,
  Search,
  Trash,
  UserRound,
  UserX,
  Users,
  X,
} from 'lucide-react'
import DataPelanggan from './DataPelanggan.jsx'
import './HotspotStok.css'
import './LanggananData.css'

const API = '/langganan/data'
const PROFIL_API = '/langganan/profil'

function formFromRow(item) {
  return {
    nolayanan: item.nolayanan || '',
    pelanggan: item.pelanggan || '',
    ktg: item.ktg || 'PPP',
    media_tipe: item.media_tipe || 'Fiber Optic',
    profil_id: item.profil_id ? String(item.profil_id) : '',
    jns_tagihan: item.jns_tagihan || 'PRABAYAR',
    siklus: item.siklus || 'BULAN',
    tgl_aktif: item.tgl_aktif || '',
    tgl_isolir: item.tgl_isolir ? item.tgl_isolir.replace(' ', 'T').slice(0, 16) : '',
    username: item.username || '',
    password: item.password || '',
    ip_address: item.ip_address || '',
    mac_address: item.mac_address || '',
    router: item.router || '',
    server: item.server || '',
    acs: item.acs || '',
    addr_list: item.addr_list || '',
    wilayah: item.wilayah || '',
    alamat_pasang: item.alamat_pasang || '',
    tgl_pasang: item.tgl_pasang || '',
    mitra: item.mitra || '',
    kode_unik: item.kode_unik || '',
    note: item.note || '',
    status: item.status || 'Aktif',
  }
}

function formatRupiah(value) {
  const number = Number(value) || 0
  return `Rp${number.toLocaleString('id-ID')}`
}

function formatTanggal(value) {
  if (!value) {
    return '-'
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (!match) {
    return String(value)
  }
  const [, year, month, day, hour, minute] = match
  return hour ? `${day}/${month}/${year} ${hour}:${minute}` : `${day}/${month}/${year}`
}

function isThisMonth(value) {
  if (!value) {
    return false
  }
  const match = String(value).match(/^(\d{4})-(\d{2})/)
  if (!match) {
    return false
  }
  const now = new Date()
  return Number(match[1]) === now.getFullYear() && Number(match[2]) === now.getMonth() + 1
}

function tampil(value) {
  const text = String(value || '').trim()
  return text || '-'
}

function rupiahOrDash(value) {
  return Number(value) > 0 ? formatRupiah(value) : '-'
}

function mapHref(koordinat) {
  const text = String(koordinat || '').trim()
  return /^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(text)
    ? `https://www.google.com/maps?q=${encodeURIComponent(text.replace(/\s+/g, ''))}`
    : ''
}

function ipHref(ip) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(String(ip || '')) ? `http://${ip}` : ''
}

function showInfo() {
  Swal.fire('Info', 'Fitur ini masuk dalam antrean pembuatan dan belum bisa digunakan.', 'info')
}

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback
}

function StatusBadge({ status }) {
  const label = String(status || 'Aktif').trim() || 'Aktif'
  if (label === 'Aktif') {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-700">
        {label}
      </span>
    )
  }
  if (label === 'Isolir') {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
        {label}
      </span>
    )
  }
  return (
    <span className="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
      {label}
    </span>
  )
}

function IsolirAksiButton({ item, busy, onToggleIsolir }) {
  if (item.ktg !== 'PPP') {
    return null
  }
  if (item.status === 'Isolir') {
    return (
      <button
        type="button"
        disabled={busy}
        aria-label={`Buka isolir ${item.pelanggan}`}
        onClick={() => onToggleIsolir(item)}
        className="rounded-full bg-green-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Buka Isolir
      </button>
    )
  }
  if (item.status === 'Aktif') {
    return (
      <button
        type="button"
        disabled={busy}
        aria-label={`Isolir ${item.pelanggan}`}
        onClick={() => onToggleIsolir(item)}
        className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Isolir
      </button>
    )
  }
  return null
}

const infoButtons = [
  { label: 'IMPORT', icon: Download, tone: 'tosca' },
  { label: 'SET BILLING', icon: Receipt, tone: 'rose' },
  { label: 'SECRET', icon: KeyRound, tone: 'tosca' },
  { label: 'LAPORAN', icon: FileText, tone: 'yellow' },
  { label: 'Pelanggan', icon: UserRound, tone: 'green' },
  { label: 'KODE UNIK', icon: Hash, tone: 'yellow' },
]

function LanggananData() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = location.state?.returnTo
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState([])
  const [routerServers, setRouterServers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [selectedIds, setSelectedIds] = useState([])
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(() => formFromRow({}))
  const [saving, setSaving] = useState(false)
  const [isPelangganOpen, setIsPelangganOpen] = useState(false)
  const [itemsRow, setItemsRow] = useState(null)
  const [itemsData, setItemsData] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemsError, setItemsError] = useState('')
  const [isolirBusyId, setIsolirBusyId] = useState(null)
  const itemsRequest = useRef(0)

  async function loadData() {
    const [customerResponse, profileResponse] = await Promise.all([
      api.get(API),
      api.get(PROFIL_API),
    ])
    setRows(Array.isArray(customerResponse.data) ? customerResponse.data : [])
    setProfiles(Array.isArray(profileResponse.data) ? profileResponse.data : [])
    setError('')
  }

  useEffect(() => {
    let ignore = false

    async function load() {
      try {
        const [customerResponse, profileResponse] = await Promise.all([
          api.get(API),
          api.get(PROFIL_API),
        ])
        if (!ignore) {
          setRows(Array.isArray(customerResponse.data) ? customerResponse.data : [])
          setProfiles(Array.isArray(profileResponse.data) ? profileResponse.data : [])
          setError('')
        }
      } catch {
        if (!ignore) {
          setRows([])
          setError('Gagal memuat data langganan.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [])

  // Pilihan server berasal dari menu Router; gagal memuat tidak mengganggu halaman.
  useEffect(() => {
    let ignore = false
    api.get('/routers/servers')
      .then((response) => {
        if (!ignore) {
          setRouterServers(Array.isArray(response.data) ? response.data : [])
        }
      })
      .catch(() => {})
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined
    }
    function closeMenu(event) {
      if (!event.target.closest('.data-menu')) {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [isMenuOpen])

  const keyword = searchTerm.toLowerCase()
  const filteredRows = rows.filter((item) => !keyword || [
    item.nolayanan,
    item.pelanggan,
    item.username,
    item.nama_profil,
    item.ip_address,
    item.wilayah,
    item.alamat_pasang,
    item.mitra,
    item.kode_unik,
    item.id_pelanggan,
    item.phone,
  ].some((value) => String(value || '').toLowerCase().includes(keyword)))

  const totalData = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(totalData / itemsPerPage))
  const page = Math.min(currentPage, totalPages)
  const lastIndex = page * itemsPerPage
  const firstIndex = lastIndex - itemsPerPage
  const currentItems = filteredRows.slice(firstIndex, lastIndex)
  const showingStart = totalData === 0 ? 0 : firstIndex + 1
  const showingEnd = Math.min(lastIndex, totalData)
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
  const visibleIds = currentItems.map((item) => item.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
  const selectedRows = rows.filter((item) => selectedIds.includes(item.id))
  // Server: ALL SERVER + server router terpilih untuk jenis layanan ini. Nilai lama
  // yang tidak ada di daftar tetap ditampilkan supaya data lama tidak hilang saat diedit.
  const serverJenis = form.ktg === 'Hotspot' ? 'hotspot' : 'pppoe'
  const serverChoices = [...new Set([
    'ALL SERVER',
    ...routerServers
      .filter((item) => item.jenis === serverJenis && (form.router === 'ALL ROUTER' || item.nama_router === form.router))
      .map((item) => item.nama),
    ...(form.server ? [form.server] : []),
  ])]
  const summaries = [
    { label: 'Total', hint: 'Seluruh pelanggan', value: rows.length, icon: Users, tone: 'total' },
    { label: 'PSB Bulan Ini', hint: 'Pasang bulan ini', value: rows.filter((item) => isThisMonth(item.tgl_pasang)).length, icon: CalendarPlus, tone: 'psb' },
    { label: 'Non Aktif', hint: 'Status non aktif', value: rows.filter((item) => item.status === 'Non Aktif').length, icon: UserX, tone: 'nonaktif' },
    { label: 'Terisolir', hint: 'Status isolir', value: rows.filter((item) => item.status === 'Isolir').length, icon: Ban, tone: 'isolir' },
  ]

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function toggleRow(id) {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ))
  }

  function toggleAll() {
    if (visibleIds.length === 0) {
      return
    }
    if (visibleIds.every((id) => selectedIds.includes(id))) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }
    setSelectedIds((current) => [...new Set([...current, ...visibleIds])])
  }

  // Pendaftaran langganan baru memakai halaman form lengkap, bukan modal.
  function openCreate() {
    setIsMenuOpen(false)
    navigate('/langganan/tambah', returnTo ? { state: { returnTo } } : undefined)
  }

  function openEdit(item) {
    setEditingId(item.id)
    setForm(formFromRow(item))
    setIsModalOpen(true)
    setIsMenuOpen(false)
  }

  function resetForm() {
    setEditingId(null)
    setForm(formFromRow({}))
  }

  async function openItems(row) {
    itemsRequest.current += 1
    const requestId = itemsRequest.current
    setItemsRow(row)
    setItemsData([])
    setItemsError('')
    setItemsLoading(true)
    try {
      const response = await api.get(`${API}/${encodeURIComponent(row.id)}/items`)
      if (itemsRequest.current === requestId) {
        setItemsData(Array.isArray(response.data) ? response.data : [])
      }
    } catch {
      if (itemsRequest.current === requestId) {
        setItemsError('Gagal memuat item invoice.')
      }
    } finally {
      if (itemsRequest.current === requestId) {
        setItemsLoading(false)
      }
    }
  }

  function closeItems() {
    itemsRequest.current += 1
    setItemsRow(null)
  }

  function closeModal() {
    if (saving) {
      return
    }
    setIsModalOpen(false)
    resetForm()
  }

  function payloadFromForm() {
    return {
      ...form,
      pelanggan: form.pelanggan.trim(),
      username: form.username.trim(),
      profil_id: form.profil_id || null,
      tgl_isolir: form.tgl_isolir ? form.tgl_isolir.replace('T', ' ') : '',
    }
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!editingId) {
      return
    }
    if (!form.pelanggan.trim() || !form.username.trim()) {
      Swal.fire('Data belum lengkap', 'Nama pelanggan dan username wajib diisi.', 'warning')
      return
    }
    setSaving(true)
    Swal.fire({
      title: 'Menyimpan...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    })
    try {
      const payload = payloadFromForm()
      await api.put(`${API}/${encodeURIComponent(editingId)}`, payload)
      setSelectedIds([])
      if (returnTo) {
        navigate(returnTo, { replace: true })
      } else {
        setIsModalOpen(false)
        resetForm()
      }
      await fireSuccess({ title: 'Berhasil', text: 'Data langganan berhasil diperbarui.' }, () => { void loadData() })
    } catch (requestError) {
      fireError({ title: 'Gagal', text: requestError.response?.data?.message || 'Data langganan gagal diperbarui.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (selectedRows.length === 0) {
      Swal.fire('Pilih pelanggan', 'Pilih minimal satu data langganan.', 'warning')
      return
    }
    const confirm = await Swal.fire({
      title: selectedRows.length === 1
        ? 'Yakin menghapus data langganan ini?'
        : `Yakin menghapus ${selectedRows.length} data langganan?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, hapus',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#e11d48',
    })
    if (!confirm.isConfirmed) {
      return
    }
    Swal.fire({
      title: 'Menghapus...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
    })
    try {
      await Promise.all(selectedRows.map((item) => api.delete(`${API}/${encodeURIComponent(item.id)}`)))
      setSelectedIds([])
      await fireSuccess({ title: 'Terhapus', text: 'Data langganan berhasil dihapus.' }, () => { void loadData() })
    } catch (requestError) {
      fireError({ title: 'Gagal', text: requestError.response?.data?.message || 'Data langganan gagal dihapus.' })
    }
  }

  async function handleToggleIsolir(item) {
    if (item.ktg !== 'PPP' || (item.status !== 'Aktif' && item.status !== 'Isolir')) {
      return
    }

    const sedangIsolir = item.status === 'Isolir'
    const confirm = await Swal.fire({
      title: 'Yakin ingin mengubah status pelanggan ini?',
      text: `${item.pelanggan} (${item.username})`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, lanjutkan',
      confirmButtonColor: sedangIsolir ? '#059669' : '#e11d48',
      cancelButtonText: 'Batal',
    })
    if (!confirm.isConfirmed) {
      return
    }

    setIsolirBusyId(item.id)
    try {
      const path = sedangIsolir
        ? `/buka-isolir/${encodeURIComponent(item.id)}`
        : `/isolir/${encodeURIComponent(item.id)}`
      const response = await api.post(path)
      await fireSuccess({
        title: 'Berhasil',
        text: response.data?.message || 'Status pelanggan diperbarui.',
      }, () => { void loadData() })
    } catch (requestError) {
      fireError({
        title: 'Gagal',
        text: errorMessage(requestError, 'Gagal mengubah status isolir pelanggan.'),
      })
    } finally {
      setIsolirBusyId(null)
    }
  }

  async function handleSetStatus(status) {
    setIsMenuOpen(false)
    if (selectedRows.length === 0) {
      Swal.fire('Pilih pelanggan', 'Pilih minimal satu data langganan.', 'warning')
      return
    }
    const confirm = await Swal.fire({
      title: `Ubah status menjadi ${status}?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, ubah',
      cancelButtonText: 'Batal',
    })
    if (!confirm.isConfirmed) {
      return
    }
    try {
      await Promise.all(selectedRows.map((item) => api.put(
        `${API}/${encodeURIComponent(item.id)}`,
        { ...formFromRow(item), status, profil_id: item.profil_id || null },
      )))
      setSelectedIds([])
      await fireSuccess({ title: 'Berhasil', text: `Status diubah menjadi ${status}.` }, () => { void loadData() })
    } catch (requestError) {
      fireError({ title: 'Gagal', text: requestError.response?.data?.message || 'Status gagal diubah.' })
    }
  }

  return (
    <section className="stok data-langganan">
      <div className="stok-stats">
        {summaries.map((item) => {
          const Icon = item.icon
          return (
            <article key={item.label} className={`stok-stat data-stat data-stat-${item.tone}`}>
              <div>
                <p>{item.label}</p>
                <strong>{item.value.toLocaleString('id-ID')}</strong>
                <span>{item.hint}</span>
              </div>
              <div className="stok-stat-icon" aria-hidden="true">
                <Icon size={20} strokeWidth={2.2} />
              </div>
            </article>
          )
        })}
      </div>

      <div className="data-toolbar">
        <div className="data-menu">
          <button
            type="button"
            className="stok-action stok-action-green"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <Menu size={16} strokeWidth={2.2} />
            <span>MENU</span>
          </button>
          {isMenuOpen && (
            <div className="stok-dropdown" role="menu">
              <button type="button" role="menuitem" onClick={() => handleSetStatus('Aktif')}>Set Aktif</button>
              <button type="button" role="menuitem" onClick={() => handleSetStatus('Non Aktif')}>Set Non Aktif</button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => handleSetStatus('Isolir')}>Set Isolir</button>
            </div>
          )}
        </div>
        <button type="button" className="stok-action stok-action-red" onClick={handleDelete}>
          <Trash size={16} strokeWidth={2.2} />
          <span>HAPUS</span>
        </button>
        {infoButtons.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              className={`stok-action data-action-${item.tone}`}
              onClick={item.label === 'Pelanggan' ? () => setIsPelangganOpen(true) : showInfo}
            >
              <Icon size={16} strokeWidth={2.2} />
              <span>{item.label}</span>
            </button>
          )
        })}
        <button type="button" className="stok-action stok-action-blue" onClick={openCreate}>
          <Plus size={16} strokeWidth={2.2} />
          <span>TAMBAH</span>
        </button>
        <select
          aria-label="Jumlah baris"
          value={itemsPerPage}
          onChange={(event) => {
            setItemsPerPage(Number(event.target.value))
            setCurrentPage(1)
          }}
        >
          <option value="10">10</option>
          <option value="20">20</option>
        </select>
        <label className="stok-search">
          <Search size={16} strokeWidth={2} />
          <input
            type="search"
            placeholder="Cari pelanggan..."
            aria-label="Cari pelanggan"
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value)
              setCurrentPage(1)
            }}
          />
        </label>
      </div>

      <div className="stok-panel">
        <div className="stok-panel-head">
          <div>
            <p>Langganan</p>
            <h1>Data Langganan</h1>
          </div>
          <span>{loading ? 'Memuat...' : `${totalData} pelanggan`}</span>
        </div>
        {loading && <p className="stok-status">Memuat data langganan...</p>}
        {error && <p className="stok-status stok-error">{error}</p>}
        {!loading && !error && (
          <div className="stok-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="stok-check">
                    <input type="checkbox" aria-label="Pilih semua pelanggan" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th>STATUS</th>
                  <th>NOLAYANAN</th>
                  <th>PELANGGAN</th>
                  <th>KTG</th>
                  <th>MEDIA/TIPE</th>
                  <th>PROFILE</th>
                  <th>JNS TAGIHAN</th>
                  <th>SIKLUS</th>
                  <th>TGL AKTIF</th>
                  <th>TGL ISOLIR</th>
                  <th>USERNAME</th>
                  <th>PASSWORD</th>
                  <th>IP ADDRESS</th>
                  <th>MAC ADDRESS</th>
                  <th>ROUTER</th>
                  <th>SERVER</th>
                  <th>ACS</th>
                  <th>ADDR LIST</th>
                  <th>WILAYAH</th>
                  <th>ALAMAT PASANG</th>
                  <th>TGL PASANG</th>
                  <th>MITRA</th>
                  <th>KODE UNIK</th>
                  <th>ID PELANGGAN</th>
                  <th>PHONE</th>
                  <th>KORDINAT</th>
                  <th>INV PERDANA</th>
                  <th>JATUH TEMPO</th>
                  <th>PRORATA</th>
                  <th>KOMISI</th>
                  <th>PPN</th>
                  <th>TOTAL</th>
                  <th>WA</th>
                  <th>INVOICE</th>
                  <th>AKSI</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr>
                    <td colSpan="36" className="stok-empty">
                      {searchTerm ? 'Pelanggan tidak ditemukan.' : 'Belum ada data langganan.'}
                    </td>
                  </tr>
                ) : currentItems.map((item) => (
                  <tr key={item.id} className={selectedIds.includes(item.id) ? 'is-selected' : undefined}>
                    <td className="stok-check">
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${item.pelanggan}`}
                        checked={selectedIds.includes(item.id)}
                        onChange={() => toggleRow(item.id)}
                      />
                    </td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>{tampil(item.nolayanan)}</td>
                    <td>{item.pelanggan}</td>
                    <td>{tampil(item.ktg)}</td>
                    <td>{tampil(item.media_tipe)}</td>
                    <td>
                      {item.nama_profil ? (
                        <span className="data-profil">
                          <span>{item.nama_profil}</span>
                          <span className="data-harga">{formatRupiah(item.harga_profil)}</span>
                        </span>
                      ) : '-'}
                    </td>
                    <td>{tampil(item.jns_tagihan)}</td>
                    <td>{tampil(item.siklus)}</td>
                    <td>{formatTanggal(item.tgl_aktif)}</td>
                    <td>{formatTanggal(item.tgl_isolir)}</td>
                    <td>{item.username}</td>
                    <td className="password-cell">
                      <span className="pwd-masked">••••••••</span>
                      <span className="pwd-revealed">{item.password || '-'}</span>
                    </td>
                    <td>
                      {ipHref(item.ip_address) ? (
                        <a className="data-ip" href={ipHref(item.ip_address)} target="_blank" rel="noreferrer">
                          {item.ip_address}
                          <ExternalLink size={14} />
                        </a>
                      ) : tampil(item.ip_address)}
                    </td>
                    <td>{tampil(item.mac_address)}</td>
                    <td>{tampil(item.router)}</td>
                    <td>{tampil(item.server)}</td>
                    <td>{tampil(item.acs)}</td>
                    <td>{tampil(item.addr_list)}</td>
                    <td>{tampil(item.wilayah)}</td>
                    <td>{tampil(item.alamat_pasang)}</td>
                    <td>{formatTanggal(item.tgl_pasang)}</td>
                    <td>{tampil(item.mitra)}</td>
                    <td>{tampil(item.kode_unik)}</td>
                    <td>{tampil(item.id_pelanggan)}</td>
                    <td>{tampil(item.phone)}</td>
                    <td>
                      {mapHref(item.koordinat) ? (
                        <a className="data-ip" href={mapHref(item.koordinat)} target="_blank" rel="noreferrer">
                          {item.koordinat}
                          <ExternalLink size={14} />
                        </a>
                      ) : tampil(item.koordinat)}
                    </td>
                    <td>{formatTanggal(item.tgl_invoice_perdana)}</td>
                    <td>{formatTanggal(item.jatuh_tempo)}</td>
                    <td>{rupiahOrDash(item.harga_prorata)}</td>
                    <td>{rupiahOrDash(item.komisi_reseller)}</td>
                    <td>{item.ppn ? 'Ya' : 'Tidak'}</td>
                    <td>{rupiahOrDash(item.total)}</td>
                    <td>{item.kirim_wa ? 'Ya' : 'Tidak'}</td>
                    <td>
                      <button
                        type="button"
                        className="data-note"
                        aria-label={`Lihat item invoice ${item.pelanggan}`}
                        title={`${item.jumlah_item} item invoice`}
                        onClick={() => openItems(item)}
                      >
                        <Receipt size={15} />
                      </button>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className="data-note"
                          aria-label={`Edit ${item.pelanggan}`}
                          title="Edit"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil size={15} />
                        </button>
                        <IsolirAksiButton
                          item={item}
                          busy={isolirBusyId === item.id}
                          onToggleIsolir={handleToggleIsolir}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && (
          <div className="stok-foot">
            <p className="stok-info">Showing {showingStart} to {showingEnd} of {totalData} entries</p>
            <nav className="stok-pages" aria-label="Navigasi halaman data langganan">
              <button type="button" className="stok-nav" disabled={page <= 1} onClick={() => setCurrentPage(page - 1)}>Previous</button>
              {pageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={pageNumber === page ? 'stok-page is-active' : 'stok-page'}
                  aria-current={pageNumber === page ? 'page' : undefined}
                  onClick={() => setCurrentPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
              <button type="button" className="stok-nav" disabled={page >= totalPages} onClick={() => setCurrentPage(page + 1)}>Next</button>
            </nav>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="data-backdrop" onMouseDown={closeModal}>
          <form className="data-modal" onSubmit={handleSave} onMouseDown={(event) => event.stopPropagation()}>
            <header className="data-modal-head">
              <div>
                <p>Langganan</p>
                <h2>Edit Data Langganan</h2>
              </div>
              <button type="button" className="data-close" onClick={closeModal} aria-label="Tutup">
                <X size={18} />
              </button>
            </header>
            <div className="data-form-grid">
              <label>No Layanan<input type="text" inputMode="numeric" pattern="[0-9]*" value={form.nolayanan} onChange={(event) => updateForm('nolayanan', event.target.value.replace(/\D/g, ''))} /></label>
              <label>Pelanggan<input value={form.pelanggan} onChange={(event) => updateForm('pelanggan', event.target.value)} required /></label>
              <label>KTG<input value={form.ktg} onChange={(event) => updateForm('ktg', event.target.value)} /></label>
              <label>
                Media/Tipe
                <select value={form.media_tipe} onChange={(event) => updateForm('media_tipe', event.target.value)}>
                  {['Fiber Optic', 'Wireless', 'LAN', 'Radio'].map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
              <label>
                Profile
                <select value={form.profil_id} onChange={(event) => updateForm('profil_id', event.target.value)}>
                  <option value="">- Pilih Profile -</option>
                  {profiles.map((item) => (
                    <option key={item.id} value={item.id}>{item.nama_profile}</option>
                  ))}
                </select>
              </label>
              <label>
                Jenis Tagihan
                <select value={form.jns_tagihan} onChange={(event) => updateForm('jns_tagihan', event.target.value)}>
                  <option>PRABAYAR</option>
                  <option>PASCABAYAR</option>
                </select>
              </label>
              <label>
                Siklus
                <select value={form.siklus} onChange={(event) => updateForm('siklus', event.target.value)}>
                  <option>BULAN</option>
                  <option>HARI</option>
                </select>
              </label>
              <label>
                Status
                <select value={form.status} onChange={(event) => updateForm('status', event.target.value)}>
                  <option>Aktif</option>
                  <option>Non Aktif</option>
                  <option>Isolir</option>
                </select>
              </label>
              <label>Tgl Aktif<input type="date" value={form.tgl_aktif} onChange={(event) => updateForm('tgl_aktif', event.target.value)} /></label>
              <label>Tgl Isolir<input type="datetime-local" value={form.tgl_isolir} onChange={(event) => updateForm('tgl_isolir', event.target.value)} /></label>
              <label>Username<input value={form.username} onChange={(event) => updateForm('username', event.target.value)} required /></label>
              <label>Password<input value={form.password} onChange={(event) => updateForm('password', event.target.value)} /></label>
              <label>IP Address<input value={form.ip_address} onChange={(event) => updateForm('ip_address', event.target.value)} placeholder="10.0.0.2" /></label>
              <label>MAC Address<input value={form.mac_address} onChange={(event) => updateForm('mac_address', event.target.value)} /></label>
              <label>Router<input value={form.router} onChange={(event) => updateForm('router', event.target.value)} /></label>
              <label>
                Server
                <select value={form.server} onChange={(event) => updateForm('server', event.target.value)}>
                  <option value="">-Pilih-</option>
                  {serverChoices.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>Addr List<input value={form.addr_list} onChange={(event) => updateForm('addr_list', event.target.value)} /></label>
              <label>Wilayah<input value={form.wilayah} onChange={(event) => updateForm('wilayah', event.target.value)} /></label>
              <label>Alamat Pasang<input value={form.alamat_pasang} onChange={(event) => updateForm('alamat_pasang', event.target.value)} /></label>
              <label>Tgl Pasang<input type="date" value={form.tgl_pasang} onChange={(event) => updateForm('tgl_pasang', event.target.value)} /></label>
              <label className="data-note-field">Note<textarea value={form.note} onChange={(event) => updateForm('note', event.target.value)} rows="2" /></label>
            </div>
            <div className="data-modal-actions">
              <button type="button" className="data-btn data-btn-gray" onClick={closeModal} disabled={saving}>Batal</button>
              <button type="submit" className="data-btn data-btn-blue" disabled={saving}>Simpan</button>
            </div>
          </form>
        </div>
      )}

      {itemsRow && (
        <div className="data-backdrop" onMouseDown={closeItems}>
          <div
            className="data-modal"
            style={{ width: 'min(760px, 100%)' }}
            role="dialog"
            aria-modal="true"
            aria-label="Item invoice"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="data-modal-head">
              <div>
                <p>Item Invoice</p>
                <h2>{itemsRow.pelanggan}</h2>
              </div>
              <button type="button" className="data-close" onClick={closeItems} aria-label="Tutup">
                <X size={18} />
              </button>
            </header>

            <div className="px-5 pt-2 pb-4">
              {itemsLoading && <p className="m-0 py-6 text-center text-sm text-gray-500 dark:text-gray-400">Memuat item invoice...</p>}
              {itemsError && <p className="m-0 py-6 text-center text-sm text-rose-600 dark:text-rose-400">{itemsError}</p>}
              {!itemsLoading && !itemsError && (
                <>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                    <table className="w-full min-w-120 border-collapse text-sm">
                      <thead>
                        <tr className="bg-teal-600 text-xs tracking-wider text-white uppercase dark:bg-teal-700">
                          <th className="px-3 py-2.5 text-left font-bold">Deskripsi</th>
                          <th className="px-3 py-2.5 text-right font-bold">Qty</th>
                          <th className="px-3 py-2.5 text-left font-bold">Ditagihkan</th>
                          <th className="px-3 py-2.5 text-right font-bold">Harga</th>
                          <th className="px-3 py-2.5 text-right font-bold">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsData.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                              Belum ada item invoice untuk langganan ini.
                            </td>
                          </tr>
                        ) : itemsData.map((entry) => (
                          <tr key={entry.id} className="border-t border-gray-100 text-gray-800 dark:border-gray-700 dark:text-gray-100">
                            <td className="px-3 py-2.5">{entry.deskripsi}</td>
                            <td className="px-3 py-2.5 text-right">{entry.qty.toLocaleString('id-ID')}</td>
                            <td className="px-3 py-2.5">{entry.ditagihkan ? 'Ya' : 'Tidak'}</td>
                            <td className="px-3 py-2.5 text-right whitespace-nowrap">{formatRupiah(entry.harga)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">{formatRupiah(entry.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <dl className="mt-4 ml-auto grid w-full max-w-xs gap-1.5 text-sm text-gray-800 dark:text-gray-100">
                    <div className="flex justify-between gap-4">
                      <dt className="font-semibold text-gray-600 uppercase dark:text-gray-400">Sub total</dt>
                      <dd className="m-0 font-semibold">{formatRupiah(itemsRow.sub_total)}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="font-semibold text-gray-600 uppercase dark:text-gray-400">PPN 11%</dt>
                      <dd className="m-0 font-semibold">{formatRupiah(itemsRow.ppn_nominal)}</dd>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-4 border-t border-gray-200 pt-2 dark:border-gray-700">
                      <dt className="font-bold text-gray-800 uppercase dark:text-gray-200">Total</dt>
                      <dd className="m-0 text-xl font-bold text-blue-700 dark:text-blue-400">{formatRupiah(itemsRow.total)}</dd>
                    </div>
                  </dl>
                </>
              )}
            </div>

            <div className="data-modal-actions">
              <button type="button" className="data-btn data-btn-gray" onClick={closeItems}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      <DataPelanggan open={isPelangganOpen} onClose={() => setIsPelangganOpen(false)} />
    </section>
  )
}

export default LanggananData
