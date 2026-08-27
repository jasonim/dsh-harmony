import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants as fsConstants } from 'node:fs'
import { delimiter, join } from 'node:path'

const HDC_FAILURE_PATTERN = /(?:^|\n)(?:\[Fail\]|Connect server failed|Device not found(?:ed)?|ExecuteCommand need connect-key|Unknown operation command)/iu
const TARGET_STATES = new Set(['Unknown', 'Ready', 'Connected', 'Offline', 'Unauthorized'])
const TARGET_TRANSPORTS = new Set(['USB', 'TCP', 'UART'])

export interface HdcProcessResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
}

export interface HdcRunOptions {
  timeoutMs?: number
  maxBytes?: number
}

export type HdcExecute = (
  command: string,
  args: readonly string[],
  options?: HdcRunOptions,
) => Promise<HdcProcessResult>

export interface HarmonyDevice {
  id: string
  transport: string
  state: string
  name?: string
  daemon?: string
}

interface RawHarmonyDevice extends HarmonyDevice {
  connectKey: string
}

export interface HarmonyInventory {
  hdcVersion?: string
  devices: HarmonyDevice[]
}

export class HdcError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'HdcError'
    this.code = code
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function onPath(executable: string, pathValue = process.env.PATH ?? ''): string | undefined {
  for (const directory of pathValue.split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, executable)
    if (isExecutable(candidate)) return candidate
  }
  return undefined
}

export function resolveHdcCommand(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HARMONY_HDC?.trim()
  if (explicit !== undefined && explicit !== '') {
    if (!isExecutable(explicit)) {
      throw new HdcError('HDC_NOT_EXECUTABLE', 'HARMONY_HDC does not point to an executable file')
    }
    return explicit
  }

  const executable = process.platform === 'win32' ? 'hdc.exe' : 'hdc'
  const fromPath = onPath(executable, env.PATH)
  if (fromPath !== undefined) return fromPath
  const candidates: string[] = []
  for (const root of [env.DEVECO_SDK_HOME, env.OHOS_SDK_HOME]) {
    if (root === undefined || root.trim() === '') continue
    candidates.push(join(root, 'default', 'harmonyos', 'toolchains', executable))
    candidates.push(join(root, 'default', 'openharmony', 'toolchains', executable))
    candidates.push(join(root, 'toolchains', executable))
  }
  if (process.platform === 'darwin') {
    const root = '/Applications/DevEco-Studio.app/Contents/sdk/default'
    candidates.push(join(root, 'harmonyos', 'toolchains', executable))
    candidates.push(join(root, 'openharmony', 'toolchains', executable))
  }
  const discovered = candidates.find(isExecutable)
  if (discovered !== undefined) return discovered
  throw new HdcError(
    'HDC_UNAVAILABLE',
    'hdc was not found; set HARMONY_HDC, add hdc to PATH, or install DevEco Studio',
  )
}

export function runHdcProcess(
  command: string,
  args: readonly string[],
  options: HdcRunOptions = {},
): Promise<HdcProcessResult> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxBytes = options.maxBytes ?? 512 * 1024
  if (!args.every(argument => typeof argument === 'string')) {
    return Promise.reject(new TypeError('HDC arguments must be strings'))
  }
  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let settled = false
    const finishError = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.kill('SIGKILL')
      reject(error)
    }
    const append = (target: Buffer[]) => (chunk: Buffer): void => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        finishError(new HdcError('HDC_OUTPUT_LIMIT', `HDC output exceeded ${maxBytes} bytes`))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', append(stdout))
    child.stderr.on('data', append(stderr))
    child.on('error', () => finishError(new HdcError('HDC_SPAWN_FAILED', 'Unable to start hdc')))
    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      })
    })
    const timeout = setTimeout(() => {
      finishError(new HdcError('HDC_TIMEOUT', `HDC command exceeded ${timeoutMs} ms`))
    }, timeoutMs)
    timeout.unref?.()
  })
}

export function deviceId(connectKey: string): string {
  return `device-${createHash('sha256').update(connectKey).digest('hex').slice(0, 12)}`
}

