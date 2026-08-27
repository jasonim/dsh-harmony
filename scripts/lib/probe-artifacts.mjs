import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ProbeProcessError, runProcess } from './probe-runner.mjs'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/u
const REMOTE_ROOT = '/data/local/tmp'

export function pngDimensions(buffer) {
  if (
    !Buffer.isBuffer(buffer)
    || buffer.length < 24
    || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw new TypeError('Artifact is not a valid PNG')
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function requireSuccess(result, code, operation) {
  if (result.exitCode === 0 && result.signal === null) return result
  throw new ProbeProcessError(code, `${operation} failed`)
}

function safeId(idFactory) {
  const id = String(idFactory())
  if (!SAFE_ID.test(id)) throw new TypeError('Artifact probe requires a safe probe id')
  return id
}

async function artifactProbe({
  kind,
  extension,
  captureArgs,
  failurePrefix,
  hdcBinary,
  execute,
  target,
  localDir,
  idFactory,
  inspect,
}) {
  const id = safeId(idFactory)
  const ownsLocalDir = localDir === undefined
  const directory = localDir ?? await mkdtemp(join(tmpdir(), 'dsh-harmony-probe-'))
  const remotePath = `${REMOTE_ROOT}/dsh-harmony-probe-${id}.${extension}`
  const localPath = join(directory, `${id}.${extension}`)
  const prefix = ['-t', target.connectKey]
  let durationMs = 0
  let artifactResult

  try {
    const capture = requireSuccess(
      await execute(hdcBinary, [...prefix, 'shell', 'uitest', ...captureArgs(remotePath)], {
        timeoutMs: 30_000,
        maxBytes: 64 * 1024,
      }),
      `${failurePrefix}_CAPTURE_FAILED`,
      `${kind} capture`,
    )
    durationMs += capture.durationMs

    const receive = requireSuccess(
      await execute(hdcBinary, [...prefix, 'file', 'recv', remotePath, localPath], {
        timeoutMs: 30_000,
        maxBytes: 64 * 1024,
      }),
      `${failurePrefix}_RECEIVE_FAILED`,
      `${kind} receive`,
    )
    durationMs += receive.durationMs
    const buffer = await readFile(localPath)
    artifactResult = {
      available: true,
      bytes: buffer.length,
      ...inspect(buffer),
    }
  } finally {
    try {
      const cleanup = await execute(hdcBinary, [...prefix, 'shell', 'rm', '-f', remotePath], {
        timeoutMs: 10_000,
        maxBytes: 16 * 1024,
      })
      durationMs += cleanup.durationMs
    } catch {
      // Cleanup is best-effort and only targets the generated probe path.
    }
    await rm(localPath, { force: true })
    if (ownsLocalDir) await rm(directory, { recursive: true, force: true })
  }
  return { ...artifactResult, durationMs }
}

export function probeScreenshotArtifact({
  hdcBinary,
  execute = runProcess,
  target,
  localDir,
  idFactory = randomUUID,
}) {
  return artifactProbe({
    kind: 'Screenshot',
    extension: 'png',
    captureArgs: remotePath => ['screenCap', '-p', remotePath],
    failurePrefix: 'SCREENSHOT',
    hdcBinary,
    execute,
    target,
    localDir,
    idFactory,
    inspect: pngDimensions,
  })
}

export function probeTreeArtifact({
  hdcBinary,
  execute = runProcess,
  target,
  localDir,
  idFactory = randomUUID,
}) {
  return artifactProbe({
    kind: 'UI tree',
    extension: 'json',
    captureArgs: remotePath => ['dumpLayout', '-p', remotePath],
    failurePrefix: 'UI_TREE',
    hdcBinary,
    execute,
    target,
    localDir,
    idFactory,
    inspect(buffer) {
      try {
        JSON.parse(buffer.toString('utf8'))
        return { parseableJson: true }
      } catch {
        return { parseableJson: false }
      }
    },
  })
}
