import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { Users, Wifi } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Swal from 'sweetalert2'
import api from './api/axios.js'
import { getToken } from './api/auth.js'
import { resolveApiOrigin } from './api/origin.js'

const apiOrigin = resolveApiOrigin()
const HISTORY_LIMIT = 30
const RX_COLOR = '#0891b2'
const TX_COLOR = '#7c3aed'

const fieldClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-cyan-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'
const cardClass = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900'

function formatRate(bits) {
  const value = Number(bits)
  if (!Number.isFinite(value) || value < 0) {
    return '-'
  }
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps']
  let amount = value
  let index = 0
  while (amount >= 1000 && index < units.length - 1) {
    amount /= 1000
    index += 1
  }
  const digits = amount >= 100 || index === 0 ? 0 : amount >= 10 ? 1 : 2
  return `${amount.toFixed(digits)} ${units[index]}`
}

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) {
    return '-'
  }
  return `${(value / 1048576).toFixed(0)} MB`
}

function gaugeFill(percent) {
  if (percent >= 90) {
    return '#ef4444'
  }
  if (percent >= 70) {
    return '#eab308'
  }
  return '#22c55e'
}

function Gauge({ label, percent, caption }) {
  const dark = useDarkMode()
  const hasValue = percent != null && Number.isFinite(Number(percent))
  const value = hasValue ? Math.min(100, Math.max(0, Number(percent))) : 0
  const track = dark ? '#1f2937' : '#f3f4f6'
  const valueSlices = value >= 100
    ? [{ name: 'value', value: 100, fill: gaugeFill(value) }]
    : [
        { name: 'value', value, fill: gaugeFill(value) },
        { name: 'rest', value: 100 - value, fill: 'transparent' },
      ]
  const shown = hasValue ? Math.round(value) : null

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative h-[138px] w-full max-w-[240px]"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown ?? 0}
        aria-valuetext={shown == null ? 'belum ada data' : `${shown} persen`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={[{ name: 'track', value: 100 }]}
              dataKey="value"
              startAngle={180}
              endAngle={0}
              cx="50%"
              cy="100%"
              innerRadius={70}
              outerRadius={90}
              stroke="none"
              cornerRadius={8}
              fill={track}
              isAnimationActive={false}
            />
            {value > 0 && (
              <Pie
                data={valueSlices}
                dataKey="value"
                nameKey="name"
                startAngle={180}
                endAngle={0}
                cx="50%"
                cy="100%"
                innerRadius={70}
                outerRadius={90}
                stroke="none"
                cornerRadius={value >= 30 ? 8 : 0}
                isAnimationActive
                animationDuration={500}
                animationEasing="ease-out"
              >
                {valueSlices.map((slice) => (
                  <Cell key={slice.name} fill={slice.fill} />
                ))}
              </Pie>
            )}
          </PieChart>
        </ResponsiveContainer>
        <p className="pointer-events-none absolute inset-x-0 bottom-0 m-0 text-center text-3xl font-bold tabular-nums text-gray-800 dark:text-gray-100">
          {shown == null ? '–' : shown}
          <span className="ml-0.5 text-lg font-semibold text-gray-400">%</span>
        </p>
      </div>
      <p className="m-0 mt-2 text-xs font-semibold tracking-wider text-gray-400 uppercase">{label}</p>
      {caption && <p className="m-0 mt-1 text-center text-xs text-gray-500 dark:text-gray-400">{caption}</p>}
    </div>
  )
}

const metricCardClass = 'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md dark:border-gray-800 dark:bg-slate-900'
const metricLabelClass = 'm-0 text-xs font-semibold tracking-wider text-gray-400 uppercase'
const metricValueClass = 'm-0 mt-2 text-4xl font-bold tabular-nums text-gray-800 dark:text-gray-100'

