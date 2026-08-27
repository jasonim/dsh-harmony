import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  HARNESS_BUNDLE,
  assertHarnessForeground,
  centerOf,
  deterministicInputPlan,
} from '../scripts/device-input-gate-core.mjs'

test('input gate has the required deterministic workload', () => {
  const plan = deterministicInputPlan({ width: 1260, height: 2720 }, {
    click: { x: 100, y: 200, width: 300, height: 100 },
    input: { x: 100, y: 400, width: 500, height: 100 },
    list: { x: 40, y: 600, width: 1180, height: 1800 },
  })

  assert.equal(plan.filter(command => command.kind === 'click').length, 30)
  assert.equal(plan.filter(command => command.kind === 'swipe').length, 10)
  assert.equal(plan.filter(command => command.kind === 'text').length, 10)
  assert.equal(plan.filter(command => command.kind === 'back').length, 1)
  assert.deepEqual(centerOf({ x: 10, y: 20, width: 40, height: 60 }), { x: 30, y: 50 })
})

test('input gate refuses any foreground app other than its own fixture', () => {
  assert.doesNotThrow(() => assertHarnessForeground([{ bundleName: HARNESS_BUNDLE }]))
  assert.throws(
    () => assertHarnessForeground([{ bundleName: 'com.example.other' }]),
    /refusing input gate/i,
  )
  assert.throws(() => assertHarnessForeground([]), /refusing input gate/i)
})
