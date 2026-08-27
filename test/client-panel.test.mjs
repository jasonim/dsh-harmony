import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('hydrates a panel source from durable DSH JSON output', async () => {
  const { parseHarmonyResult } = await import('../src/client/protocol.ts')
  const block = {
    kind: 'tool-result',
    isError: false,
    content: [{ type: 'text', text: JSON.stringify({
      device: 'device-abcdef123456', frameId: 'frame-4', width: 1260, height: 2720,
    }) }],
  }

  assert.deepEqual(parseHarmonyResult(block), {
    device: 'device-abcdef123456', frameId: 'frame-4', width: 1260, height: 2720,
  })
})

test('maps pointer coordinates into normalized image space', async () => {
  const { grantNeedsRefresh, normalizedPoint } = await import('../src/client/protocol.ts')

  assert.deepEqual(
    normalizedPoint({ clientX: 150, clientY: 250 }, { left: 100, top: 100, width: 200, height: 300 }),
    { x: 0.25, y: 0.5 },
  )
  assert.deepEqual(
    normalizedPoint({ clientX: 0, clientY: 999 }, { left: 100, top: 100, width: 200, height: 300 }),
    { x: 0, y: 1 },
  )
  assert.equal(grantNeedsRefresh(20_000, 10_000), false)
  assert.equal(grantNeedsRefresh(14_000, 10_000), true)
})

test('client panel uses signed grant, capture, frame, and control routes', async () => {
  const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')

  assert.match(source, /\/_dsh\/dsh-harmony\/grant/u)
  assert.match(source, /captureUrl/u)
  assert.match(source, /controlUrl/u)
  assert.match(source, /1100/u)
  assert.match(source, /grantEpoch/u)
  assert.match(source, /expiresAt/u)
  assert.match(source, /tool\.call\.toolview/u)
  assert.match(source, /createRoot/u)
  assert.match(source, /mountHarmonyPanelHost/u)
  assert.match(source, /data-harmony-panel-surface/u)
  assert.match(source, /marginRight/u)
  assert.match(source, /openIfIdle/u)
})
