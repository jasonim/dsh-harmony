import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildUiInputCommand, type HarmonyFrameReference, type HarmonyUiAction } from './ui-actions.ts'
import { flattenUiTree, type HarmonyUiNode } from './ui-tree.ts'

const REMOTE_ROOT = '/data/local/tmp'
const SAFE_PART = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/u
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface HdcClientLike {
  exec(reference: string | undefined, args: readonly string[]): Promise<unknown>
}

export interface HarmonyFrame extends HarmonyFrameReference {
  path: string
  bytes: number
  capturedAt: number
  sequence: number
  device: string
}

export interface HarmonyDeviceControllerOptions {
  cacheDir: string
  idFactory?: () => string
  settleMs?: number
}

function dimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new TypeError('HDC screenshot is not a valid PNG')
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function safePart(value: string, label: string): string {
  if (!SAFE_PART.test(value)) throw new TypeError(`${label} contains unsafe characters`)
  return value
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, ms))
}

export class HarmonyDeviceController {
  readonly #client: HdcClientLike
  readonly #options: Required<HarmonyDeviceControllerOptions>
  readonly #frames = new Map<string, HarmonyFrame>()
  #sequence = 0

  constructor(client: HdcClientLike, options: HarmonyDeviceControllerOptions) {
    this.#client = client
    this.#options = {
      ...options,
      idFactory: options.idFactory ?? (() => crypto.randomUUID()),
      settleMs: options.settleMs ?? 300,
    }
  }

  latestFrame(device: string): HarmonyFrame | undefined {
    return this.#frames.get(device)
  }

  async capture(device: string): Promise<HarmonyFrame> {
    safePart(device, 'device id')
    const artifactId = safePart(this.#options.idFactory(), 'artifact id')
    const sequence = ++this.#sequence
    const remotePath = `${REMOTE_ROOT}/dsh-harmony-${artifactId}.png`
    const directory = join(this.#options.cacheDir, 'screenshots', device)
    const localPath = join(directory, `frame-${sequence}.png`)
    await mkdir(directory, { recursive: true })
    try {
      await this.#client.exec(device, ['shell', 'uitest', 'screenCap', '-p', remotePath])
      await this.#client.exec(device, ['file', 'recv', remotePath, localPath])
      const buffer = await readFile(localPath)
      const size = dimensions(buffer)
      const frame: HarmonyFrame = {
        id: `frame-${sequence}`,
        sequence,
        device,
        path: localPath,
        bytes: buffer.length,
        width: size.width,
        height: size.height,
        orientation: size.width > size.height ? 'landscape' : 'portrait',
        capturedAt: Date.now(),
      }
      this.#frames.set(device, frame)
      return frame
    } finally {
      await this.#client.exec(device, ['shell', 'rm', '-f', remotePath]).catch(() => {})
    }
  }

  async interact(
    device: string,
    action: HarmonyUiAction,
  ): Promise<{ action: HarmonyUiAction['action']; frame: HarmonyFrame }> {
    const current = this.#frames.get(device)
    if (current === undefined) throw new Error('Capture a current frame before interacting with the device')
    const command = buildUiInputCommand(action, current)
    await this.#client.exec(device, command)
    await sleep(this.#options.settleMs)
    return { action: action.action, frame: await this.capture(device) }
  }

  async uiTree(
    device: string,
    options: { maxDepth?: number; maxNodes?: number } = {},
  ): Promise<{ nodes: HarmonyUiNode[]; truncated: boolean }> {
    safePart(device, 'device id')
    const artifactId = safePart(this.#options.idFactory(), 'artifact id')
    const remotePath = `${REMOTE_ROOT}/dsh-harmony-${artifactId}.json`
    const directory = join(this.#options.cacheDir, 'trees', device)
    const localPath = join(directory, `${artifactId}.json`)
    await mkdir(directory, { recursive: true })
    try {
      await this.#client.exec(device, ['shell', 'uitest', 'dumpLayout', '-p', remotePath])
      await this.#client.exec(device, ['file', 'recv', remotePath, localPath])
      const raw = JSON.parse(await readFile(localPath, 'utf8')) as unknown
      return flattenUiTree(raw, options)
    } finally {
      await this.#client.exec(device, ['shell', 'rm', '-f', remotePath]).catch(() => {})
      await rm(localPath, { force: true })
    }
  }
}
