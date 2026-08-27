import assert from 'node:assert/strict'
import { test } from 'node:test'

const first = {
  device: 'device-abcdef123456', frameId: 'frame-1', width: 1260, height: 2720,
}
const second = {
  device: 'device-abcdef123456', frameId: 'frame-2', width: 1260, height: 2720,
}

test('page-owned panel store opens once, replaces explicitly, and closes', async () => {
  const { createHarmonyPanelStore } = await import('../src/client/panel-store.ts')
  const store = createHarmonyPanelStore()
  let changes = 0
  const dispose = store.subscribe(() => { changes += 1 })

  assert.equal(store.getSnapshot(), undefined)
  assert.equal(store.openIfIdle(first), true)
  assert.deepEqual(store.getSnapshot(), first)
  assert.equal(store.openIfIdle(second), false)
  assert.deepEqual(store.getSnapshot(), first)
  assert.equal(store.open(second), true)
  assert.deepEqual(store.getSnapshot(), second)
  store.close()
  assert.equal(store.getSnapshot(), undefined)
  assert.equal(changes, 3)

  dispose()
  store.open(first)
  assert.equal(changes, 3)
})
