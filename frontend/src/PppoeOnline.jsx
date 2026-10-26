import { useEffect, useState } from 'react'
import api from './api/axios.js'
import ServerPagination from './ServerPagination.jsx'
import useDebouncedValue from './useDebouncedValue.js'
import './PppoeOnline.css'

const ONLINE_URL = '/api/langganan/online'

function formatLoginTime(value) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const jam = String(Math.floor(total / 3600)).padStart(2, '0')
  const menit = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const detik = String(total % 60).padStart(2, '0')
  return `${jam}:${menit}:${detik}`
}

function PppoeOnline() {
  const [sessions, setSessions] = useState([])
  const [totalData, setTotalData] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [searchTerm, setSearchTerm] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [disconnecting, setDisconnecting] = useState('')

  const debouncedSearch = useDebouncedValue(searchTerm.trim())

  // Server-side pagination: backend hanya mengirim satu halaman sesi langganan.
  useEffect(() => {
    let ignore = false

    async function loadOnline() {
      setFetching(true)
      try {
        const response = await api.get(ONLINE_URL, {
          params: { page: currentPage, limit: itemsPerPage, q: debouncedSearch },
        })
        if (ignore) {
          return
        }
        const payload = response.data
        setSessions(Array.isArray(payload?.data) ? payload.data : [])
        setTotalData(Number(payload?.total) || 0)
        setTotalPages(Math.max(1, Number(payload?.total_pages) || 1))
        setError('')
        if (payload?.page && payload.page !== currentPage) {
          setCurrentPage(payload.page)
        }
      } catch {
        if (!ignore) {
          setSessions([])
          setError('Gagal memuat data pelanggan online.')
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
  }, [currentPage, itemsPerPage, debouncedSearch, reloadKey])

  function handleDisconnect(session) {
    const confirmed = window.confirm('Putus koneksi pelanggan ini?')
    if (!confirmed) {
      return
    }

    setDisconnecting(`${session.username}|${session.ip_address}`)
    setActionError('')

    api
      .post('/api/pppoe/disconnect', {
        username: session.username,
        ip_address: session.ip_address,
      })
      .then(() => {
        setTimeout(() => {
          setReloadKey((key) => key + 1)
          setDisconnecting('')
        }, 2000)
      })
      .catch(() => {
        setActionError('Gagal memutus koneksi pelanggan.')
        setDisconnecting('')
      })
  }

  return (
    <section className="monitoring">
      <header className="monitoring-header">
        <p>Sesi Aktif</p>
        <h1>Langganan Online</h1>
      </header>

      <div className="monitoring-card">
        <div className="monitoring-toolbar">
          <span className="monitoring-total">
            {loading ? 'Memuat...' : `${totalData.toLocaleString('id-ID')} online`}
          </span>
          <div className="monitoring-tools">
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
            <input
              type="search"
              placeholder="Cari pelanggan online..."
              aria-label="Cari langganan online"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value)
                setCurrentPage(1)
              }}
            />
          </div>
        </div>

        {loading && <p className="monitoring-status">Memuat data sesi...</p>}
        {error && <p className="monitoring-status monitoring-error">{error}</p>}
        {actionError && <p className="monitoring-status monitoring-error">{actionError}</p>}

        {!loading && !error && sessions.length === 0 && (
          <p className="monitoring-status">
            {searchTerm ? 'Pelanggan tidak ditemukan.' : 'Tidak ada pelanggan yang sedang online'}
          </p>
        )}

        {!loading && !error && sessions.length > 0 && (
          <div className={fetching ? 'monitoring-table-wrap is-fetching' : 'monitoring-table-wrap'}>
            <table className="monitoring-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Username</th>
                  <th>Pelanggan</th>
                  <th>Profil</th>
                  <th>IP Address</th>
                  <th>Uptime</th>
                  <th>Waktu Login</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session, index) => (
                  <tr key={session.id}>
                    <td>{(currentPage - 1) * itemsPerPage + index + 1}</td>
                    <td>{session.username}</td>
                    <td>{session.pelanggan || '-'}</td>
                    <td>{session.profil || '-'}</td>
                    <td>{session.ip_address || '-'}</td>
                    <td>{formatUptime(session.uptime)}</td>
                    <td>{formatLoginTime(session.login_time)}</td>
                    <td>
                      <button
                        type="button"
                        className="monitoring-disconnect"
                        onClick={() => handleDisconnect(session)}
                        disabled={disconnecting === `${session.username}|${session.ip_address}`}
                      >
                        {disconnecting === `${session.username}|${session.ip_address}` ? 'Memutus...' : 'Disconnect'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && totalData > 0 && (
          <ServerPagination
            page={currentPage}
            totalPages={totalPages}
            totalData={totalData}
            limit={itemsPerPage}
            onPageChange={setCurrentPage}
            label="Navigasi halaman langganan online"
            disabled={fetching}
          />
        )}
      </div>
    </section>
  )
}

export default PppoeOnline
