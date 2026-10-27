let rememberedTarget = null

export function rememberMikrotikTarget(target) {
  rememberedTarget = target
}

export function readMikrotikTarget() {
  return rememberedTarget
}

export function clearMikrotikMonitor() {
  rememberedTarget = null
}
