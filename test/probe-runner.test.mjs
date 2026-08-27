import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ProbeProcessError,
  extractUiTestVersion,
  publicTarget,
  resolveHdcBinary,
  resolveTarget,
  runProcess,
} from '../scripts/lib/probe-runner.mjs'

describe('resolveHdcBinary', () => {
  it('prefers an explicit HARMONY_HDC executable', () => {
    const seen = []
    const result = resolveHdcBinary({
      env: { HARMONY_HDC: '/opt/harmony/hdc' },
      platform: 'darwin',
      isExecutable(path) {
        seen.push(path)
        return path === '/opt/harmony/hdc'
      },
    })

    assert.equal(result, '/opt/harmony/hdc')
    assert.deepEqual(seen, ['/opt/harmony/hdc'])
  })

  it('checks both HarmonyOS and OpenHarmony DevEco SDK layouts on macOS', () => {
    const result = resolveHdcBinary({
      env: {},
      platform: 'darwin',
      isExecutable(path) {
        return path.endsWith('/sdk/default/openharmony/toolchains/hdc')
      },
    })

    assert.equal(
      result,
      '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc',
    )
  })

  it('falls back to PATH resolution by process spawn', () => {
    assert.equal(resolveHdcBinary({ env: {}, platform: 'linux', isExecutable: () => false }), 'hdc')
  })
})

describe('target safety', () => {
  const usbTarget = {
    connectKey: 'SERIAL-ONE',
    transport: 'USB',
    state: 'Connected',
    name: 'Pura',
    daemon: 'hdc',
  }

  it('publishes a stable hash without the raw connect key', () => {
    const published = publicTarget(usbTarget)
    assert.match(published.id, /^device-[a-f0-9]{12}$/)
    assert.equal('connectKey' in published, false)
    assert.equal(JSON.stringify(published).includes('SERIAL-ONE'), false)
  })

  it('resolves either a display hash or an exact connect key to a connected USB target', () => {
    const byHash = resolveTarget([usbTarget], publicTarget(usbTarget).id)
    const byKey = resolveTarget([usbTarget], 'SERIAL-ONE')
    assert.equal(byHash, usbTarget)
    assert.equal(byKey, usbTarget)
  })

  it('rejects TCP, offline, unknown, and missing targets', () => {
    assert.throws(
      () => resolveTarget([{ ...usbTarget, transport: 'TCP' }], 'SERIAL-ONE'),
      /USB target/i,
    )
    assert.throws(
      () => resolveTarget([{ ...usbTarget, state: 'Offline' }], 'SERIAL-ONE'),
      /Connected/i,
    )
    assert.throws(() => resolveTarget([usbTarget], 'missing'), /not found/i)
  })
})

describe('extractUiTestVersion', () => {
  it('extracts a four-part version from decorated output', () => {
    assert.equal(extractUiTestVersion('uitest version 5.1.1.2\n'), '5.1.1.2')
  })

  it('returns undefined when no supported version is present', () => {
    assert.equal(extractUiTestVersion('unknown command'), undefined)
  })
})

describe('runProcess', () => {
  it('runs an argument array without a shell and captures bounded output', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'ok'], {
      timeoutMs: 1_000,
      maxBytes: 128,
    })

    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout, 'ok')
    assert.equal(result.stderr, '')
    assert.equal(result.timedOut, false)
    assert.ok(result.durationMs >= 0)
  })

  it('terminates commands that exceed the timeout', async () => {
    await assert.rejects(
      runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
        timeoutMs: 25,
        maxBytes: 128,
      }),
      error => error instanceof ProbeProcessError && error.code === 'PROBE_TIMEOUT',
    )
  })

  it('terminates commands whose output exceeds the byte cap', async () => {
    await assert.rejects(
      runProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(1024))"], {
        timeoutMs: 1_000,
        maxBytes: 64,
      }),
      error => error instanceof ProbeProcessError && error.code === 'PROBE_OUTPUT_LIMIT',
    )
  })
})
