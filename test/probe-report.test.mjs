import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { deviceHash } from '../scripts/lib/probe-core.mjs'
import { ProbeProcessError } from '../scripts/lib/probe-runner.mjs'
import { runDeviceProbe, runListProbe, runSoakProbe } from '../scripts/lib/probe-report.mjs'

function successfulResult(stdout = '') {
  return {
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    timedOut: false,
    durationMs: 12,
  }
}

function createFakeExecute(overrides = new Map()) {
  const calls = []
  const execute = async (_binary, args) => {
    calls.push(args)
    const key = args.join('\u0000')
    if (overrides.has(key)) return overrides.get(key)
    if (key === '-v') return successfulResult('Ver: 3.2.0c\n')
    if (key === 'list\u0000targets\u0000-v') {
      return successfulResult('SERIAL-ONE USB Connected Pura hdc\n')
    }
    if (key.endsWith('uitest\u0000--version')) return successfulResult('uitest version 5.1.1.2\n')
    if (key.endsWith('uitest\u0000help')) return successfulResult('screenCap dumpLayout uiInput --version\n')
    if (key.endsWith('uitest\u0000uiInput\u0000help')) {
      return successfulResult('click swipe drag inputText text keyEvent\n')
    }
    throw new Error(`Unexpected command: ${JSON.stringify(args)}`)
  }
  return { execute, calls }
}

describe('runListProbe', () => {
  it('reports HDC and targets without exposing raw connect keys', async () => {
    const { execute } = createFakeExecute()
    const report = await runListProbe({ hdcBinary: '/sdk/hdc', execute })

    assert.equal(report.schemaVersion, 1)
    assert.equal(report.mode, 'list')
    assert.equal(report.host.hdcVersion, '3.2.0c')
    assert.deepEqual(report.devices, [{
      id: deviceHash('SERIAL-ONE'),
      transport: 'USB',
      state: 'Connected',
      name: 'Pura',
      daemon: 'hdc',
    }])
    assert.equal(JSON.stringify(report).includes('SERIAL-ONE'), false)
  })
})

describe('runDeviceProbe', () => {
  it('combines command, screenshot, and tree capabilities into a redacted report', async () => {
    const { execute, calls } = createFakeExecute()
    const screenshotProbe = async ({ target }) => {
      assert.equal(target.connectKey, 'SERIAL-ONE')
      return { available: true, bytes: 1234, width: 1260, height: 2720, durationMs: 80 }
    }
    const treeProbe = async ({ target }) => {
      assert.equal(target.connectKey, 'SERIAL-ONE')
      return { available: true, bytes: 2048, parseableJson: true, durationMs: 90 }
    }

    const report = await runDeviceProbe({
      hdcBinary: '/sdk/hdc',
      reference: deviceHash('SERIAL-ONE'),
      execute,
      screenshotProbe,
      treeProbe,
    })

    assert.equal(report.mode, 'all')
    assert.equal(report.device.id, deviceHash('SERIAL-ONE'))
    assert.equal(report.uiTest.version, '5.1.1.2')
    assert.equal(report.uiTest.capabilities.shellInput, true)
    assert.deepEqual(report.uiTest.commands, {
      screenCap: true,
      dumpLayout: true,
      uiInput: true,
      click: true,
      swipe: true,
      drag: true,
      inputText: true,
      focusedText: true,
      keyEvent: true,
    })
    assert.equal(report.screenshot.available, true)
    assert.equal(report.uiTree.available, true)
    assert.equal(JSON.stringify(report).includes('SERIAL-ONE'), false)
    assert.ok(calls.every(args => Array.isArray(args)))
  })

  it('reports a structured UiTest degradation when the version command fails', async () => {
    const failedVersion = successfulResult('')
    failedVersion.exitCode = 1
    failedVersion.stderr = 'unknown command'
    const overrides = new Map([
      [['-t', 'SERIAL-ONE', 'shell', 'uitest', '--version'].join('\u0000'), failedVersion],
    ])
    const { execute } = createFakeExecute(overrides)

    const report = await runDeviceProbe({
      hdcBinary: '/sdk/hdc',
      reference: deviceHash('SERIAL-ONE'),
      execute,
      screenshotProbe: async () => ({ available: false, reason: 'not-run' }),
      treeProbe: async () => ({ available: false, reason: 'not-run' }),
    })

    assert.equal(report.uiTest.available, false)
    assert.equal(report.uiTest.reason.code, 'UITEST_VERSION_FAILED')
    assert.equal(JSON.stringify(report).includes('unknown command'), false)
  })

  it('rejects a selected device that is not connected over USB', async () => {
    const overrides = new Map([
      ['list\u0000targets\u0000-v', successfulResult('192.168.1.5:5555 TCP Connected Pura hdc\n')],
    ])
    const { execute } = createFakeExecute(overrides)

    await assert.rejects(
      runDeviceProbe({
        hdcBinary: '/sdk/hdc',
        reference: deviceHash('192.168.1.5:5555'),
        execute,
      }),
      error => error instanceof ProbeProcessError && error.code === 'DEVICE_NOT_USB',
    )
  })
})

describe('runSoakProbe', () => {
  it('runs screenshot samples sequentially and reports bounded duration statistics', async () => {
    const { execute } = createFakeExecute()
    const durations = [10, 30, 20]
    let active = 0
    let maxActive = 0
    const screenshotProbe = async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const durationMs = durations.shift()
      active -= 1
      return { available: true, durationMs, bytes: 24, width: 100, height: 200 }
    }

    const report = await runSoakProbe({
      hdcBinary: '/sdk/hdc',
      reference: deviceHash('SERIAL-ONE'),
      iterations: 3,
      execute,
      screenshotProbe,
    })

    assert.equal(maxActive, 1)
    assert.equal(report.mode, 'soak')
    assert.equal(report.iterations, 3)
    assert.equal(report.successCount, 3)
    assert.equal(report.failureCount, 0)
    assert.deepEqual(report.durations, {
      count: 3,
      minMs: 10,
      maxMs: 30,
      meanMs: 20,
      p50Ms: 20,
      p95Ms: 30,
    })
    assert.equal(JSON.stringify(report).includes('SERIAL-ONE'), false)
  })
})
