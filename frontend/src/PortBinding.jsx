const LAN_COUNT = 4
const SSID_MAX = 8

export function resolveSsidCount(wlans, reported) {
  const fromList = Array.isArray(wlans)
    ? wlans.reduce((max, wlan) => Math.max(max, Number(wlan?.id) || 0), 0)
    : 0
  const fromDevice = Number(reported) || 0
  const count = Math.max(fromList, fromDevice)
  if (count <= 0) {
    return 4
  }
  return Math.min(SSID_MAX, count)
}

export function listsToSelectedPorts(lan = [], wlan = []) {
  return [
    ...lan.map((index) => `lan${index}`),
    ...wlan.map((index) => `ssid${index}`),
  ]
}

export function selectedPortsToLists(selectedPorts = []) {
  const lan = []
  const wlan = []
  for (const key of selectedPorts) {
    const lanMatch = /^lan([1-4])$/.exec(key)
    const ssidMatch = /^ssid([1-8])$/.exec(key)
    if (lanMatch) {
      lan.push(Number(lanMatch[1]))
    }
    if (ssidMatch) {
      wlan.push(Number(ssidMatch[1]))
    }
  }
  lan.sort((left, right) => left - right)
  wlan.sort((left, right) => left - right)
  return { lan, wlan }
}

export function flagsToSelectedPorts(flags = {}) {
  return Object.entries(flags).filter(([, on]) => on).map(([key]) => key)
}

export function selectedPortsToFlags(selectedPorts = []) {
  const flags = {}
  for (let index = 1; index <= LAN_COUNT; index += 1) {
    flags[`lan${index}`] = false
  }
  for (let index = 1; index <= SSID_MAX; index += 1) {
    flags[`ssid${index}`] = false
  }
  for (const key of selectedPorts) {
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      flags[key] = true
    }
  }
  return flags
}

// Path TR-069 (...LANEthernetInterfaceConfig.1 / ...WLANConfiguration.5) dan token singkat (LAN1, SSID5).
export function boundPortKeys(bindString) {
  const text = String(bindString || '')
  const bound = []
  for (let index = 1; index <= LAN_COUNT; index += 1) {
    const path = new RegExp(`LANEthernetInterfaceConfig\\.${index}(?!\\d)`)
    const token = new RegExp(`(?:^|[,\\s])LAN${index}(?!\\d)`)
    if (path.test(text) || token.test(text)) {
      bound.push(`lan${index}`)
    }
  }
  for (let index = 1; index <= SSID_MAX; index += 1) {
    const path = new RegExp(`WLANConfiguration\\.${index}(?!\\d)`)
    const token = new RegExp(`(?:^|[,\\s])SSID${index}(?!\\d)`)
    if (path.test(text) || token.test(text)) {
      bound.push(`ssid${index}`)
    }
  }
  return bound
}

function portIndexes(count) {
  return Array.from({ length: count }, (_, index) => index + 1)
}

function Mark({ bound, label }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${bound
      ? 'bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400'
      : 'bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400'}`}
    >
      <span aria-hidden="true">{bound ? '✔' : '✖'}</span>
      {label}
    </span>
  )
}

export function PortBindingStatus({ bind = '', ssidCount = 4 }) {
  const bound = new Set(boundPortKeys(bind))
  const wifiCount = resolveSsidCount(null, ssidCount)
  const wifi24 = portIndexes(Math.min(4, wifiCount))
  const wifi5 = wifiCount > 4 ? portIndexes(wifiCount - 4).map((index) => index + 4) : []

  return (
    <div className="grid gap-3 border-t border-gray-100 px-4 py-3 dark:border-slate-700">
      <div>
        <p className="m-0 mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">LAN bind</p>
        <div className="flex flex-wrap gap-2">
          {portIndexes(LAN_COUNT).map((index) => (
            <Mark key={`lan${index}`} bound={bound.has(`lan${index}`)} label={`LAN${index}`} />
          ))}
        </div>
      </div>
      <div>
        <p className="m-0 mb-2 text-[11px] font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">WiFi bind</p>
        <div className="flex flex-wrap gap-2">
          {wifi24.map((index) => (
            <Mark key={`ssid${index}`} bound={bound.has(`ssid${index}`)} label={`SSID${index}`} />
          ))}
          {wifi5.map((index) => (
            <Mark key={`ssid${index}`} bound={bound.has(`ssid${index}`)} label={`SSID${index}`} />
          ))}
        </div>
      </div>
    </div>
  )
}

function BindBox({ checked, label, accent, onChange }) {
  const active = accent === 'blue'
    ? 'border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-100'
    : 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:border-cyan-500 dark:bg-cyan-950/40 dark:text-cyan-100'
  return (
    <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${checked
      ? active
      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-200'}`}
    >
      <input
        type="checkbox"
        className={`h-4 w-4 shrink-0 cursor-pointer ${accent === 'blue' ? 'accent-blue-600' : 'accent-cyan-600'}`}
        checked={checked}
        onChange={() => onChange(!checked)}
      />
      {label}
    </label>
  )
}

export function PortBindingFields({ ssidCount = 4, selectedPorts = [], onChange, accent = 'cyan' }) {
  const selected = new Set(selectedPorts)
  const wifiCount = resolveSsidCount(null, ssidCount)
  const wifi24 = portIndexes(Math.min(4, wifiCount))
  const wifi5 = wifiCount > 4 ? portIndexes(wifiCount - 4).map((index) => index + 4) : []

  function toggle(key, checked) {
    if (checked) {
      onChange(selected.has(key) ? selectedPorts : [...selectedPorts, key])
      return
    }
    onChange(selectedPorts.filter((item) => item !== key))
  }

  const group = (title, ports, prefix) => (
    <div>
      <p className="m-0 mb-2 text-[11px] font-bold tracking-wider text-gray-400 uppercase">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ports.map((index) => {
          const key = `${prefix}${index}`
          return (
            <BindBox
              key={key}
              label={prefix === 'lan' ? `LAN${index}` : `SSID${index}`}
              checked={selected.has(key)}
              accent={accent}
              onChange={(checked) => toggle(key, checked)}
            />
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="grid gap-4">
      {group('LAN bind', portIndexes(LAN_COUNT), 'lan')}
      {group('WiFi bind 2.4 GHz', wifi24, 'ssid')}
      {wifi5.length > 0 && group('WiFi bind 5 GHz', wifi5, 'ssid')}
    </div>
  )
}
