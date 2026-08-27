import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

import { HARMONY_TOOL_NAMES } from '../src/contracts.ts'

describe('DSH Harmony tool specs', () => {
  test('defines every v0.1 tool exactly once with bounded schemas', async () => {
    const calls = []
    const runtime = {
      execute: async (name, args) => {
        calls.push({ name, args })
        return { ok: true, name }
      },
    }
    const { createHarmonyToolSpecs } = await import('../src/tool-specs.ts')

    const specs = createHarmonyToolSpecs(runtime)

    assert.deepEqual(specs.map(spec => spec.name), HARMONY_TOOL_NAMES)
    assert.equal(new Set(specs.map(spec => spec.name)).size, HARMONY_TOOL_NAMES.length)
    for (const spec of specs) {
      assert.ok(spec.description.length >= 40, `${spec.name} needs a useful description`)
      assert.equal(spec.parameters.type, 'object')
      assert.equal(spec.parameters.additionalProperties, false)
      assert.ok(Number.isSafeInteger(spec.timeoutMs) && spec.timeoutMs > 0)
    }
    await specs[0].execute({})
    assert.deepEqual(calls, [{ name: 'harmony_devices', args: {} }])
  })

  test('marks write-capable tools and requires frame ids for coordinate actions', async () => {
    const { createHarmonyToolSpecs } = await import('../src/tool-specs.ts')
    const specs = createHarmonyToolSpecs({ execute: async () => ({}) })
    const byName = Object.fromEntries(specs.map(spec => [spec.name, spec]))

    assert.equal(byName.harmony_devices.write, false)
    assert.equal(byName.harmony_screenshot.write, false)
    assert.equal(byName.harmony_interact.write, true)
    assert.deepEqual(byName.harmony_interact.parameters.required.sort(), ['action'])
    assert.ok(byName.harmony_interact.parameters.properties.frameId)
    assert.equal(byName.harmony_install.parameters.properties.replace.default, false)
  })

  test('manifest declares DSH host peers and build commands', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

    assert.match(manifest.peerDependencies['@deepseek-ai/cordis'], /^\^4/u)
    assert.match(manifest.peerDependencies['@deepseek-ai/dsh-tools'], /^\^0\.1/u)
    assert.ok(manifest.scripts.build)
    assert.ok(manifest.scripts.typecheck)
    assert.ok(manifest.scripts['build:client'])
  })
})

