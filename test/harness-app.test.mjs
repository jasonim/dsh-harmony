import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../fixtures/harness-app/', import.meta.url)

async function source(path) {
  return readFile(new URL(path, root), 'utf8')
}

test('ships a deterministic HarmonyOS HAP fixture', async () => {
  const app = await source('AppScope/app.json5')
  const module = await source('entry/src/main/module.json5')
  const page = await source('entry/src/main/ets/pages/Index.ets')

  assert.match(app, /com\.deepseek\.dsh\.harness/)
  assert.match(module, /EntryAbility/)
  assert.match(page, /accessibilityText\('DSH Click Target'\)/)
  assert.match(page, /accessibilityText\('DSH Text Input'\)/)
  assert.match(page, /accessibilityText\('DSH Swipe List'\)/)
  assert.match(page, /Click count: \$\{this\.clickCount\}/)
  assert.match(page, /Input: \$\{this\.inputValue\}/)
})

test('fixture documents a reproducible build and input gate', async () => {
  const readme = await source('README.md')
  assert.match(readme, /assembleHap/)
  assert.match(readme, /30 clicks/)
  assert.match(readme, /10 swipes/)
  assert.match(readme, /10 text inputs/)
  assert.match(readme, /com\.deepseek\.dsh\.harness/)
})
