import { createHash } from 'node:crypto'

const TARGET_STATES = new Set(['Unknown', 'Ready', 'Connected', 'Offline', 'Unauthorized'])
const TARGET_TRANSPORTS = new Set(['USB', 'TCP', 'UART'])

export function parseHdcTargets(output) {
  const lines = String(output ?? '')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line.length > 0 && line !== '[Empty]')

  return lines.map(line => {
    const fields = line.split(/\s+/u)
    const connectKey = fields[0]
    let transport = 'Unknown'
    let state = 'Unknown'
    let cursor = 1

    if (TARGET_TRANSPORTS.has(fields[cursor])) {
      transport = fields[cursor]
      cursor += 1
    }
    if (TARGET_STATES.has(fields[cursor])) {
      state = fields[cursor]
      cursor += 1
    }

    return {
      connectKey,
      transport,
      state,
      name: fields[cursor],
      daemon: fields[cursor + 1],
    }
  })
}

function parseVersion(version) {
  const match = String(version ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/u)
  return match ? match.slice(1).map(Number) : undefined
}

function versionAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true
    if (version[index] < minimum[index]) return false
  }
  return true
}

export function classifyUiTestCapabilities(versionText) {
  const version = parseVersion(versionText)
  if (!version) {
    return {
      version: undefined,
      screenshot: false,
      dumpLayout: false,
      shellInput: false,
      richTree: false,
      bundleFilteredTree: false,
      focusedTextInput: false,
    }
  }

  const normalized = version.join('.')
  return {
    version: normalized,
    screenshot: versionAtLeast(version, [3, 2, 0, 0]),
    dumpLayout: versionAtLeast(version, [3, 2, 0, 0]),
    shellInput: versionAtLeast(version, [4, 1, 2, 0]),
    richTree: versionAtLeast(version, [4, 1, 4, 0]),
    bundleFilteredTree: versionAtLeast(version, [5, 1, 1, 2]),
    focusedTextInput: versionAtLeast(version, [5, 1, 1, 1]),
  }
}

export function parseCliArgs(argv) {
  const args = [...argv]
  let mode
  let device
  let soak = 0

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--list') {
      if (mode) throw new TypeError('Exactly one mode is required')
      mode = 'list'
      continue
    }
    if (argument === '--all') {
      if (mode) throw new TypeError('Exactly one mode is required')
      mode = 'all'
      continue
    }
    if (argument === '--device') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new TypeError('--device requires a connect key')
      device = value
      index += 1
      continue
    }
    if (argument === '--soak') {
      if (mode) throw new TypeError('Exactly one mode is required')
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new TypeError('--soak requires a count')
      soak = Number(value)
      if (!Number.isSafeInteger(soak) || soak < 1 || soak > 500) {
        throw new RangeError('--soak must be between 1 and 500')
      }
      mode = 'soak'
      index += 1
      continue
    }
    throw new TypeError(`Unknown option: ${argument}`)
  }

  if (!mode) throw new TypeError('Exactly one mode is required')
  if (mode !== 'list' && !device) throw new TypeError(`${mode} requires --device`)

  return { mode, device, soak, json: true }
}

export function deviceHash(connectKey) {
  const digest = createHash('sha256').update(String(connectKey)).digest('hex').slice(0, 12)
  return `device-${digest}`
}

function nearestRank(sorted, percentile) {
  if (sorted.length === 0) return undefined
  const rank = Math.max(1, Math.ceil(percentile * sorted.length))
  return sorted[rank - 1]
}

export function summarizeDurations(samples) {
  if (samples.length === 0) {
    return {
      count: 0,
      minMs: undefined,
      maxMs: undefined,
      meanMs: undefined,
      p50Ms: undefined,
      p95Ms: undefined,
    }
  }

  const sorted = [...samples].sort((left, right) => left - right)
  const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length
  return {
    count: samples.length,
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    meanMs: Number(mean.toFixed(2)),
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
  }
}