function parseTargets(output: string): RawHarmonyDevice[] {
  return output
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '' && line !== '[Empty]')
    .map(line => {
      const fields = line.split(/\s+/u)
      const connectKey = fields[0]
      let cursor = 1
      let transport = 'Unknown'
      let state = 'Unknown'
      if (TARGET_TRANSPORTS.has(fields[cursor])) transport = fields[cursor++]
      if (TARGET_STATES.has(fields[cursor])) state = fields[cursor++]
      return {
        connectKey,
        id: deviceId(connectKey),
        transport,
        state,
        ...(fields[cursor] === undefined ? {} : { name: fields[cursor] }),
        ...(fields[cursor + 1] === undefined ? {} : { daemon: fields[cursor + 1] }),
      }
    })
}

function isSuccess(result: HdcProcessResult): boolean {
  return result.exitCode === 0
    && result.signal === null
    && !HDC_FAILURE_PATTERN.test(`${result.stdout}\n${result.stderr}`)
}

function publicDevice(device: RawHarmonyDevice): HarmonyDevice {
  return {
    id: device.id,
    transport: device.transport,
    state: device.state,
    ...(device.name === undefined ? {} : { name: device.name }),
    ...(device.daemon === undefined ? {} : { daemon: device.daemon }),
  }
}

export class HarmonyHdcClient {
  readonly command: string
  readonly execute: HdcExecute
  readonly #queues = new Map<string, Promise<void>>()

  constructor(options: { command?: string; execute?: HdcExecute } = {}) {
    this.command = options.command ?? resolveHdcCommand()
    this.execute = options.execute ?? runHdcProcess
  }

  async #rawInventory(): Promise<{ hdcVersion?: string; devices: RawHarmonyDevice[] }> {
    const version = await this.execute(this.command, ['-v'], { timeoutMs: 10_000 })
    if (!isSuccess(version)) throw new HdcError('HDC_VERSION_FAILED', 'Unable to read the HDC version')
    const listed = await this.execute(
      this.command,
      ['list', 'targets', '-v'],
      { timeoutMs: 25_000 },
    )
    if (!isSuccess(listed)) throw new HdcError('HDC_LIST_FAILED', 'Unable to list HDC targets')
    return {
      hdcVersion: version.stdout.match(/\bVer:\s*([^\s,]+)/u)?.[1],
      devices: parseTargets(listed.stdout),
    }
  }

  async inventory(): Promise<HarmonyInventory> {
    const inventory = await this.#rawInventory()
    return {
      ...(inventory.hdcVersion === undefined ? {} : { hdcVersion: inventory.hdcVersion }),
      devices: inventory.devices.map(publicDevice),
    }
  }

  async #resolve(reference?: string): Promise<RawHarmonyDevice> {
    const { devices } = await this.#rawInventory()
    let device: RawHarmonyDevice | undefined
    if (reference === undefined || reference === '') {
      const ready = devices.filter(item => item.transport === 'USB' && item.state === 'Connected')
      if (ready.length !== 1) {
        throw new HdcError('DEVICE_REQUIRED', 'device is required when zero or multiple USB devices are connected')
      }
      ;[device] = ready
    } else {
      device = devices.find(item => item.id === reference || item.connectKey === reference)
    }
    if (device === undefined) throw new HdcError('DEVICE_NOT_FOUND', 'Requested device was not found')
    if (device.transport !== 'USB' || device.state !== 'Connected') {
      throw new HdcError('DEVICE_NOT_READY', 'Device must be USB and Connected')
    }
    return device
  }

  async exec(
    reference: string | undefined,
    args: readonly string[],
    options: HdcRunOptions = {},
  ): Promise<HdcProcessResult> {
    const device = await this.#resolve(reference)
    return this.#exclusive(device.connectKey, async () => {
      const result = await this.execute(
        this.command,
        ['-t', device.connectKey, ...args],
        options,
      )
      if (!isSuccess(result)) {
        throw new HdcError('HDC_COMMAND_FAILED', 'Targeted HDC command failed')
      }
      return result
    })
  }

  async #exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(key) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>(resolve => {
      release = resolve
    })
    this.#queues.set(key, previous.catch(() => {}).then(() => current))
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release?.()
      if (this.#queues.get(key) === current) this.#queues.delete(key)
    }
  }
}
