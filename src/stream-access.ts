import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const TOKEN_TTL_MS = 10 * 60_000
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u

export interface AccessPayload {
  v: 1
  kind: string
  device: string
  session: string
  exp: number
  path?: string
  action?: string
}

interface RequestLike {
  socket?: { remoteAddress?: string }
  headers: Record<string, string | string[] | undefined>
}

function stateRoot(): string {
  const home = process.env.DSH_HOME?.trim()
  return join(home === undefined || home === '' ? join(homedir(), '.dsh') : resolve(home), 'cache', 'dsh-harmony')
}

async function persistentKey(): Promise<Buffer> {
  const root = stateRoot()
  const path = join(root, 'stream-access.key')
  await mkdir(root, { recursive: true, mode: 0o700 })
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('stream key is not a regular file')
    const key = await readFile(path)
    if (key.length !== 32) throw new Error('stream key has an invalid length')
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const key = randomBytes(32)
  try {
    await writeFile(path, key, { flag: 'wx', mode: 0o600 })
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return readFile(path)
  }
}

function mac(key: Buffer, encoded: string): Buffer {
  return createHmac('sha256', key).update(encoded).digest()
}

export class StreamAccessController {
  readonly #key: () => Promise<Buffer>
  readonly #now: () => number

  constructor(options: { key?: () => Promise<Buffer>; now?: () => number } = {}) {
    this.#key = options.key ?? persistentKey
    this.#now = options.now ?? Date.now
  }

  async sign(
    payload: Omit<AccessPayload, 'v' | 'exp'>,
    ttlMs = TOKEN_TTL_MS,
  ): Promise<{ token: string; expiresAt: number }> {
    if (!/^device-[a-f0-9]{12}$/u.test(payload.device)) throw new TypeError('invalid redacted device id')
    if (payload.session === '' || payload.kind === '') throw new TypeError('capability scope is required')
    const expiresAt = this.#now() + Math.min(TOKEN_TTL_MS, Math.max(1, Math.floor(ttlMs)))
    const value: AccessPayload = { v: 1, ...payload, exp: expiresAt }
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url')
    return { token: `${encoded}.${mac(await this.#key(), encoded).toString('base64url')}`, expiresAt }
  }

  async verify(token: string, expectedKind: string): Promise<AccessPayload | undefined> {
    if (token.length > 16 * 1024 || !TOKEN.test(token)) return undefined
    const [encoded, signature] = token.split('.')
    if (encoded === undefined || signature === undefined) return undefined
    const expected = mac(await this.#key(), encoded)
    const supplied = Buffer.from(signature, 'base64url')
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return undefined
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<AccessPayload>
      if (payload.v !== 1 || payload.kind !== expectedKind
        || typeof payload.device !== 'string' || !/^device-[a-f0-9]{12}$/u.test(payload.device)
        || typeof payload.session !== 'string' || payload.session === ''
        || typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp)
        || payload.exp <= this.#now() || payload.exp - this.#now() > TOKEN_TTL_MS) return undefined
      return payload as AccessPayload
    } catch {
      return undefined
    }
  }
}

function ipv4Loopback(address: string): boolean {
  const fields = address.split('.')
  return fields.length === 4 && fields[0] === '127'
    && fields.every(field => /^\d{1,3}$/u.test(field) && Number(field) <= 255)
}

export function isLoopbackAddress(address?: string): boolean {
  if (address === undefined) return false
  const value = address.toLocaleLowerCase().split('%')[0]
  if (value === '::1' || ipv4Loopback(value)) return true
  return value.startsWith('::ffff:') && ipv4Loopback(value.slice(7))
}

function authority(request: RequestLike): URL | undefined {
  const host = request.headers.host
  if (typeof host !== 'string') return undefined
  try {
    const parsed = new URL(`http://${host}`)
    if (parsed.pathname !== '/' || parsed.username !== '' || parsed.password !== '') return undefined
    return parsed
  } catch {
    return undefined
  }
}

function loopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || ipv4Loopback(hostname)
}

export function isTrustedRequest(request: RequestLike, requireOrigin: boolean): boolean {
  if (!isLoopbackAddress(request.socket?.remoteAddress)) return false
  const host = authority(request)
  if (host === undefined || !loopbackHost(host.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return !requireOrigin
  if (typeof origin !== 'string') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host.host
  } catch {
    return false
  }
}

export async function openContainedFile(root: string, path: string): Promise<Buffer | undefined> {
  if (!isAbsolute(root) || !isAbsolute(path)) return undefined
  const relativePath = relative(root, path)
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return undefined
  let current = root
  const parts = relativePath.split(sep)
  for (const [index, part] of parts.entries()) {
    if (part === '' || part === '.' || part === '..') return undefined
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch {
      return undefined
    }
    if (info.isSymbolicLink()) return undefined
    if (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()) return undefined
  }
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path)])
  const realRelative = relative(realRoot, realFile)
  if (realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) return undefined
  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
  const handle = await open(path, fsConstants.O_RDONLY | noFollow).catch(() => undefined)
  if (handle === undefined) return undefined
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size < 1 || info.size > 32 * 1024 * 1024) return undefined
    return handle.readFile()
  } finally {
    await handle.close().catch(() => {})
  }
}