function MetricBadge({ children, className }) {
  return (
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${className}`}>
      {children}
    </span>
  )
}

function useDarkMode() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setDark(root.classList.contains('dark'))
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return dark
}

function TrafficTooltip({ active, payload, dark }) {
  if (!active || !payload?.length) {
    return null
  }
  const time = payload[0]?.payload?.time
  return (
    <div className={`rounded-lg px-3 py-2 shadow-lg ${dark ? 'bg-slate-800 text-slate-100' : 'bg-white text-slate-800'}`}>
      {time && (
        <p className={`m-0 mb-1 text-[11px] ${dark ? 'text-slate-400' : 'text-slate-400'}`}>
          {new Date(time).toLocaleTimeString('id-ID')}
        </p>
      )}
      {payload.map((item) => (
        <p key={item.dataKey} className="m-0 text-sm font-semibold tabular-nums" style={{ color: item.color || item.stroke }}>
          {item.dataKey === 'tx' ? 'TX' : 'RX'} {formatRate(item.value)}
        </p>
      ))}
    </div>
  )
}

function TrafficChart({ points }) {
  const dark = useDarkMode()
  const tick = { fill: dark ? '#94a3b8' : '#64748b', fontSize: 11 }
  return (
    <div className="h-[300px] w-full" role="img" aria-label="Grafik bandwidth RX dan TX">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={points} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRX" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorTX" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
              <stop offset="58%" stopColor="#10b981" stopOpacity={0.16} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={dark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.35)'} />
          <XAxis
            dataKey="time"
            axisLine={false}
            tickLine={false}
            tick={tick}
            minTickGap={36}
            tickFormatter={(value) => new Date(value).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={tick}
            width={68}
            tickFormatter={(value) => formatRate(value)}
          />
          <Tooltip content={(props) => <TrafficTooltip {...props} dark={dark} />} cursor={{ stroke: dark ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.35)', strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey="rx" stroke={RX_COLOR} strokeWidth={2} fill="url(#colorRX)" fillOpacity={1} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: RX_COLOR }} animationDuration={500} animationEasing="ease-out" />
          <Area type="monotone" dataKey="tx" stroke={TX_COLOR} strokeWidth={2} fill="url(#colorTX)" fillOpacity={1} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: TX_COLOR }} animationDuration={500} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function Dashboard() {
  const socketRef = useRef(null)
  const selectedRef = useRef('')
  const changeInterfaceRef = useRef(() => {})
  const [routers, setRouters] = useState([])
  const [routerId, setRouterId] = useState('')
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [port, setPort] = useState('8728')
  const [interfaces, setInterfaces] = useState([])
  const [selectedInterface, setSelectedInterface] = useState('')
  const [saved, setSaved] = useState(false)
  const [savedForm, setSavedForm] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [watching, setWatching] = useState(false)
  const [stats, setStats] = useState(null)
  const [history, setHistory] = useState([])
  const [link, setLink] = useState({ state: 'idle', message: '' })
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let ignore = false
    api.get('/api/routers')
      .then((response) => {
        if (!ignore) {
          const rows = Array.isArray(response.data) ? response.data : []
          setRouters(rows.map((item) => ({
            id: item.id,
            name: item.nama_router || item.ip_address,
            host: item.ip_address,
          })))
        }
      })
      .catch(() => {
        if (!ignore) {
          setRouters([])
        }
      })
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!token) {
      return undefined
    }
    const socket = io(apiOrigin, {
      auth: { token },
      transports: ['websocket', 'polling'],
      secure: window.location.protocol === 'https:',
    })
    socketRef.current = socket
    socket.on('connect', () => {
      socket.emit('mikrotik:listen')
    })
    socket.on('connect_error', () => {
      setLink({
        state: 'error',
        message: 'Server pemantauan belum aktif. Mulai ulang server API supaya Socket.io jalan.',
      })
    })
    socket.on('mikrotik:stats', (sample) => {
      setStats(sample)
      setWatching(true)
      setHistory((current) => {
        const selected = selectedRef.current
        if (selected && sample?.iface && sample.iface !== selected) {
          return current
        }
        return [...current, {
          time: sample?.updatedAt || Date.now(),
          rx: Number(sample?.rx) || 0,
          tx: Number(sample?.tx) || 0,
        }].slice(-HISTORY_LIMIT)
      })
    })
    socket.on('interfaceList', (list) => {
      const names = Array.isArray(list)
        ? list.filter((item) => typeof item === 'string' && item.trim())
        : []
      setInterfaces(names)
      const current = selectedRef.current
      if ((!current || !names.includes(current)) && names[0]) {
        changeInterfaceRef.current(names[0])
      }
    })
    socket.on('mikrotik:status', (status) => {
      setLink(status || { state: 'idle', message: '' })
      if (status?.state === 'idle') {
        setWatching(false)
        setInterfaces([])
        selectedRef.current = ''
        setSelectedInterface('')
      }
    })
    return () => {
      socket.removeAllListeners()
      socket.emit('mikrotik:stop')
      socket.disconnect()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    let ignore = false
    async function resumeSaved() {
      try {
        const response = await api.get('/api/mikrotik/session')
        if (ignore || !response.data?.saved) {
          return
        }
        const nextSaved = {
          host: response.data.host || '',
          port: String(response.data.port || 8728),
          username: response.data.username || 'admin',
        }
        setSaved(true)
        setSavedForm(nextSaved)
        setHost(nextSaved.host)
        setUsername(nextSaved.username)
        setPort(nextSaved.port)
        setConnecting(true)
        setLink({ state: 'connecting', message: 'Menghubungkan...' })
        await api.post('/api/mikrotik/connect', { useSaved: true })
        if (ignore) {
          return
        }
        setWatching(true)
        setHistory([])
        socketRef.current?.emit('mikrotik:listen')
      } catch (error) {
        if (ignore) {
          return
        }
        if (!error.response || error.response.status === 404) {
          setLink({
            state: 'error',
            message: 'Server pemantauan belum aktif. Mulai ulang server API supaya Socket.io jalan.',
          })
          return
        }
        const message = error.response.data?.message || 'Kredensial tersimpan gagal dipakai.'
        setFormError(message)
        setLink({ state: 'error', message })
        Swal.fire({ icon: 'error', title: 'Gagal terhubung', text: message })
      } finally {
        if (!ignore) {
          setConnecting(false)
        }
      }
    }
    resumeSaved()
    return () => {
      ignore = true
    }
  }, [])

  async function handleWatch(event) {
    event.preventDefault()
    const selected = routers.find((item) => String(item.id) === routerId)
    const address = (selected?.host || host).trim()
    const matchesSaved = Boolean(savedForm)
      && address === savedForm.host
      && String(Number(port) || 8728) === String(savedForm.port)
      && username.trim() === savedForm.username
    if (!password && !matchesSaved) {
      setFormError('Password API MikroTik wajib diisi.')
      return
    }
    if (password && !address) {
      setFormError('Isi IP MikroTik yang akan dipantau.')
      return
    }
    setConnecting(true)
    setFormError('')
    setLink({ state: 'connecting', message: 'Menghubungkan...' })
    socketRef.current?.emit('mikrotik:listen')
    try {
      const payload = password
        ? {
          host: address,
          port: Number(port) || 8728,
          username: username.trim(),
          password,
        }
        : { useSaved: true }
      const response = await api.post('/api/mikrotik/connect', payload)
      setSaved(true)
      setSavedForm({
        host: response.data?.host || address,
        port: String(response.data?.port || Number(port) || 8728),
        username: response.data?.username || username.trim(),
      })
      if (response.data?.host) {
        setHost(response.data.host)
      }
      setPassword('')
      setStats(null)
      setHistory([])
      setWatching(true)
      socketRef.current?.emit('mikrotik:listen')
      Swal.fire({
        icon: 'success',
        title: 'Terhubung',
        text: response.data?.message || 'Streaming MikroTik dimulai.',
        timer: 1600,
        showConfirmButton: false,
      })
    } catch (error) {
      const message = error.response?.status === 404
        ? 'Endpoint koneksi belum aktif. Mulai ulang server API.'
        : (error.response?.data?.message || 'Gagal menghubungi MikroTik.')
      setFormError(message)
      setLink({ state: 'error', message })
      Swal.fire({ icon: 'error', title: 'Gagal terhubung', text: message })
    } finally {
      setConnecting(false)
    }
  }

  function handleInterfaceChange(value) {
    const next = typeof value === 'string' ? value.trim() : ''
    if (!next) {
      return
    }
    const changed = next !== selectedRef.current
    selectedRef.current = next
    setSelectedInterface(next)
    if (!changed) {
      return
    }
    setHistory([])
    socketRef.current?.emit('setInterface', next)
  }

  changeInterfaceRef.current = handleInterfaceChange

  function handleStop() {
    setWatching(false)
    setStats(null)
    setHistory([])
    setInterfaces([])
    selectedRef.current = ''
    setSelectedInterface('')
    setLink({ state: 'idle', message: '' })
    socketRef.current?.emit('mikrotik:stop')
  }

  const title = stats?.routerName || host || 'MikroTik'
  const shownHost = stats?.host || host
  const live = link.state === 'live'

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-bold tracking-[0.14em] text-cyan-700 uppercase dark:text-cyan-300">MikroTik</p>
          <h1 className="m-0 mt-1 text-2xl font-bold">Dashboard</h1>
          <p className="m-0 mt-1 text-sm text-gray-500 dark:text-gray-400">
            {shownHost ? `${title} · ${shownHost}` : 'Pilih router untuk memulai pemantauan.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 dark:text-gray-300">
            <span className={`h-2.5 w-2.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            {live ? 'Live' : link.state === 'connecting' ? 'Menghubungkan' : 'Siaga'}
          </span>
          {watching && (
            <button
              type="button"
              className="h-10 cursor-pointer rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={handleStop}
            >
              Hentikan
            </button>
          )}
        </div>
      </div>

      <section className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <article className={`${metricCardClass} flex h-full flex-col`}>
          <p className={metricLabelClass}>Resource</p>
          <div className="mt-5 grid flex-1 grid-cols-2 items-center gap-4">
            <Gauge
              label="CPU"
              percent={stats?.cpu}
              caption={stats?.board || 'Menunggu resource router'}
            />
            <Gauge
              label="RAM"
              percent={stats?.ramPercent}
              caption={stats ? `${formatBytes(stats.ramUsed)} / ${formatBytes(stats.ramTotal)}` : 'Menunggu resource router'}
            />
          </div>
        </article>

        <article className={`${metricCardClass} flex h-full flex-col`}>
          <p className={metricLabelClass}>Client Aktif</p>
          <div className="mt-4 grid flex-1 grid-cols-2 items-center divide-x divide-gray-100 dark:divide-gray-800">
            <div className="flex items-center justify-between gap-3 pr-4">
              <div className="min-w-0">
                <p className={metricLabelClass}>PPPoE aktif</p>
                <p className={metricValueClass}>{stats?.pppoe == null ? '–' : stats.pppoe}</p>
                <p className="m-0 mt-2 text-xs text-gray-500 dark:text-gray-400">Sesi /ppp/active</p>
              </div>
              <MetricBadge className="bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
                <Users size={20} strokeWidth={2} />
              </MetricBadge>
            </div>
            <div className="flex items-center justify-between gap-3 pl-4">
              <div className="min-w-0">
                <p className={metricLabelClass}>Hotspot aktif</p>
                <p className={metricValueClass}>{stats?.hotspot == null ? '–' : stats.hotspot}</p>
                <p className="m-0 mt-2 text-xs text-gray-500 dark:text-gray-400">Sesi /ip/hotspot/active</p>
              </div>
              <MetricBadge className="bg-orange-50 text-orange-500 dark:bg-orange-900/30">
                <Wifi size={20} strokeWidth={2} />
              </MetricBadge>
            </div>
          </div>
        </article>
      </section>

      <article className={metricCardClass}>
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <p className={metricLabelClass}>
                Bandwidth {selectedInterface || stats?.iface || 'interface'}
              </p>
              <p className="m-0 mt-1 text-sm text-gray-500 dark:text-gray-400">Kecepatan diperbarui setiap 1,5 detik</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
              <select
                className="block w-full max-w-full truncate rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm text-gray-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:max-w-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                value={selectedInterface}
                disabled={interfaces.length === 0}
                aria-label="Interface trafik"
                title={selectedInterface || 'Menunggu daftar interface'}
                onChange={(event) => handleInterfaceChange(event.target.value)}
              >
                {interfaces.length === 0 ? (
                  <option value="">{stats?.iface || 'Belum terhubung'}</option>
                ) : interfaces.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <div className="flex gap-6">
                <p className="m-0 text-right">
                  <span className="block text-xs font-bold tracking-wide text-cyan-600 uppercase dark:text-cyan-400">RX</span>
                  <span className="text-2xl font-bold tabular-nums text-cyan-700 dark:text-cyan-300">{formatRate(stats?.rx)}</span>
                </p>
                <p className="m-0 text-right">
                  <span className="block text-xs font-bold tracking-wide text-violet-600 uppercase dark:text-violet-400">TX</span>
                  <span className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-300">{formatRate(stats?.tx)}</span>
                </p>
              </div>
            </div>
          </div>
          <div className="mt-2">
            {history.length > 0 ? <TrafficChart points={history} /> : (
              <p className="m-0 flex h-[300px] items-center justify-center text-sm text-gray-400">Grafik muncul setelah router mengirim sampel.</p>
            )}
          </div>
          <div className="mt-1 flex gap-4 text-xs font-semibold">
            <span className="text-cyan-600 dark:text-cyan-400">RX</span>
            <span className="text-violet-600 dark:text-violet-400">TX</span>
          </div>
          {link.message && link.state === 'error' && (
            <p className="m-0 mt-3 text-sm font-semibold text-red-600 dark:text-red-400">{link.message}</p>
          )}
          {stats?.warnings?.length > 0 && (
            <p className="m-0 mt-2 text-xs text-amber-700 dark:text-amber-300">{stats.warnings.join(' · ')}</p>
          )}
          {stats?.updatedAt && (
            <p className="m-0 mt-2 text-xs text-gray-400">
              Diperbarui {new Date(stats.updatedAt).toLocaleTimeString('id-ID')}
              {stats.version ? ` · RouterOS ${stats.version}` : ''}
            </p>
          )}
      </article>

      <form className={`${cardClass} grid gap-3 md:grid-cols-2 xl:grid-cols-6`} onSubmit={handleWatch}>
        <p className={`${metricLabelClass} md:col-span-2 xl:col-span-6`}>Koneksi MikroTik</p>
        {routers.length > 0 && (
          <label className="block text-xs font-semibold text-gray-600 lg:col-span-2 dark:text-gray-300">
            Router tersimpan
            <select
              className={fieldClass}
              value={routerId}
              onChange={(event) => {
                const nextId = event.target.value
                setRouterId(nextId)
                const next = routers.find((item) => String(item.id) === nextId)
                if (next?.host) {
                  setHost(next.host)
                }
              }}
            >
              <option value="">Ketik IP sendiri</option>
              {routers.map((item) => (
                <option key={item.id} value={item.id}>{item.name} · {item.host}</option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">
          IP Address
          <input className={fieldClass} value={host} placeholder="192.168.88.1" autoComplete="off" onChange={(event) => { setHost(event.target.value); setRouterId('') }} />
        </label>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">
          API Port
          <input className={fieldClass} inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">
          Username
          <input className={fieldClass} value={username} autoComplete="off" onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">
          Password
          <input className={fieldClass} type="password" value={password} autoComplete="new-password" placeholder={saved ? 'Kosongkan untuk memakai sandi tersimpan' : ''} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="h-10 w-full cursor-pointer rounded-lg border-0 bg-cyan-700 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={connecting}
          >
            {connecting ? 'Menghubungkan...' : 'Mulai pantau'}
          </button>
        </div>
        <p className="m-0 text-xs leading-5 text-gray-500 md:col-span-2 xl:col-span-6 dark:text-gray-400">
          Password API disimpan di server dan dipakai lagi setelah restart. Port bawaan 8728.
        </p>
        {(formError || (link.state === 'error' && link.message)) && (
          <p className="m-0 text-xs font-semibold text-red-600 md:col-span-2 xl:col-span-6 dark:text-red-400">{formError || link.message}</p>
        )}
      </form>
    </div>
  )
}

export default Dashboard
