import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarmonyDeviceController, type HarmonyFrame } from './device-controller.ts'
import { HarmonyHdcClient } from './hdc.ts'
import {
  boundedLogText,
  buildHarmonyProject,
  collectLogSnapshots,
  hilogCommand,
  installCommand,
  launchCommands,
  parseBundleList,
  validateName,
  type HarmonyBuildArgs,
} from './lifecycle.ts'
import type { HarmonyToolName } from './contracts.ts'
import { assertTappable, extractUiRows, findUniqueNode, type HarmonyUiNode, type HarmonyUiRow } from './ui-tree.ts'
import type { HarmonyUiAction } from './ui-actions.ts'
import { recognizeImage } from './ocr.ts'

export interface OcrItem {
  text: string
  confidence: number
  rect: { x: number; y: number; width: number; height: number }
}

interface HdcLike {
  inventory(): Promise<{
    hdcVersion?: string
    devices: Array<{ id: string; transport?: string; state?: string; name?: string; daemon?: string }>
  }>
  exec(device: string | undefined, args: readonly string[], options?: Record<string, unknown>): Promise<{ stdout: string; stderr?: string }>
}

interface ControllerLike {
  latestFrame(device: string): HarmonyFrame | undefined
  capture(device: string): Promise<HarmonyFrame>
  interact(device: string, action: HarmonyUiAction): Promise<{ action: string; frame: HarmonyFrame }>
  uiTree(device: string, options?: { maxDepth?: number; maxNodes?: number }): Promise<{ nodes: HarmonyUiNode[]; truncated: boolean }>
}

export interface HarmonyRuntimeOptions {
  client?: HdcLike
  controller?: ControllerLike
  build?: (args: HarmonyBuildArgs) => Promise<Record<string, unknown>>
  ocr?: (path: string) => Promise<OcrItem[]>
  cacheDir?: string
}

function stringArg(args: Record<string, unknown>, name: string, required = false): string | undefined {
  const value = args[name]
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`)
  return value
}

function numberArg(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
  return value
}

function booleanArg(args: Record<string, unknown>, name: string, fallback = false): boolean {
  const value = args[name]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`)
  return value
}

function frameResult(frame: HarmonyFrame): Record<string, unknown> {
  return {
    frameId: frame.id,
    sequence: frame.sequence,
    device: frame.device,
    path: frame.path,
    bytes: frame.bytes,
    width: frame.width,
    height: frame.height,
    orientation: frame.orientation,
    capturedAt: frame.capturedAt,
  }
}

function hasCommand(output: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'u').test(output)
}

function parseVersion(output: string): string | undefined {
  return output.match(/\b\d+\.\d+\.\d+\.\d+\b/u)?.[0]
}

function parseProcesses(output: string): Array<{ pid: number; name: string }> {
  const processes: Array<{ pid: number; name: string }> = []
  const lines = output.split(/\r?\n/u)
  const header = lines[0]?.trim().split(/\s+/u) ?? []
  const pidColumn = header.findIndex(field => field.toLocaleUpperCase() === 'PID')
  for (const line of lines.slice(1)) {
    const fields = line.trim().split(/\s+/u)
    const pidIndex = pidColumn >= 0 ? pidColumn : fields.findIndex(field => /^\d+$/u.test(field))
    if (pidIndex < 0 || fields.length < 2) continue
    const pid = Number(fields[pidIndex])
    const name = fields.at(-1) ?? ''
    if (Number.isSafeInteger(pid) && name !== '') processes.push({ pid, name })
  }
  return processes
}

interface HarmonyRowsResult {
  device: string
  rows: HarmonyUiRow[]
  count: number
  truncated: boolean
}

function filterOcr(items: readonly OcrItem[], query?: string, minimum = 0.3): OcrItem[] {
  const needle = query?.toLocaleLowerCase()
  return items
    .filter(item => item.confidence >= minimum && (needle === undefined || item.text.toLocaleLowerCase().includes(needle)))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 200)
}

