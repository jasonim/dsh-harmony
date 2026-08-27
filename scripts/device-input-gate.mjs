#!/usr/bin/env node

import { access, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { HarmonyDeviceController } from '../src/device-controller.ts'
import { HarmonyHdcClient } from '../src/hdc.ts'
import { assertTappable, findUniqueNode } from '../src/ui-tree.ts'
import {
  HARNESS_ABILITY,
  HARNESS_BUNDLE,
  assertHarnessForeground,
  deterministicInputPlan,
} from './device-input-gate-core.mjs'

function parseArgs(args) {
  const result = {}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument !== '--hap' && argument !== '--device') throw new TypeError(`unknown argument ${argument}`)
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new TypeError(`${argument} requires a value`)
    result[argument.slice(2)] = value
    index += 1
  }
  if (typeof result.hap !== 'string' || !isAbsolute(result.hap) || !result.hap.endsWith('.hap')) {
    throw new TypeError('--hap requires an absolute signed HAP path')
  }
  return result
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const hapPath = await realpath(args.hap)
  await access(hapPath)
  const client = new HarmonyHdcClient()
  const inventory = await client.inventory()
  const ready = inventory.devices.filter(device => device.transport === 'USB' && device.state === 'Connected')
  const device = args.device ?? (ready.length === 1 ? ready[0].id : undefined)
  if (device === undefined) throw new Error('Exactly one USB + Connected device is required, or pass --device')

  await client.exec(device, ['app', 'install', '-r', hapPath], { timeoutMs: 120_000 })
  await client.exec(device, ['shell', 'aa', 'force-stop', HARNESS_BUNDLE])
  await client.exec(device, ['shell', 'aa', 'start', '-b', HARNESS_BUNDLE, '-a', HARNESS_ABILITY])
  await sleep(1500)

  const controller = new HarmonyDeviceController(client, {
    cacheDir: join(tmpdir(), 'dsh-harmony-device-gate'),
    settleMs: 0,
  })
  const before = await controller.uiTree(device, { maxNodes: 2000 })
  assertHarnessForeground(before.nodes)
  const click = findUniqueNode(before.nodes, { resourceId: 'dsh_click_target' })
  const input = findUniqueNode(before.nodes, { resourceId: 'dsh_text_input' })
  const list = findUniqueNode(before.nodes, { resourceId: 'dsh_swipe_list' })
  for (const node of [click, input, list]) assertTappable(node)
  const frame = await controller.capture(device)
  const plan = deterministicInputPlan(frame, {
    click: click.bounds,
    input: input.bounds,
    list: list.bounds,
  })

  for (const command of plan) {
    if (command.kind === 'click' || command.kind === 'focus') {
      await client.exec(device, ['shell', 'uitest', 'uiInput', 'click', String(command.x), String(command.y)])
    } else if (command.kind === 'swipe') {
      await client.exec(device, [
        'shell', 'uitest', 'uiInput', 'swipe',
        String(command.from.x), String(command.from.y), String(command.to.x), String(command.to.y),
        String(command.velocity),
      ])
    } else if (command.kind === 'text') {
      await client.exec(device, ['shell', 'uitest', 'uiInput', 'text', command.text])
    } else {
      await client.exec(device, ['shell', 'uitest', 'uiInput', 'keyEvent', 'Back'])
    }
  }

  await sleep(700)
  const after = await controller.uiTree(device, { maxNodes: 2000 })
  assertHarnessForeground(after.nodes)
  findUniqueNode(after.nodes, { text: 'Click count: 30' })
  findUniqueNode(after.nodes, { text: 'Input: xxxxxxxxxx' })
  findUniqueNode(after.nodes, { text: 'Row 20' })
  return {
    schemaVersion: 1,
    device,
    bundle: HARNESS_BUNDLE,
    clicks: 30,
    swipes: 10,
    textInputs: 10,
    back: 1,
    passed: true,
  }
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    error: {
      code: error?.code ?? 'DEVICE_GATE_FAILED',
      message: error instanceof TypeError ? error.message : 'Device input gate did not pass',
    },
  }, null, 2)}\n`)
  process.exitCode = 1
}
