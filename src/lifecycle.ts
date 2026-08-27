import { spawn } from 'node:child_process'
import { access, lstat, readdir, realpath } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u
const IGNORED_DIRECTORIES = new Set(['node_modules', 'oh_modules', '.git', '.hvigor', '.idea'])

export interface HarmonyBuildArgs {
  projectPath: string
  module?: string
  product?: string
  target?: string
  mode?: 'debug' | 'release'
}

export interface HostProcessResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

export function validateName(value: string, label: string): string {
  if (!NAME.test(value)) throw new TypeError(`invalid ${label}`)
  return value
}

export function hvigorArguments(options: Omit<HarmonyBuildArgs, 'projectPath'>): string[] {
  const module = validateName(options.module ?? 'entry', 'module')
  const product = validateName(options.product ?? 'default', 'product')
  const mode = options.mode ?? 'debug'
  const args = [
    'assembleHap',
    '--mode', 'module',
    '-p', `module=${module}@${product}`,
    '-p', `product=${product}`,
  ]
  if (options.target !== undefined) args.push('-p', `target=${validateName(options.target, 'target')}`)
  if (mode === 'release') args.push('-p', 'buildMode=release')
  args.push('--no-daemon', '--no-parallel')
  return args
}

export async function findBuiltHap(projectPath: string): Promise<string> {
  const root = await realpath(projectPath)
  const found: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 10 || found.length > 1) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(path, depth + 1)
      } else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.hap')) {
        found.push(path)
      }
    }
  }
  await visit(root, 0)
  if (found.length === 0) throw new Error('Hvigor completed but no HAP was found')
  if (found.length > 1) throw new Error(`Hvigor produced multiple HAP files; select a module (${found.length} found)`)
  return found[0]
}

export function parseBundleList(output: string): string[] {
  const bundles = new Set<string>()
  for (const line of output.split(/\r?\n/u)) {
    const value = line.trim()
    if (value !== '' && !value.startsWith('ID:') && NAME.test(value)) bundles.add(value)
  }
  return [...bundles]
}

export function installCommand(hapPath: string, replaceExisting: boolean): string[] {
  if (!isAbsolute(hapPath) || !hapPath.toLocaleLowerCase().endsWith('.hap') || hapPath.includes('\0')) {
    throw new TypeError('invalid HAP path')
  }
  return replaceExisting ? ['app', 'install', '-r', hapPath] : ['app', 'install', hapPath]
}

export function launchCommands(bundle: string, ability: string, relaunch: boolean): string[][] {
  validateName(bundle, 'bundle')
  validateName(ability, 'ability')
  return [
    ...(relaunch ? [['shell', 'aa', 'force-stop', bundle]] : []),
    ['shell', 'aa', 'start', '-b', bundle, '-a', ability],
  ]
}

export function boundedLogText(
  source: string,
  options: { maxLines?: number; maxBytes?: number } = {},
): { text: string; lines: string[]; truncated: boolean } {
  const maxLines = options.maxLines ?? 300
  const maxBytes = options.maxBytes ?? 30 * 1024
  const sourceLines = source.split(/\r?\n/u)
  const lines: string[] = []
  let bytes = 0
  for (const line of sourceLines) {
    if (lines.length >= maxLines) break
    const lineBytes = Buffer.byteLength(`${line}${lines.length === 0 ? '' : '\n'}`)
    if (bytes + lineBytes > maxBytes) break
    lines.push(line)
    bytes += lineBytes
  }
  return {
    text: lines.join('\n'),
    lines,
    truncated: lines.length < sourceLines.length,
  }
}

export function hilogCommand(options: { pid?: number } = {}): string[] {
  const command = ['shell', 'hilog', '-x', '-z', '300']
  if (options.pid !== undefined) {
    if (!Number.isSafeInteger(options.pid) || options.pid < 1) throw new TypeError('pid must be a positive integer')
    command.push('-P', String(options.pid))
  }
  return command
}

