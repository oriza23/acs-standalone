import { useEffect, useState } from 'react'
import api from './api/axios.js'
import ServerPagination from './ServerPagination.jsx'
import useDebouncedValue from './useDebouncedValue.js'
import Swal from 'sweetalert2'
import { fireError, fireSuccess } from './swals.js'
import { RefreshCw, Search, Trash, UserX } from 'lucide-react'
import './HotspotStok.css'
import './HotspotOnline.css'

const API = '/hotspot'

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  const megabyte = value / (1024 * 1024)
  if (megabyte >= 1024) {
    const gigabyte = megabyte / 1024
    const rounded = gigabyte >= 10 ? Math.round(gigabyte) : Math.round(gigabyte * 10) / 10
    return `${rounded} GB`
  }
  return `${Math.round(megabyte)} MB`
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const jam = String(Math.floor(total / 3600)).padStart(2, '0')
  const menit = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const detik = String(total % 60).padStart(2, '0')
  return `${jam}:${menit}:${detik}`
}

function formatTanggalWaktu(value) {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function tampil(value) {
  const text = String(value || '').trim()
  return text || '-'
}

async function fetchOnline(params) {
  const response = await api.get(`${API}/online`, { params })
  return response.data
}

function HotspotOnline() {
  const [rows, setRows] = useState([])
  const [totalData, setTotalData] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  // Baris terpilih disimpan lengkap (id -> baris) agar aksi Kick/Hapus Cookie
  // tetap benar walau admin berpindah halaman.
  const [selectedMap, setSelectedMap] = useState({})

  const debouncedSearch = useDebouncedValue(searchTerm.trim())

  function applyPayload(payload) {
    setRows(Array.isArray(payload?.data) ? payload.data : [])
    setTotalData(Number(payload?.total) || 0)
    setTotalPages(Math.max(1, Number(payload?.total_pages) || 1))
    setError('')
  }

  // Server-side pagination: backend hanya mengirim satu halaman (LIMIT/OFFSET).
  useEffect(() => {
    let ignore = false

    async function loadOnline() {
      setFetching(true)
      try {
        const payload = await fetchOnline({ page: currentPage, limit: itemsPerPage, q: debouncedSearch })
        if (ignore) {
          return
        }
        applyPayload(payload)
        if (payload?.page && payload.page !== currentPage) {
          setCurrentPage(payload.page)
        }
      } catch {
        if (!ignore) {
          setRows([])
          setError('Gagal memuat voucher online.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
          setFetching(false)
        }
      }
    }

    loadOnline()
    return () => {
      ignore = true
    }
  }, [currentPage, itemsPerPage, debouncedSearch])

  const currentItems = rows
  const page = currentPage
  const allSelected = currentItems.length > 0 && currentItems.every((item) => selectedMap[item.id])
  const selectedRows = Object.values(selectedMap)

  function toggleRow(item) {
    setSelectedMap((current) => {
      const next = { ...current }
      if (next[item.id]) {
        delete next[item.id]
      } else {
        next[item.id] = item
      }
      return next
    })
  }

  function toggleAll() {
    if (currentItems.length === 0) {
      return
    }
    setSelectedMap((current) => {
      const next = { ...current }
      if (currentItems.every((item) => next[item.id])) {
        currentItems.forEach((item) => delete next[item.id])
      } else {
        currentItems.forEach((item) => { next[item.id] = item })
      }
      return next
    })
  }

  async function refreshOnlinePage() {
    const payload = await fetchOnline({ page: currentPage, limit: itemsPerPage, q: searchTerm.trim() })
    applyPayload(payload)
    if (payload?.page) {
      setCurrentPage(payload.page)
    }
  }

  function payloadTerpilih() {
    const usernames = [...new Set(selectedRows.map((item) => item.username).filter(Boolean))]
    const routers = [...new Set(selectedRows.map((item) => item.router).filter(Boolean))]
    return {
      usernames,
      router: routers.length === 1 ? routers[0] : routers,
    }
  }

  async function handleKickUser() {
    if (selectedRows.length === 0) {
      Swal.fire('Pilih user', 'Pilih minimal satu user yang sedang online.', 'warning')
      return
    }
    const confirm = await Swal.fire({
      title: 'Yakin menendang user ini dari MikroTik?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, tendang',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#64748b',
    })
    if (!confirm.isConfirmed) {
      return
    }
    try {
      const response = await api.post(`${API}/kick-user`, payloadTerpilih())
      setSelectedMap({})
      await fireSuccess({
        title: 'Berhasil',
        text: response.data?.message || 'Permintaan kick user diterima',
      }, () => { void refreshOnlinePage() })
    } catch {
      fireError({ title: 'Gagal', text: 'Permintaan kick user gagal dikirim.' })
    }
  }

  async function handleHapusCookie() {
    if (selectedRows.length === 0) {
      Swal.fire('Pilih user', 'Pilih minimal satu user yang sedang online.', 'warning')
      return
    }
    const confirm = await Swal.fire({
      title: 'Yakin menghapus cookie user ini dari MikroTik?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, hapus',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#e11d48',
    })
    if (!confirm.isConfirmed) {
      return
    }
    try {
      const response = await api.post(`${API}/hapus-cookie`, payloadTerpilih())
      setSelectedMap({})
      await fireSuccess({
        title: 'Berhasil',
        text: response.data?.message || 'Permintaan hapus cookie diterima',
      }, () => { void refreshOnlinePage() })
    } catch {
      fireError({ title: 'Gagal', text: 'Permintaan hapus cookie gagal dikirim.' })
    }
  }

  async function handleSync() {
    setSyncing(true)
    Swal.fire({
      title: 'Menyinkronkan...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading()
      },
    })
    try {
      await api.post(`${API}/sync-online`)
      setSelectedMap({})
      await fireSuccess({ title: 'Selesai', text: 'Data online berhasil disegarkan.' }, () => { void refreshOnlinePage() })
    } catch {
      fireError({ title: 'Gagal', text: 'Data online gagal disegarkan.' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="stok online">
      <div className="stok-toolbar online-toolbar">
        <div className="online-toolbar-actions">
          <button type="button" className="stok-action stok-action-muted" onClick={handleKickUser}>
            <UserX size={16} strokeWidth={2.2} />
            <span>KICK USER</span>
          </button>
          <button type="button" className="stok-action stok-action-red" onClick={handleHapusCookie}>
            <Trash size={16} strokeWidth={2.2} />
            <span>HAPUS</span>
          </button>
          <button
            type="button"
            className="stok-action stok-action-green"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw className={syncing ? 'online-spin' : undefined} size={16} strokeWidth={2.2} />
            <span>SINKRONKAN</span>
          </button>
        </div>
        <div className="online-toolbar-tools">
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
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="500">500</option>
          </select>
          <label className="stok-search">
            <Search size={16} strokeWidth={2} />
            <input
              type="search"
              placeholder="Cari user online..."
              aria-label="Cari voucher online"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value)
                setCurrentPage(1)
              }}
            />
          </label>
        </div>
      </div>

      <div className="stok-panel">
        <div className="stok-panel-head">
          <div>
            <p>Hotspot</p>
            <h1>Voucher Online</h1>
          </div>
          <span>{loading ? 'Memuat...' : `${totalData.toLocaleString('id-ID')} online`}</span>
        </div>

        {loading && <p className="stok-status">Memuat data voucher online...</p>}
        {error && <p className="stok-status stok-error">{error}</p>}

        {!loading && !error && (
          <div className={fetching ? 'stok-table-wrap is-fetching' : 'stok-table-wrap'}>
            <table className="online-table">
              <thead>
                <tr>
                  <th className="stok-check">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua voucher online"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>USERNAME</th>
                  <th>PROFILE</th>
                  <th>UPTIME</th>
                  <th>UPLOAD</th>
                  <th>DOWNLOAD</th>
                  <th>ROUTER</th>
                  <th>INTERFACE</th>
                  <th>SERVER</th>
                  <th>IP ADDRESS</th>
                  <th>MAC ADDR</th>
                  <th>MITRA</th>
                  <th>OUTLET</th>
                  <th>LAST CONNECTED</th>
                  <th>LAST UPDATED</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr>
                    <td colSpan="15" className="stok-empty">
                      {searchTerm ? 'User tidak ditemukan.' : 'Belum ada voucher online.'}
                    </td>
                  </tr>
                ) : (
                  currentItems.map((item) => (
                    <tr
                      key={item.id}
                      className={selectedMap[item.id] ? 'is-selected' : undefined}
                    >
                      <td className="stok-check">
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${item.username}`}
                          checked={Boolean(selectedMap[item.id])}
                          onChange={() => toggleRow(item)}
                        />
                      </td>
                      <td>{item.username}</td>
                      <td>
                        <span className="online-profile">
                          <span className="online-dot is-online" aria-hidden="true" />
                          {tampil(item.profile)}
                        </span>
                      </td>
                      <td className="online-uptime">{formatUptime(item.uptime)}</td>
                      <td><span className="online-badge online-badge-upload">{formatBytes(item.upload)}</span></td>
                      <td><span className="online-badge online-badge-download">{formatBytes(item.download)}</span></td>
                      <td>{tampil(item.router)}</td>
                      <td>{tampil(item.interface)}</td>
                      <td>{tampil(item.server)}</td>
                      <td>{tampil(item.ip_address)}</td>
                      <td>{tampil(item.mac_addr)}</td>
                      <td>{tampil(item.mitra)}</td>
                      <td>{tampil(item.outlet)}</td>
                      <td>{formatTanggalWaktu(item.last_connected)}</td>
                      <td>{formatTanggalWaktu(item.last_updated)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && (
          <ServerPagination
            page={page}
            totalPages={totalPages}
            totalData={totalData}
            limit={itemsPerPage}
            onPageChange={setCurrentPage}
            label="Navigasi halaman voucher online"
            disabled={fetching}
          />
        )}
      </div>
    </section>
  )
}

export default HotspotOnline