function oneOcr(items: readonly OcrItem[], query: string): OcrItem {
  const exact = items.filter(item => item.text === query)
  const matches = exact.length > 0 ? exact : filterOcr(items, query, 0)
  if (matches.length === 0) throw new Error(`OCR text ${JSON.stringify(query)} was not found`)
  if (matches.length > 1) throw new Error(`OCR text ${JSON.stringify(query)} is ambiguous (${matches.length} matches)`)
  return matches[0]
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class HarmonyRuntime {
  readonly #client: HdcLike
  readonly #controller: ControllerLike
  readonly #build: (args: HarmonyBuildArgs) => Promise<Record<string, unknown>>
  readonly #ocr?: (path: string) => Promise<OcrItem[]>

  constructor(options: HarmonyRuntimeOptions = {}) {
    const client = options.client ?? new HarmonyHdcClient()
    this.#client = client
    this.#controller = options.controller ?? new HarmonyDeviceController(client as HarmonyHdcClient, {
      cacheDir: options.cacheDir ?? join(tmpdir(), 'dsh-harmony'),
    })
    this.#build = options.build ?? buildHarmonyProject
    this.#ocr = options.ocr ?? (process.platform === 'darwin' ? recognizeImage : undefined)
  }

  latestFrame(device: string): HarmonyFrame | undefined {
    return this.#controller.latestFrame(device)
  }

  async execute(name: HarmonyToolName, args: Record<string, unknown>): Promise<any> {
    switch (name) {
      case 'harmony_devices': return this.#devices()
      case 'harmony_capabilities': return this.#capabilities(args)
      case 'harmony_build': return this.#build(args as unknown as HarmonyBuildArgs)
      case 'harmony_install': return this.#install(args)
      case 'harmony_launch': return this.#launch(args)
      case 'harmony_list_apps': return this.#listApps(args)
      case 'harmony_screenshot': return this.#screenshot(args)
      case 'harmony_interact': return this.#interact(args)
      case 'harmony_logs': return this.#logs(args)
      case 'harmony_find_text': return this.#findText(args)
      case 'harmony_tap_text': return this.#tapText(args)
      case 'harmony_wait_for': return this.#waitFor(args)
      case 'harmony_ui_tree': return this.#uiTree(args)
      case 'harmony_tap_element': return this.#tapElement(args)
      case 'harmony_ui_rows': return this.#uiRows(args)
      case 'harmony_tap_row': return this.#tapRow(args)
      case 'harmony_app_info': return this.#appInfo(args)
      case 'harmony_processes': return this.#processes(args)
      default: throw new Error(`Unknown Harmony tool ${String(name)}`)
    }
  }

  async #devices(): Promise<Record<string, unknown>> {
    const inventory = await this.#client.inventory()
    const ready = inventory.devices
      .filter(device => device.transport === 'USB' && device.state === 'Connected')
      .map(device => device.id)
    return { ...inventory, count: inventory.devices.length, ready }
  }

  async #capabilities(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = stringArg(args, 'device')
    const inventory = await this.#client.inventory()
    const versionOutput = await this.#client.exec(device, ['shell', 'uitest', '--version'])
    const version = parseVersion(versionOutput.stdout)
    const help = await this.#client.exec(device, ['shell', 'uitest', 'help'])
    const input = await this.#client.exec(device, ['shell', 'uitest', 'uiInput', 'help'])
    const commands = Object.fromEntries([
      'screenCap', 'dumpLayout', 'uiInput', 'click', 'swipe', 'drag', 'inputText', 'text', 'keyEvent',
    ].map(command => [command, hasCommand(`${help.stdout}\n${input.stdout}`, command)]))
    return {
      hdcVersion: inventory.hdcVersion,
      device: device ?? inventory.devices.find(item => item.transport === 'USB' && item.state === 'Connected')?.id,
      uiTest: { available: version !== undefined, version, commands },
      ocr: { available: this.#ocr !== undefined, backend: this.#ocr === undefined ? undefined : 'local' },
    }
  }

  async #install(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = stringArg(args, 'device')
    const hapPath = stringArg(args, 'hapPath', true)!
    const result = await this.#client.exec(device, installCommand(hapPath, booleanArg(args, 'replace')))
    return { device, hapPath, replaced: booleanArg(args, 'replace'), output: result.stdout.trim() }
  }

  async #launch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = stringArg(args, 'device')
    const bundle = stringArg(args, 'bundle', true)!
    const ability = stringArg(args, 'ability', true)!
    for (const command of launchCommands(bundle, ability, booleanArg(args, 'relaunch'))) {
      await this.#client.exec(device, command)
    }
    return { device, bundle, ability, launched: true }
  }

  async #listApps(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = stringArg(args, 'device')
    const result = await this.#client.exec(device, ['shell', 'bm', 'dump', '-a'])
    const query = stringArg(args, 'query')?.toLocaleLowerCase()
    const apps = parseBundleList(result.stdout)
      .filter(bundle => query === undefined || bundle.toLocaleLowerCase().includes(query))
      .slice(0, 1000)
    return { device, apps, count: apps.length }
  }

  async #screenshot(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    return frameResult(await this.#controller.capture(device))
  }

  async #interact(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    const result = await this.#controller.interact(device, args as unknown as HarmonyUiAction)
    return { action: result.action, frame: frameResult(result.frame) }
  }

  async #logs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = stringArg(args, 'device')
    const mode = args.mode ?? 'snapshot'
    if (mode !== 'snapshot' && mode !== 'follow') throw new TypeError('mode must be snapshot or follow')
    let pid = numberArg(args, 'pid')
    const bundle = stringArg(args, 'bundle')
    if (bundle !== undefined) {
      validateName(bundle, 'bundle')
      if (pid === undefined) {
        const found = await this.#client.exec(device, ['shell', 'pidof', bundle])
        pid = Number(found.stdout.trim().split(/\s+/u)[0])
        if (!Number.isSafeInteger(pid) || pid! < 1) throw new Error(`bundle ${bundle} is not running`)
      }
    }
    const read = async (): Promise<string> => (await this.#client.exec(device, hilogCommand({ pid }))).stdout
    const durationSeconds = numberArg(args, 'durationSeconds') ?? 10
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) {
      throw new RangeError('durationSeconds must be between 1 and 60')
    }
    const source = mode === 'follow'
      ? await collectLogSnapshots(read, { durationMs: durationSeconds * 1000 })
      : await read()
    const grep = stringArg(args, 'grep')
    const filtered = grep === undefined
      ? source
      : source.split(/\r?\n/u).filter(line => line.toLocaleLowerCase().includes(grep.toLocaleLowerCase())).join('\n')
    const bounded = boundedLogText(filtered)
    return { device, mode, ...(bundle === undefined ? {} : { bundle }), ...(pid === undefined ? {} : { pid }), ...bounded }
  }

  async #uiTree(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    const maxDepth = numberArg(args, 'maxDepth')
    const tree = await this.#controller.uiTree(device, maxDepth === undefined ? {} : { maxDepth })
    const filter = stringArg(args, 'filter')?.toLocaleLowerCase()
    const nodes = filter === undefined ? tree.nodes : tree.nodes.filter(node => (
      [node.id, node.accessibilityId, node.key, node.text, node.description, node.hint]
        .some(value => value?.toLocaleLowerCase().includes(filter) === true)
    ))
    return { device, nodes: nodes.slice(0, 1000), truncated: tree.truncated || nodes.length > 1000 }
  }

  async #tapElement(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    const frame = this.#requireFrame(device, stringArg(args, 'frameId', true)!)
    const tree = await this.#controller.uiTree(device)
    const node = findUniqueNode(tree.nodes, {
      resourceId: stringArg(args, 'resourceId'),
      text: stringArg(args, 'text'),
    })
    assertTappable(node)
    const result = await this.#controller.interact(device, {
      action: 'tap',
      frameId: frame.id,
      x: (node.bounds.x + node.bounds.width / 2) / frame.width,
      y: (node.bounds.y + node.bounds.height / 2) / frame.height,
    })
    return { matched: node, frame: frameResult(result.frame) }
  }

  async #uiRows(args: Record<string, unknown>): Promise<HarmonyRowsResult> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    const maxDepth = numberArg(args, 'maxDepth')
    const tree = await this.#controller.uiTree(device, maxDepth === undefined ? {} : { maxDepth })
    const rows = extractUiRows(tree.nodes)
    return { device, rows, count: rows.length, truncated: tree.truncated }
  }

  async #tapRow(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    const frame = this.#requireFrame(device, stringArg(args, 'frameId', true)!)
    const rows = await this.#uiRows({ device })
    const index = numberArg(args, 'index')
    if (!Number.isSafeInteger(index) || index! < 0 || index! >= rows.rows.length) throw new RangeError('row index is out of range')
    const row = rows.rows[index!]
    const x = numberArg(args, 'x') ?? 0.5
    const y = numberArg(args, 'y') ?? 0.5
    if (x < 0 || x > 1 || y < 0 || y > 1) throw new RangeError('row coordinates must be normalized')
    const result = await this.#controller.interact(device, {
      action: 'tap', frameId: frame.id,
      x: (row.bounds.x + row.bounds.width * x) / frame.width,
      y: (row.bounds.y + row.bounds.height * y) / frame.height,
    })
    return { row, frame: frameResult(result.frame) }
  }

  async #findText(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    const frame = await this.#controller.capture(device)
    const items = filterOcr(await this.#recognize(frame), stringArg(args, 'query'), numberArg(args, 'minConfidence') ?? 0.3)
    return { device, frameId: frame.id, width: frame.width, height: frame.height, items }
  }

  async #tapText(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    const frame = this.#requireFrame(device, stringArg(args, 'frameId', true)!)
    const query = stringArg(args, 'query', true)!
    const item = oneOcr(await this.#recognize(frame), query)
    const result = await this.#controller.interact(device, {
      action: 'tap', frameId: frame.id,
      x: (item.rect.x + item.rect.width / 2) / frame.width,
      y: (item.rect.y + item.rect.height / 2) / frame.height,
    })
    return { matched: item, frame: frameResult(result.frame) }
  }

  async #waitFor(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = await this.#resolveDevice(stringArg(args, 'device'))
    const text = stringArg(args, 'text', true)!
    const mode = args.mode === 'disappear' ? 'disappear' : 'appear'
    const timeoutMs = Math.min(60_000, Math.max(100, numberArg(args, 'timeoutMs') ?? 8_000))
    const deadline = Date.now() + timeoutMs
    do {
      const frame = await this.#controller.capture(device)
      const visible = filterOcr(await this.#recognize(frame), text, 0.3).length > 0
      if ((mode === 'appear' && visible) || (mode === 'disappear' && !visible)) {
        return { device, text, mode, matched: true, frameId: frame.id }
      }
      if (Date.now() >= deadline) break
      await sleep(Math.min(600, Math.max(0, deadline - Date.now())))
    } while (Date.now() <= deadline)
    return { device, text, mode, matched: false }
  }

  async #appInfo(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = stringArg(args, 'device')
    const bundle = validateName(stringArg(args, 'bundle', true)!, 'bundle')
    const result = await this.#client.exec(device, ['shell', 'bm', 'dump', '-n', bundle])
    return { device, bundle, info: boundedLogText(result.stdout, { maxLines: 200, maxBytes: 30 * 1024 }).text }
  }

  async #processes(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const device = stringArg(args, 'device')
    const result = await this.#client.exec(device, ['shell', 'ps', '-ef'])
    const filter = stringArg(args, 'filter')?.toLocaleLowerCase()
    const processes = parseProcesses(result.stdout)
      .filter(process => filter === undefined || process.name.toLocaleLowerCase().includes(filter))
      .slice(0, 1000)
    return { device, processes, count: processes.length }
  }

  async #resolveDevice(reference?: string): Promise<string> {
    if (reference !== undefined) return reference
    const ready = (await this.#client.inventory()).devices
      .filter(device => device.transport === 'USB' && device.state === 'Connected')
    if (ready.length !== 1) throw new Error('device is required when zero or multiple USB devices are connected')
    return ready[0].id
  }

  #requireFrame(device: string, frameId: string): HarmonyFrame {
    const frame = this.#controller.latestFrame(device)
    if (frame === undefined || frame.id !== frameId) throw new Error('Refusing action for a stale frame')
    return frame
  }

  async #recognize(frame: HarmonyFrame): Promise<OcrItem[]> {
    if (this.#ocr === undefined) throw new Error('OCR is unavailable on this host')
    return this.#ocr(frame.path)
  }
}
