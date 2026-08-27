import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OcrItem } from './runtime.ts'

const MAX_OUTPUT = 8 * 1024 * 1024
let compilePromise: Promise<string> | undefined

function sourcePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'ocr.swift')
}

async function executable(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isFile() && (info.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function exec(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; acceptUsageExit?: boolean },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {
      timeout: options.timeoutMs,
      maxBuffer: MAX_OUTPUT,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      if (error !== null && !(options.acceptUsageExit === true && error.code === 2)) {
        reject(new Error(`OCR process failed${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}`))
        return
      }
      resolve(stdout)
    })
  })
}

export function parseOcrJson(output: string): OcrItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error('Vision OCR returned non-JSON output')
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new Error('Vision OCR returned an invalid payload')
  }
  const seen = new Set<string>()
  const items: OcrItem[] = []
  for (const entry of (parsed as { items: unknown[] }).items) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    const numbers = [item.confidence, item.x, item.y, item.w, item.h]
    if (text === '' || !numbers.every(value => typeof value === 'number' && Number.isFinite(value))) continue
    const [confidence, x, y, width, height] = numbers as number[]
    if (confidence < 0 || confidence > 1 || x < 0 || y < 0 || width < 0 || height < 0) continue
    const key = JSON.stringify([text, x, y, width, height])
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ text, confidence, rect: { x, y, width, height } })
  }
  return items.sort((left, right) => right.confidence - left.confidence)
}

async function compileOcr(): Promise<string> {
  if (process.platform !== 'darwin') throw new Error('Vision OCR requires a macOS host')
  const source = sourcePath()
  const sourceBytes = await readFile(source)
  const digest = createHash('sha256').update(sourceBytes).digest('hex').slice(0, 16)
  const root = process.env.DSH_HARMONY_OCR_DIR?.trim()
    || join(homedir(), 'Library', 'Caches', 'dsh-harmony', 'ocr')
  const directory = join(root, digest)
  const binary = join(directory, 'ocr')
  if (await executable(binary)) return binary
  const swiftc = process.env.DSH_HARMONY_SWIFTC?.trim() || '/usr/bin/swiftc'
  if (!(await executable(swiftc))) throw new Error('swiftc is unavailable; install Xcode Command Line Tools')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.ocr-${process.pid}-${Date.now()}.tmp`)
  try {
    await exec(swiftc, ['-O', source, '-o', temporary], { timeoutMs: 5 * 60_000 })
    await exec(temporary, [], { timeoutMs: 60_000, acceptUsageExit: true })
    await rename(temporary, binary)
    return binary
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function ensureOcrBinary(): Promise<string> {
  compilePromise ??= compileOcr().finally(() => {
    compilePromise = undefined
  })
  return compilePromise
}

export async function recognizeImage(path: string): Promise<OcrItem[]> {
  const binary = await ensureOcrBinary()
  return parseOcrJson(await exec(binary, [path], { timeoutMs: 120_000 }))
}
