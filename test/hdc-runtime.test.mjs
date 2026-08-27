import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const RAW_KEY = '127.0.0.1:8710'

function result(stdout = '', stderr = '', overrides = {}) {
  return {
    stdout,
    stderr,
    exitCode: 0,
    signal: null,
    durationMs: 1,
    ...overrides,
  }
}

describe('HarmonyHdcClient', () => {
  test('lists only redacted device identities while preserving connection facts', async () => {
    const calls = []
    const execute = async (_command, args) => {
      calls.push(args)
      if (args[0] === '-v') return result('Ver: 3.2.0c')
      return result(`${RAW_KEY}\tUSB\tConnected\tlocalhost\n192.0.2.4:8710\tTCP\tConnected\tremote`)
    }
    const { HarmonyHdcClient } = await import('../src/hdc.ts')
    const client = new HarmonyHdcClient({ command: '/sdk/hdc', execute })

    const inventory = await client.inventory()

    assert.equal(inventory.hdcVersion, '3.2.0c')
    assert.equal(inventory.devices.length, 2)
    assert.match(inventory.devices[0].id, /^device-[a-f0-9]{12}$/u)
    assert.equal(JSON.stringify(inventory).includes(RAW_KEY), false)
    assert.deepEqual(calls, [['-v'], ['list', 'targets', '-v']])
  })

  test('targets every command and accepts a redacted USB device id', async () => {
    const calls = []
    const execute = async (_command, args) => {
      calls.push(args)
      if (args[0] === '-v') return result('Ver: 3.2.0c')
      if (args[0] === 'list') return result(`${RAW_KEY}\tUSB\tConnected\tlocalhost`)
      return result('ok')
    }
    const { HarmonyHdcClient } = await import('../src/hdc.ts')
    const client = new HarmonyHdcClient({ command: '/sdk/hdc', execute })
    const [device] = (await client.inventory()).devices

    const command = await client.exec(device.id, ['shell', 'uitest', '--version'])

    assert.equal(command.stdout, 'ok')
    assert.deepEqual(calls.at(-1), ['-t', RAW_KEY, 'shell', 'uitest', '--version'])
  })

  test('refuses TCP, offline, unknown, and ambiguous default targets', async () => {
    const output = [
      `${RAW_KEY}\tUSB\tConnected\tphone-a`,
      '127.0.0.1:8711\tUSB\tConnected\tphone-b',
      '192.0.2.4:8710\tTCP\tConnected\tremote',
      'deadbeef\tUSB\tOffline\tphone-c',
    ].join('\n')
    const execute = async (_command, args) => args[0] === '-v'
      ? result('Ver: 3.2.0c')
      : result(output)
    const { HarmonyHdcClient } = await import('../src/hdc.ts')
    const client = new HarmonyHdcClient({ command: '/sdk/hdc', execute })
    const devices = (await client.inventory()).devices

    await assert.rejects(client.exec(undefined, ['shell', 'true']), /device is required/u)
    await assert.rejects(client.exec(devices[2].id, ['shell', 'true']), /USB and Connected/u)
    await assert.rejects(client.exec(devices[3].id, ['shell', 'true']), /USB and Connected/u)
    await assert.rejects(client.exec('device-000000000000', ['shell', 'true']), /not found/u)
  })

  test('treats textual HDC failures as failures even with exit zero', async () => {
    const execute = async (_command, args) => args[0] === '-v'
      ? result('Ver: 3.2.0c')
      : result('Connect server failed')
    const { HarmonyHdcClient, HdcError } = await import('../src/hdc.ts')
    const client = new HarmonyHdcClient({ command: '/sdk/hdc', execute })

    await assert.rejects(
      client.inventory(),
      error => error instanceof HdcError && error.code === 'HDC_LIST_FAILED',
    )
  })

  test('serializes commands for the same target', async () => {
    let active = 0
    let peak = 0
    const execute = async (_command, args) => {
      if (args[0] === '-v') return result('Ver: 3.2.0c')
      if (args[0] === 'list') return result(`${RAW_KEY}\tUSB\tConnected\tlocalhost`)
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 15))
      active -= 1
      return result(args.at(-1))
    }
    const { HarmonyHdcClient } = await import('../src/hdc.ts')
    const client = new HarmonyHdcClient({ command: '/sdk/hdc', execute })
    const [device] = (await client.inventory()).devices

    await Promise.all([
      client.exec(device.id, ['shell', 'first']),
      client.exec(device.id, ['shell', 'second']),
      client.exec(device.id, ['shell', 'third']),
    ])

    assert.equal(peak, 1)
  })
})

