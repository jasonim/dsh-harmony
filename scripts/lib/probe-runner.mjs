import { accessSync, constants as fsConstants } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { deviceHash } from './probe-core.mjs'

export class ProbeProcessError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'ProbeProcessError'
    this.code = code
    this.details = details
  }
}

function defaultIsExecutable(path) {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveHdcBinary({
  env = process.env,
  platform = process.platform,
  isExecutable = defaultIsExecutable,
} = {}) {
  const explicit = env.HARMONY_HDC?.trim()
  if (explicit) {
    if (!isExecutable(explicit)) {
      throw new ProbeProcessError('HDC_NOT_EXECUTABLE', 'HARMONY_HDC does not point to an executable file')
    }
    return explicit
  }

  const executable = platform === 'win32' ? 'hdc.exe' : 'hdc'
  const candidates = []
  for (const sdkRoot of [env.DEVECO_SDK_HOME, env.OHOS_SDK_HOME]) {
    if (!sdkRoot?.trim()) continue
    candidates.push(join(sdkRoot, 'default', 'harmonyos', 'toolchains', executable))
    candidates.push(join(sdkRoot, 'default', 'openharmony', 'toolchains', executable))
    candidates.push(join(sdkRoot, 'toolchains', executable))
  }
  if (platform === 'darwin') {
    const appSdk = '/Applications/DevEco-Studio.app/Contents/sdk/default'
    candidates.push(join(appSdk, 'harmonyos', 'toolchains', executable))
    candidates.push(join(appSdk, 'openharmony', 'toolchains', executable))
  }

  return candidates.find(isExecutable) ?? executable
}

export function publicTarget(target) {
  return {
    id: deviceHash(target.connectKey),
    transport: target.transport,
    state: target.state,
    name: target.name,
    daemon: target.daemon,
  }
}

export function resolveTarget(targets, reference) {
  const target = targets.find(candidate => (
    candidate.connectKey === reference || deviceHash(candidate.connectKey) === reference
  ))
  if (!target) throw new ProbeProcessError('DEVICE_NOT_FOUND', 'Requested device was not found')
  if (target.transport !== 'USB') {
    throw new ProbeProcessError('DEVICE_NOT_USB', 'WP0 requires a USB target')
  }
  if (target.state !== 'Connected') {
    throw new ProbeProcessError('DEVICE_NOT_CONNECTED', 'WP0 requires a target in the Connected state')
  }
  return target
}

export function extractUiTestVersion(output) {
  return String(output ?? '').match(/\b\d+\.\d+\.\d+\.\d+\b/u)?.[0]
}

export function runProcess(binary, args, { timeoutMs = 10_000, maxBytes = 256 * 1024 } = {}) {
  if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string')) {
    return Promise.reject(new TypeError('runProcess requires a string argument array'))
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return Promise.reject(new RangeError('timeoutMs must be a positive integer'))
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return Promise.reject(new RangeError('maxBytes must be a positive integer'))
  }

  return new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const child = spawn(binary, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout = []
    const stderr = []
    let outputBytes = 0
    let settled = false

    const finishError = error => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.kill('SIGKILL')
      reject(error)
    }

    const append = destination => chunk => {
      if (settled) return
      outputBytes += chunk.length
      if (outputBytes > maxBytes) {
        finishError(new ProbeProcessError(
          'PROBE_OUTPUT_LIMIT',
          `Probe command exceeded the ${maxBytes}-byte output limit`,
          { maxBytes },
        ))
        return
      }
      destination.push(chunk)
    }

    child.stdout.on('data', append(stdout))
    child.stderr.on('data', append(stderr))
    child.on('error', error => {
      finishError(new ProbeProcessError('PROBE_SPAWN_FAILED', 'Unable to start probe command', {
        cause: error.message,
      }))
    })
    child.on('close', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut: false,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      })
    })

    const timeout = setTimeout(() => {
      finishError(new ProbeProcessError(
        'PROBE_TIMEOUT',
        `Probe command exceeded the ${timeoutMs} ms timeout`,
        { timeoutMs },
      ))
    }, timeoutMs)
    timeout.unref?.()
  })
}
