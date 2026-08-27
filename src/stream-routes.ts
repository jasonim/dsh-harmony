import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isTrustedRequest, openContainedFile, StreamAccessController } from './stream-access.ts'
import type { HarmonyToolName } from './contracts.ts'

export const ROUTE_PREFIX = '/_dsh/dsh-harmony'
export const GRANT_PATH = `${ROUTE_PREFIX}/grant`
export const FRAME_PREFIX = `${ROUTE_PREFIX}/frame`
export const CAPTURE_PREFIX = `${ROUTE_PREFIX}/capture`
export const CONTROL_PREFIX = `${ROUTE_PREFIX}/control`

interface RuntimeLike {
  execute(name: HarmonyToolName, args: Record<string, unknown>): Promise<any>
  latestFrame(device: string): { path: string; [key: string]: unknown } | undefined
}

interface RouteCarrier {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(request: IncomingMessage, response: ServerResponse): unknown
  }): () => void
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  })
  response.end(bytes)
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') throw new RouteError(405, 'POST required')
  if (!(request.headers['content-type'] ?? '').toString().toLocaleLowerCase().startsWith('application/json')) {
    throw new RouteError(415, 'application/json required')
  }
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 64 * 1024) throw new RouteError(413, 'request body is too large')
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new RouteError(400, 'invalid JSON object')
  }
}

class RouteError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function tokenFrom(request: IncomingMessage, prefix: string): string {
  const pathname = new URL(request.url ?? '/', 'http://local').pathname
  const token = pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length + 1) : ''
  if (token === '' || token.includes('/')) throw new RouteError(400, 'capability token is required')
  return token
}

export class HarmonyStreamRoutes {
  readonly #runtime: RuntimeLike
  readonly #access: StreamAccessController
  readonly #screenshotRoot: string

  constructor(
    runtime: RuntimeLike,
    access = new StreamAccessController(),
    options: { screenshotRoot?: string } = {},
  ) {
    this.#runtime = runtime
    this.#access = access
    this.#screenshotRoot = options.screenshotRoot ?? join(tmpdir(), 'dsh-harmony', 'screenshots')
  }

  async grant(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      this.#trusted(request, true)
      const input = await body(request)
      const device = input.device
      const session = input.session
      if (typeof device !== 'string' || !/^device-[a-f0-9]{12}$/u.test(device)) throw new RouteError(400, 'invalid device')
      if (typeof session !== 'string' || session === '' || session.length > 256) throw new RouteError(400, 'invalid session')
      const devices = await this.#runtime.execute('harmony_devices', {})
      if (!Array.isArray(devices.ready) || !devices.ready.includes(device)) throw new RouteError(409, 'device is not USB and Connected')
      const frame = await this.#access.sign({ kind: 'frame', device, session })
      const control = await this.#access.sign({ kind: 'control', device, session })
      json(response, 200, {
        ok: true,
        device,
        expiresAt: Math.min(frame.expiresAt, control.expiresAt),
        frameUrl: `${FRAME_PREFIX}/${frame.token}`,
        captureUrl: `${CAPTURE_PREFIX}/${frame.token}`,
        controlUrl: `${CONTROL_PREFIX}/${control.token}`,
      })
    } catch (error) {
      this.#error(response, error)
    }
  }

  async frame(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      this.#trusted(request, false)
      if (request.method !== 'GET') throw new RouteError(405, 'GET required')
      const payload = await this.#access.verify(tokenFrom(request, FRAME_PREFIX), 'frame')
      if (payload === undefined) throw new RouteError(401, 'invalid or expired capability')
      const frame = this.#runtime.latestFrame(payload.device)
      if (frame === undefined) throw new RouteError(404, 'no frame captured')
      const bytes = await openContainedFile(this.#screenshotRoot, frame.path)
      if (bytes === undefined) throw new RouteError(404, 'frame is unavailable')
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(bytes.length),
        'cache-control': 'no-store, max-age=0',
        'x-content-type-options': 'nosniff',
      })
      response.end(bytes)
    } catch (error) {
      this.#error(response, error)
    }
  }

  async capture(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      this.#trusted(request, true)
      const payload = await this.#access.verify(tokenFrom(request, CAPTURE_PREFIX), 'frame')
      if (payload === undefined) throw new RouteError(401, 'invalid or expired capability')
      await body(request)
      const frame = await this.#runtime.execute('harmony_screenshot', { device: payload.device })
      json(response, 200, { ok: true, frame })
    } catch (error) {
      this.#error(response, error)
    }
  }

  async control(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      this.#trusted(request, true)
      const payload = await this.#access.verify(tokenFrom(request, CONTROL_PREFIX), 'control')
      if (payload === undefined) throw new RouteError(401, 'invalid or expired capability')
      const input = await body(request)
      const result = await this.#runtime.execute('harmony_interact', { ...input, device: payload.device })
      json(response, 200, { ok: true, result })
    } catch (error) {
      this.#error(response, error)
    }
  }

  #trusted(request: IncomingMessage, origin: boolean): void {
    if (!isTrustedRequest(request, origin)) throw new RouteError(403, 'trusted loopback request required')
  }

  #error(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.destroy()
      return
    }
    const status = error instanceof RouteError ? error.status : 500
    json(response, status, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

export function mountStreamRoutes(carrier: RouteCarrier, routes: HarmonyStreamRoutes): () => void {
  const disposers = [
    carrier.register({ kind: 'exact', path: GRANT_PATH, handler: (request, response) => routes.grant(request, response) }),
    carrier.register({ kind: 'prefix', path: FRAME_PREFIX, handler: (request, response) => routes.frame(request, response) }),
    carrier.register({ kind: 'prefix', path: CAPTURE_PREFIX, handler: (request, response) => routes.capture(request, response) }),
    carrier.register({ kind: 'prefix', path: CONTROL_PREFIX, handler: (request, response) => routes.control(request, response) }),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export function installStreamRoutes(ctx: Context, runtime: RuntimeLike): void {
  ctx.inject(['webServer'], webContext => webContext.effect(() => {
    const carrier = (webContext as Context & { webServer: RouteCarrier }).webServer
    return mountStreamRoutes(carrier, new HarmonyStreamRoutes(runtime))
  }, 'dsh-harmony: stream routes'))
}
