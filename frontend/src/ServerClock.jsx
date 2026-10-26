import { useEffect, useRef, useState } from 'react'
import api from './api/axios.js'

const API = '/api/settings/server-time'
const SYNC_INTERVAL_MS = 60000

export const TIMEZONE_CHANGED_EVENT = 'timezone-changed'

const ZONE_LABELS = {
  'Asia/Jakarta': 'WIB',
  'Asia/Makassar': 'WITA',
  'Asia/Jayapura': 'WIT',
}

function formatServerTime(epoch, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epoch))
  const get = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`
}

function ServerClock() {
  const [timezone, setTimezone] = useState('')
  const [text, setText] = useState('')
  const offsetRef = useRef(0)
  const timezoneRef = useRef('')

  useEffect(() => {
    let ignore = false

    async function sync() {
      try {
        const response = await api.get(API)
        if (ignore || !response.data?.now) {
          return
        }
        // Selisih jam server dengan jam browser, agar yang tampil adalah waktu server.
        offsetRef.current = response.data.now - Date.now()
        timezoneRef.current = response.data.timezone
        setTimezone(response.data.timezone)
      } catch {
        // Jika gagal, jam tetap berjalan dengan data sinkron terakhir.
      }
    }

    function tick() {
      if (timezoneRef.current) {
        setText(formatServerTime(Date.now() + offsetRef.current, timezoneRef.current))
      }
    }

    sync()
    const syncTimer = setInterval(sync, SYNC_INTERVAL_MS)
    const tickTimer = setInterval(tick, 1000)
    window.addEventListener(TIMEZONE_CHANGED_EVENT, sync)

    return () => {
      ignore = true
      clearInterval(syncTimer)
      clearInterval(tickTimer)
      window.removeEventListener(TIMEZONE_CHANGED_EVENT, sync)
    }
  }, [])

  // Isi awal segera setelah zona waktu diketahui, tanpa menunggu tick berikutnya.
  const display = timezone && text ? text : timezone ? formatServerTime(Date.now() + offsetRef.current, timezone) : '...'

  return (
    <div className="-mt-3 grid gap-0.5 rounded-lg border border-sky-200/25 bg-white/10 px-3 py-2" title="Waktu server saat ini">
      <span className="text-[10px] font-bold tracking-[0.12em] text-sky-200 uppercase">Waktu Server</span>
      <strong className="text-[13px] font-semibold whitespace-nowrap text-white tabular-nums">
        {display}{timezone ? ` ${ZONE_LABELS[timezone] || ''}` : ''}
      </strong>
    </div>
  )
}

export default ServerClock
