import { useEffect, useState } from 'react'
import api from './api/axios.js'
import ServerPagination from './ServerPagination.jsx'
import useDebouncedValue from './useDebouncedValue.js'
import Swal from 'sweetalert2'
import * as XLSX from 'xlsx'
import {
  AlertTriangle,
  Banknote,
  Calendar,
  Download,
  FileText,
  Menu,
  PieChart,
  Search,
  Ticket,
  Trash,
} from 'lucide-react'
import './HotspotStok.css'
import './HotspotTerjual.css'

function formatRupiah(value) {
  const number = Number(value) || 0
  return `Rp${number.toLocaleString('id-ID')}`
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

const toolbar = [
  { label: 'MENU', icon: Menu, tone: 'blue' },
  { label: 'EXPORT', icon: Download, tone: 'tosca' },
  { label: 'REKAP', icon: PieChart, tone: 'green' },
  { label: 'LAPORAN', icon: FileText, tone: 'orange' },
  { label: 'HAPUS', icon: Trash, tone: 'red' },
]

function HotspotTerjual() {
  const [rows, setRows] = useState([])
  const [totalData, setTotalData] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [soldSummary, setSoldSummary] = useState({
    jumlah: 0, total_penjualan: 0, penjualan_bulan_ini: 0, jumlah_expired: 0,
  })
  const [options, setOptions] = useState({ profile: [], router: [], mitra: [], outlet: [] })
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [filterProfile, setFilterProfile] = useState('all')
  const [filterRouter, setFilterRouter] = useState('all')
  const [filterMitra, setFilterMitra] = useState('')
  const [filterOutlet, setFilterOutlet] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [selectedRows, setSelectedRows] = useState([])

  const debouncedSearch = useDebouncedValue(searchTerm.trim())

  // Parameter filter dikirim ke backend; filtering/LIMIT/OFFSET dikerjakan di database.
  function buildParams(extra = {}) {
    const params = { q: debouncedSearch, ...extra }
    if (filterDate) params.tanggal = filterDate
    if (filterProfile !== 'all') params.profile = filterProfile
    if (filterRouter !== 'all') params.router = filterRouter
    if (filterMitra) params.mitra = filterMitra
    if (filterOutlet !== 'all') params.outlet = filterOutlet
    return params
  }

  useEffect(() => {
    let ignore = false

    async function loadOptions() {
      try {
        const response = await api.get('/api/hotspot/voucher-terjual/opsi')
        if (!ignore) {
          setOptions({
            profile: response.data?.profile || [],
            router: response.data?.router || [],
            mitra: response.data?.mitra || [],
            outlet: response.data?.outlet || [],
          })
        }
      } catch {
        // Dropdown tetap kosong; tabel tetap berfungsi.
      }
    }

    loadOptions()
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadSold() {
      setFetching(true)
      try {
        const response = await api.get('/api/hotspot/voucher-terjual', {
          params: buildParams({ page: currentPage, limit: itemsPerPage }),
        })
        if (ignore) {
          return
        }
        const payload = response.data
        setRows(Array.isArray(payload?.data) ? payload.data : [])
        setTotalData(Number(payload?.total) || 0)
        setTotalPages(Math.max(1, Number(payload?.total_pages) || 1))
        if (payload?.summary) {
          setSoldSummary(payload.summary)
        }
        if (payload?.page && payload.page !== currentPage) {
          setCurrentPage(payload.page)
        }
        setError('')
      } catch {
        if (!ignore) {
          setRows([])
          setError('Gagal memuat voucher terjual.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
          setFetching(false)
        }
      }
    }

    loadSold()
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, itemsPerPage, debouncedSearch, filterDate, filterProfile, filterRouter, filterMitra, filterOutlet])

  function showInfo() {
    Swal.fire('Info', 'Fitur ini masuk dalam antrean pembuatan dan belum bisa digunakan.', 'info')
  }

  const currentItems = rows
  const page = currentPage
  const visibleUsernames = currentItems.map((item) => item.username)
  const allSelected = visibleUsernames.length > 0
    && visibleUsernames.every((username) => selectedRows.includes(username))
  const namaBulan = new Date().toLocaleDateString('id-ID', { month: 'long' })

  const summaries = [
    { label: 'Jumlah', hint: 'Voucher terjual', value: totalData.toLocaleString('id-ID'), icon: Ticket, tone: 'blue' },
    { label: 'Total Penjualan', hint: 'Nilai jual', value: formatRupiah(soldSummary.total_penjualan), icon: Banknote, tone: 'teal' },
    { label: `Total ${namaBulan}`, hint: 'Penjualan bulan ini', value: formatRupiah(soldSummary.penjualan_bulan_ini), icon: Calendar, tone: 'amber' },
    { label: 'Jumlah Expired', hint: 'Kuota waktu habis', value: (Number(soldSummary.jumlah_expired) || 0).toLocaleString('id-ID'), icon: AlertTriangle, tone: 'expired' },
  ]

  async function handleExportExcel() {
    if (totalData === 0) {
      Swal.fire('Kosong', 'Tidak ada data untuk diexport', 'warning')
      return
    }

    // Export mengambil seluruh hasil filter dari backend (bukan hanya halaman aktif).
    Swal.fire({
      title: 'Menyiapkan export...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading()
      },
    })

    let filteredVouchers
    try {
      const response = await api.get('/api/hotspot/voucher-terjual', {
        params: buildParams({ all: 1 }),
      })
      filteredVouchers = Array.isArray(response.data?.data) ? response.data.data : []
    } catch {
      Swal.fire('Gagal', 'Data export gagal diambil.', 'error')
      return
    }
    Swal.close()

    if (filteredVouchers.length === 0) {
      Swal.fire('Kosong', 'Tidak ada data untuk diexport', 'warning')
      return
    }

    const dataUntukExcel = filteredVouchers.map((voucher) => ({
      Username: voucher.username,
      Profile: voucher.profile,
      'Harga Jual': voucher.harga,
      HPP: voucher.hpp,
      Komisi: voucher.komisi,
      Router: voucher.router,
      Outlet: voucher.outlet,
      'Durasi Terpakai': voucher.durasi,
      'Kuota Terpakai': voucher.kuota,
      'Tgl Aktif': voucher.tgl_aktif ? formatTanggalWaktu(voucher.tgl_aktif) : '-',
      'Tgl Expired': voucher.tgl_expired ? formatTanggalWaktu(voucher.tgl_expired) : 'UNLIMITED',
    }))
    const worksheet = XLSX.utils.json_to_sheet(dataUntukExcel)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Penjualan')
    XLSX.writeFile(workbook, 'Laporan_Voucher_Terjual.xlsx')
  }

  function toggleRow(username) {
    setSelectedRows((current) => (
      current.includes(username)
        ? current.filter((item) => item !== username)
        : [...current, username]
    ))
  }

  function toggleAll() {
    if (visibleUsernames.length === 0) {
      return
    }
    if (visibleUsernames.every((username) => selectedRows.includes(username))) {
      setSelectedRows((current) => current.filter((username) => !visibleUsernames.includes(username)))
      return
    }
    setSelectedRows((current) => [...new Set([...current, ...visibleUsernames])])
  }

  return (
    <section className="stok terjual">
      <div className="stok-stats">
        {summaries.map((item) => {
          const Icon = item.icon
          return (
            <article key={item.label} className={`stok-stat stok-stat-${item.tone}`}>
              <div>
                <p>{item.label}</p>
                <strong>{item.value}</strong>
                <span>{item.hint}</span>
              </div>
              <div className="stok-stat-icon" aria-hidden="true">
                <Icon size={20} strokeWidth={2.2} />
              </div>
            </article>
          )
        })}
      </div>

      <div className="stok-toolbar">
        {toolbar.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              className={`stok-action stok-action-${item.tone}`}
              onClick={item.label === 'EXPORT' ? handleExportExcel : showInfo}
            >
              <Icon size={16} strokeWidth={2.2} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="stok-filters">
        <label className="stok-filter stok-filter-date">
          <Calendar size={16} strokeWidth={2} />
          <input
            type="date"
            aria-label="Tanggal"
            value={filterDate}
            onChange={(event) => {
              setFilterDate(event.target.value)
              setCurrentPage(1)
            }}
          />
        </label>
        <select
          aria-label="All Profile"
          value={filterProfile}
          onChange={(event) => {
            setFilterProfile(event.target.value)
            setCurrentPage(1)
          }}
        >
          <option value="all">All Profile</option>
          {options.profile.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="All Router"
          value={filterRouter}
          onChange={(event) => {
            setFilterRouter(event.target.value)
            setCurrentPage(1)
          }}
        >
          <option value="all">All Router</option>
          {options.router.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Pilih Mitra"
          value={filterMitra}
          onChange={(event) => {
            setFilterMitra(event.target.value)
            setCurrentPage(1)
          }}
        >
          <option value="">Pilih Mitra</option>
          {options.mitra.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Outlet"
          value={filterOutlet}
          onChange={(event) => {
            setFilterOutlet(event.target.value)
            setCurrentPage(1)
          }}
        >
          <option value="all">Semua Outlet</option>
          {options.outlet.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
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
            placeholder="Cari voucher..."
            aria-label="Cari voucher terjual"
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
            <p>Hotspot</p>
            <h1>Voucher Terjual</h1>
          </div>
          <span>{loading ? 'Memuat...' : `${totalData.toLocaleString('id-ID')} voucher`}</span>
        </div>

        {loading && <p className="stok-status">Memuat data voucher...</p>}
        {error && <p className="stok-status stok-error">{error}</p>}

        {!loading && !error && (
          <div className={fetching ? 'stok-table-wrap is-fetching' : 'stok-table-wrap'}>
            <table className="terjual-table">
              <thead>
                <tr>
                  <th className="stok-check">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua voucher terjual"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>USERNAME</th>
                  <th>PASSWORD</th>
                  <th>PROFILE</th>
                  <th>ROUTER</th>
                  <th>SERVER</th>
                  <th>MITRA</th>
                  <th>OUTLET</th>
                  <th>HPP</th>
                  <th>KOMISI</th>
                  <th>HARGA</th>
                  <th>SALDO</th>
                  <th>ADMIN</th>
                  <th>KODE</th>
                  <th>DURASI</th>
                  <th>KUOTA</th>
                  <th>TGL AKTIF</th>
                  <th>TGL EXPIRED</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr>
                    <td colSpan="18" className="stok-empty">
                      {searchTerm || filterDate || filterProfile !== 'all' || filterRouter !== 'all' || filterMitra || filterOutlet !== 'all'
                        ? 'Voucher tidak ditemukan.'
                        : 'Belum ada voucher terjual.'}
                    </td>
                  </tr>
                ) : (
                  currentItems.map((item) => {
                    const isExpired = item.tgl_expired && new Date() > new Date(item.tgl_expired)
                    return (
                    <tr
                      key={item.id || item.username}
                      className={[
                        selectedRows.includes(item.username) ? 'is-selected' : '',
                        isExpired ? 'terjual-expired' : '',
                      ].filter(Boolean).join(' ') || undefined}
                    >
                      <td className="stok-check">
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${item.username}`}
                          checked={selectedRows.includes(item.username)}
                          onChange={() => toggleRow(item.username)}
                        />
                      </td>
                      <td>{item.username}</td>
                      <td className="password-cell">
                        <span className="pwd-masked">••••••••</span>
                        <span className="pwd-revealed">{item.password}</span>
                      </td>
                      <td><span className="stok-profil">{item.profile || '-'}</span></td>
                      <td>{item.router || '-'}</td>
                      <td>{item.server || '-'}</td>
                      <td>{item.mitra || '-'}</td>
                      <td>{item.outlet || '-'}</td>
                      <td>{formatRupiah(item.hpp)}</td>
                      <td>{formatRupiah(item.komisi)}</td>
                      <td>{formatRupiah(item.harga)}</td>
                      <td>{item.saldo == null ? '-' : formatRupiah(item.saldo)}</td>
                      <td>{item.admin || '-'}</td>
                      <td><span className="stok-code">{item.kode_batch || '-'}</span></td>
                      <td>{item.durasi}</td>
                      <td>{item.kuota}</td>
                      <td>{item.tgl_aktif ? formatTanggalWaktu(item.tgl_aktif) : '-'}</td>
                      <td>{item.tgl_expired ? formatTanggalWaktu(item.tgl_expired) : 'UNLIMITED'}</td>
                    </tr>
                    )
                  })
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
            label="Navigasi halaman voucher terjual"
            disabled={fetching}
          />
        )}
      </div>
    </section>
  )
}

export default HotspotTerjual
