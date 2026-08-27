import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const TREE = Buffer.from(JSON.stringify({
  attributes: { bounds: '[0,0][1,1]' },
  children: [],
}))

function fakeClient() {
  const calls = []
  return {
    calls,
    async exec(device, args) {
      calls.push({ device, args })
      if (args[0] === 'file' && args[1] === 'recv') {
        await writeFile(args[3], args[2].endsWith('.png') ? PNG : TREE)
      }
      return { stdout: '', stderr: '', exitCode: 0, signal: null, durationMs: 1 }
    },
  }
}

describe('HarmonyDeviceController', () => {
  test('captures a local frame and cleans the remote artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-harmony-controller-'))
    try {
      const client = fakeClient()
      const { HarmonyDeviceController } = await import('../src/device-controller.ts')
      const controller = new HarmonyDeviceController(client, { cacheDir: directory, idFactory: () => 'capture-a' })

      const frame = await controller.capture('device-abc')

      assert.equal(frame.id, 'frame-1')
      assert.equal(frame.width, 1)
      assert.equal(frame.height, 1)
      assert.deepEqual(await readFile(frame.path), PNG)
      assert.deepEqual(client.calls[0].args.slice(0, 4), [
        'shell', 'uitest', 'screenCap', '-p',
      ])
      assert.deepEqual(client.calls.at(-1).args.slice(0, 3), ['shell', 'rm', '-f'])
      assert.equal(JSON.stringify(frame).includes('/data/local/tmp'), false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('binds interaction to the latest frame and returns the effect frame', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-harmony-controller-'))
    try {
      const client = fakeClient()
      let nextId = 0
      const { HarmonyDeviceController } = await import('../src/device-controller.ts')
      const controller = new HarmonyDeviceController(client, {
        cacheDir: directory,
        idFactory: () => `capture-${++nextId}`,
      })
      const initial = await controller.capture('device-abc')

      const result = await controller.interact('device-abc', {
        action: 'tap', frameId: initial.id, x: 0.5, y: 0.5,
      })

      assert.equal(result.action, 'tap')
      assert.equal(result.frame.id, 'frame-2')
      assert.ok(client.calls.some(call => call.args.includes('click')))
      await assert.rejects(
        controller.interact('device-abc', { action: 'tap', frameId: initial.id, x: 0.5, y: 0.5 }),
        /stale frame/u,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('dumps and parses a UI tree without retaining the remote JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-harmony-controller-'))
    try {
      const client = fakeClient()
      const { HarmonyDeviceController } = await import('../src/device-controller.ts')
      const controller = new HarmonyDeviceController(client, { cacheDir: directory, idFactory: () => 'tree-a' })

      const tree = await controller.uiTree('device-abc')

      assert.equal(tree.nodes.length, 1)
      assert.ok(client.calls.some(call => call.args.includes('dumpLayout')))
      assert.deepEqual(client.calls.at(-1).args.slice(0, 3), ['shell', 'rm', '-f'])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

