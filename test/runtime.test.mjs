import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

function fixture() {
  const calls = []
  const frame = {
    id: 'frame-9', sequence: 9, device: 'device-abc', path: '/cache/frame.png', bytes: 80,
    width: 100, height: 200, orientation: 'portrait', capturedAt: 10,
  }
  const client = {
    async inventory() {
      return { hdcVersion: '3.2.0c', devices: [{ id: 'device-abc', transport: 'USB', state: 'Connected' }] }
    },
    async exec(device, args) {
      calls.push({ device, args })
      const joined = args.join(' ')
      if (joined.includes('uitest --version')) return { stdout: 'uitest 6.0.2.3', stderr: '' }
      if (joined.includes('uitest help')) return { stdout: 'screenCap dumpLayout uiInput', stderr: '' }
      if (joined.includes('uiInput help')) return { stdout: 'click swipe drag inputText text keyEvent', stderr: '' }
      if (joined.includes('bm dump -a')) return { stdout: 'ID: 100:\n\tcom.example.app\n', stderr: '' }
      if (joined.includes('hilog')) return { stdout: 'one\ntwo\nthree', stderr: '' }
      if (joined.includes('ps -ef')) return { stdout: 'UID PID PPID CMD\n100 42 1 com.example.app', stderr: '' }
      return { stdout: 'ok', stderr: '' }
    },
  }
  const controller = {
    latestFrame: () => frame,
    capture: async () => frame,
    interact: async (_device, action) => ({ action: action.action, frame: { ...frame, id: 'frame-10' } }),
    uiTree: async () => ({
      truncated: false,
      nodes: [{
        index: 0, depth: 0, id: 'submit', text: 'Submit',
        bounds: { x: 10, y: 20, width: 40, height: 20 },
        enabled: true, clickable: true, visible: true, scrollable: false,
      }],
    }),
  }
  const build = async args => ({ projectPath: args.projectPath, hapPath: '/project/entry.hap', output: 'BUILD SUCCESS' })
  const ocr = async () => [{ text: 'Welcome', confidence: 0.99, rect: { x: 10, y: 20, width: 30, height: 10 } }]
  return { calls, client, controller, build, ocr, frame }
}

describe('HarmonyRuntime', () => {
  test('reports real capabilities and redacted devices', async () => {
    const deps = fixture()
    const { HarmonyRuntime } = await import('../src/runtime.ts')
    const runtime = new HarmonyRuntime(deps)

    const devices = await runtime.execute('harmony_devices', {})
    const capabilities = await runtime.execute('harmony_capabilities', { device: 'device-abc' })

    assert.equal(devices.count, 1)
    assert.equal(capabilities.uiTest.version, '6.0.2.3')
    assert.equal(capabilities.uiTest.commands.swipe, true)
    assert.equal(JSON.stringify(capabilities).includes('127.0.0.1'), false)
  })

  test('dispatches build, install, launch, apps, logs, and processes', async () => {
    const deps = fixture()
    const { HarmonyRuntime } = await import('../src/runtime.ts')
    const runtime = new HarmonyRuntime(deps)

    assert.equal((await runtime.execute('harmony_build', { projectPath: '/project' })).hapPath, '/project/entry.hap')
    await runtime.execute('harmony_install', { device: 'device-abc', hapPath: '/project/entry.hap' })
    await runtime.execute('harmony_launch', { device: 'device-abc', bundle: 'com.example.app', ability: 'EntryAbility' })
    assert.deepEqual((await runtime.execute('harmony_list_apps', { device: 'device-abc' })).apps, ['com.example.app'])
    assert.equal((await runtime.execute('harmony_logs', { device: 'device-abc' })).lines.length, 3)
    assert.equal((await runtime.execute('harmony_processes', { device: 'device-abc' })).processes[0].pid, 42)
    assert.ok(deps.calls.some(call => call.args.join(' ') === 'app install /project/entry.hap'))
  })

  test('returns frames and taps an unambiguous element center', async () => {
    const deps = fixture()
    const { HarmonyRuntime } = await import('../src/runtime.ts')
    const runtime = new HarmonyRuntime(deps)

    assert.equal((await runtime.execute('harmony_screenshot', { device: 'device-abc' })).frameId, 'frame-9')
    const result = await runtime.execute('harmony_tap_element', {
      device: 'device-abc', resourceId: 'submit', frameId: 'frame-9',
    })

    assert.equal(result.matched.id, 'submit')
    assert.equal(result.frame.frameId, 'frame-10')
  })

  test('runs OCR find and bounded wait workflows', async () => {
    const deps = fixture()
    const { HarmonyRuntime } = await import('../src/runtime.ts')
    const runtime = new HarmonyRuntime(deps)

    const found = await runtime.execute('harmony_find_text', { device: 'device-abc', query: 'wel' })
    const waited = await runtime.execute('harmony_wait_for', {
      device: 'device-abc', text: 'Welcome', mode: 'appear', timeoutMs: 100,
    })

    assert.equal(found.items.length, 1)
    assert.equal(waited.matched, true)
  })
})

