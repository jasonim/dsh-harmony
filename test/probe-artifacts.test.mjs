import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  pngDimensions,
  probeScreenshotArtifact,
  probeTreeArtifact,
} from '../scripts/lib/probe-artifacts.mjs'

function png(width, height) {
  const buffer = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function success(stdout = '') {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    durationMs: 7,
  }
}

describe('pngDimensions', () => {
  it('reads dimensions from a PNG header', () => {
    assert.deepEqual(pngDimensions(png(1260, 2720)), { width: 1260, height: 2720 })
  })

  it('rejects truncated and non-PNG input', () => {
    assert.throws(() => pngDimensions(Buffer.alloc(10)), /valid PNG/i)
    assert.throws(() => pngDimensions(Buffer.alloc(24)), /valid PNG/i)
  })
})

describe('artifact probes', () => {
  const target = { connectKey: 'SERIAL-ONE' }

  it('captures, receives, measures, and cleans up a screenshot', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'dsh-harmony-artifact-test-'))
    const calls = []
    const execute = async (_binary, args) => {
      calls.push(args)
      if (args[2] === 'file' && args[3] === 'recv') await writeFile(args[5], png(1260, 2720))
      return success()
    }

    try {
      const result = await probeScreenshotArtifact({
        hdcBinary: '/sdk/hdc',
        execute,
        target,
        localDir,
        idFactory: () => 'fixed-id',
      })

      assert.deepEqual(result, {
        available: true,
        bytes: 24,
        width: 1260,
        height: 2720,
        durationMs: 21,
      })
      assert.deepEqual(calls, [
        ['-t', 'SERIAL-ONE', 'shell', 'uitest', 'screenCap', '-p', '/data/local/tmp/dsh-harmony-probe-fixed-id.png'],
        ['-t', 'SERIAL-ONE', 'file', 'recv', '/data/local/tmp/dsh-harmony-probe-fixed-id.png', join(localDir, 'fixed-id.png')],
        ['-t', 'SERIAL-ONE', 'shell', 'rm', '-f', '/data/local/tmp/dsh-harmony-probe-fixed-id.png'],
      ])
    } finally {
      await rm(localDir, { recursive: true, force: true })
    }
  })

  it('captures and validates a JSON UI tree without returning its contents', async () => {
    const localDir = await mkdtemp(join(tmpdir(), 'dsh-harmony-tree-test-'))
    const execute = async (_binary, args) => {
      if (args[2] === 'file' && args[3] === 'recv') {
        await writeFile(args[5], JSON.stringify({ attributes: { text: 'private text' }, children: [] }))
      }
      return success()
    }

    try {
      const result = await probeTreeArtifact({
        hdcBinary: '/sdk/hdc',
        execute,
        target,
        localDir,
        idFactory: () => 'tree-id',
      })

      assert.equal(result.available, true)
      assert.equal(result.parseableJson, true)
      assert.equal(result.durationMs, 21)
      assert.ok(result.bytes > 0)
      assert.equal(JSON.stringify(result).includes('private text'), false)
    } finally {
      await rm(localDir, { recursive: true, force: true })
    }
  })

  it('rejects unsafe generated ids before invoking HDC', async () => {
    let invoked = false
    await assert.rejects(
      probeScreenshotArtifact({
        hdcBinary: '/sdk/hdc',
        execute: async () => {
          invoked = true
          return success()
        },
        target,
        idFactory: () => '../escape',
      }),
      /safe probe id/i,
    )
    assert.equal(invoked, false)
  })
})
