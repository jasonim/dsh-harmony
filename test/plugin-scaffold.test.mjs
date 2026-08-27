import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

const EXPECTED_TOOLS = [
  'harmony_devices',
  'harmony_capabilities',
  'harmony_build',
  'harmony_install',
  'harmony_launch',
  'harmony_list_apps',
  'harmony_screenshot',
  'harmony_interact',
  'harmony_logs',
  'harmony_find_text',
  'harmony_tap_text',
  'harmony_wait_for',
  'harmony_ui_tree',
  'harmony_tap_element',
  'harmony_ui_rows',
  'harmony_tap_row',
  'harmony_app_info',
  'harmony_processes',
]

test('DSH package manifest exposes host and browser entry points', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

  assert.equal(manifest.name, 'dsh-harmony')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['.'].default, './lib/index.js')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'))
})

test('Cordis patch mounts the stable plugin id', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  assert.match(patch, /id:\s*dsh-harmony/u)
  assert.match(patch, /name:\s*['"]?dsh-harmony['"]?/u)
})

test('v0.1 tool contract is stable and duplicate free', async () => {
  const { HARMONY_TOOL_NAMES, PLUGIN_NAME } = await import('../src/contracts.ts')

  assert.equal(PLUGIN_NAME, 'dsh-harmony')
  assert.deepEqual(HARMONY_TOOL_NAMES, EXPECTED_TOOLS)
  assert.equal(new Set(HARMONY_TOOL_NAMES).size, HARMONY_TOOL_NAMES.length)
})