export async function collectLogSnapshots(
  read: () => Promise<string>,
  options: {
    durationMs: number
    pollMs?: number
    now?: () => number
    pause?: (ms: number) => Promise<void>
  },
): Promise<string> {
  const pollMs = options.pollMs ?? 1000
  if (!Number.isFinite(options.durationMs) || options.durationMs < 0 || options.durationMs > 60_000) {
    throw new RangeError('durationMs must be between 0 and 60000')
  }
  if (!Number.isFinite(pollMs) || pollMs < 50 || pollMs > 10_000) {
    throw new RangeError('pollMs must be between 50 and 10000')
  }
  const now = options.now ?? Date.now
  const pause = options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = now() + options.durationMs
  const lines: string[] = []
  const seen = new Set<string>()
  do {
    for (const line of (await read()).split(/\r?\n/u)) {
      if (line !== '' && !seen.has(line)) {
        seen.add(line)
        lines.push(line)
      }
    }
    const remaining = deadline - now()
    if (remaining <= 0) break
    await pause(Math.min(pollMs, remaining))
  } while (now() <= deadline)
  return lines.join('\n')
}

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK)
    return (await lstat(path)).isFile()
  } catch {
    return false
  }
}

export async function resolveHvigor(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const explicit = env.HARMONY_HVIGOR?.trim()
  if (explicit !== undefined && explicit !== '') {
    if (await executable(explicit)) return explicit
    throw new Error('HARMONY_HVIGOR is not executable')
  }
  const candidates = [
    '/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw',
    ...(env.DEVECO_SDK_HOME === undefined
      ? []
      : [join(resolve(env.DEVECO_SDK_HOME), '..', 'tools', 'hvigor', 'bin', 'hvigorw')]),
  ]
  for (const candidate of candidates) if (await executable(candidate)) return candidate
  return 'hvigorw'
}

export function hostProcessEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath,
): NodeJS.ProcessEnv {
  const configured = env.NODE_HOME?.trim()
  return {
    ...env,
    NODE_HOME: configured === undefined || configured === '' ? dirname(dirname(execPath)) : configured,
  }
}

export function runHostProcess(
  command: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs?: number; maxBytes?: number },
): Promise<HostProcessResult> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: hostProcessEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGKILL')
      reject(error)
    }
    const append = (target: Buffer[]) => (chunk: Buffer): void => {
      bytes += chunk.length
      if (bytes > maxBytes) fail(new Error(`Host process output exceeded ${maxBytes} bytes`))
      else target.push(chunk)
    }
    child.stdout.on('data', append(stdout))
    child.stderr.on('data', append(stderr))
    child.on('error', error => fail(error))
    child.on('close', exitCode => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveResult({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
      })
    })
    const timer = setTimeout(() => fail(new Error(`Host process timed out after ${timeoutMs} ms`)), timeoutMs)
    timer.unref?.()
  })
}

export async function buildHarmonyProject(
  options: HarmonyBuildArgs,
  execute = runHostProcess,
): Promise<{ projectPath: string; hapPath: string; output: string }> {
  const projectPath = await realpath(options.projectPath)
  const command = await resolveHvigor()
  const result = await execute(command, hvigorArguments(options), {
    cwd: projectPath,
    timeoutMs: 15 * 60_000,
    maxBytes: 2 * 1024 * 1024,
  })
  if (result.exitCode !== 0) {
    const detail = boundedLogText(`${result.stdout}\n${result.stderr}`, { maxLines: 120, maxBytes: 16 * 1024 })
    throw new Error(`Hvigor build failed (exit ${String(result.exitCode)}):\n${detail.text}`)
  }
  return {
    projectPath,
    hapPath: await findBuiltHap(projectPath),
    output: boundedLogText(`${result.stdout}\n${result.stderr}`, { maxLines: 120, maxBytes: 16 * 1024 }).text,
  }
}
