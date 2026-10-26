import { useEffect, useState } from 'react'
import { Database, Globe, RefreshCw, ShieldCheck } from 'lucide-react'
import api from './api/axios.js'
import './ServiceHealth.css'

const REFRESH_MS = 10000

const SERVICES = [
  { key: 'web', name: 'Sistem Web', icon: Globe },
  { key: 'database', name: 'Database MariaDB', icon: Database },
  { key: 'radius', name: 'Radius Server', icon: ShieldCheck },
]

function formatJam(isoText) {
  if (!isoText) {
    return '-'
  }
  return new Date(isoText).toLocaleTimeString('en-GB', { hour12: false })
}

function ServiceHealth() {
  const [health, setHealth] = useState(null)
  const [unreachable, setUnreachable] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let ignore = false

    async function check() {
      setChecking(true)
      try {
        const response = await api.get('/api/system/health')
        if (!ignore) {
          setHealth(response.data)
          setUnreachable(false)
        }
      } catch (error) {
        // 401 ditangani interceptor (redirect ke login); selain itu backend dianggap tidak terjangkau.
        if (!ignore && error.response?.status !== 401) {
          setUnreachable(true)
        }
      } finally {
        if (!ignore) {
          setChecking(false)
        }
      }
    }

    check()
    const timer = setInterval(check, REFRESH_MS)
    return () => {
      ignore = true
      clearInterval(timer)
    }
  }, [])

  function stateOf(key) {
    if (unreachable) {
      // Backend tidak merespons: Web pasti offline, layanan lain tidak bisa diperiksa.
      return key === 'web' ? 'offline' : 'unknown'
    }
    const status = health?.[key]?.status
    if (!status) {
      return 'unknown'
    }
    return status === 'Online' ? 'online' : 'offline'
  }

  function detailOf(key) {
    if (unreachable) {
      return key === 'web' ? 'Backend tidak merespons' : 'Tidak dapat diperiksa'
    }
    if (!health) {
      return 'Memeriksa...'
    }
    if (key === 'database' && health.database?.latency_ms != null) {
      return `Respon ${health.database.latency_ms} ms`
    }
    if (key === 'radius') {
      return `Service: ${health.radius?.detail || '-'}`
    }
    if (key === 'database') {
      return `Error: ${health.database?.detail || '-'}`
    }
    return 'Backend merespons'
  }

  const labels = { online: 'Online', offline: 'Offline', unknown: '...' }

  return (
    <section className="health-panel" aria-label="Status Layanan">
      <header className="health-head">
        <div>
          <h2>Status Layanan</h2>
          <p>
            {unreachable
              ? 'Gagal menghubungi server'
              : `Pemeriksaan terakhir ${formatJam(health?.checked_at)} · otomatis tiap 10 detik`}
          </p>
        </div>
        <span className={checking ? 'health-refresh is-spinning' : 'health-refresh'} aria-hidden="true">
          <RefreshCw size={16} />
        </span>
      </header>

      <div className="health-grid">
        {SERVICES.map(({ key, name, icon: Icon }) => {
          const state = stateOf(key)
          return (
            <article key={key} className={`health-card is-${state}`}>
              <span className="health-icon">
                <Icon size={22} />
              </span>
              <div className="health-info">
                <h3>{name}</h3>
                <p>{detailOf(key)}</p>
              </div>
              <span className={`health-badge is-${state}`}>
                <i aria-hidden="true" />
                {labels[state]}
              </span>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default ServiceHealth
