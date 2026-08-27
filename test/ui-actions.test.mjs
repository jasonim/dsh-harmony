import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

const FRAME = {
  id: 'frame-7',
  width: 1260,
  height: 2720,
  orientation: 'portrait',
}

describe('buildUiInputCommand', () => {
  test('maps normalized tap coordinates to the referenced frame', async () => {
    const { buildUiInputCommand } = await import('../src/ui-actions.ts')

    assert.deepEqual(
      buildUiInputCommand({ action: 'tap', frameId: 'frame-7', x: 0.5, y: 0.25 }, FRAME),
      ['shell', 'uitest', 'uiInput', 'click', '630', '680'],
    )
  })

  test('rejects stale frames and invalid normalized coordinates', async () => {
    const { buildUiInputCommand } = await import('../src/ui-actions.ts')

    assert.throws(
      () => buildUiInputCommand({ action: 'tap', frameId: 'frame-6', x: 0.5, y: 0.5 }, FRAME),
      /stale frame/u,
    )
    assert.throws(
      () => buildUiInputCommand({ action: 'tap', frameId: 'frame-7', x: 1.1, y: 0.5 }, FRAME),
      /normalized/u,
    )
  })

  test('builds drag and scroll as argument arrays', async () => {
    const { buildUiInputCommand } = await import('../src/ui-actions.ts')

    assert.deepEqual(
      buildUiInputCommand({
        action: 'drag',
        frameId: 'frame-7',
        fromX: 0.1,
        fromY: 0.2,
        toX: 0.9,
        toY: 0.8,
        velocity: 800,
      }, FRAME),
      ['shell', 'uitest', 'uiInput', 'drag', '126', '544', '1134', '2176', '800'],
    )
    assert.deepEqual(
      buildUiInputCommand({ action: 'scroll', frameId: 'frame-7', direction: 'down' }, FRAME),
      ['shell', 'uitest', 'uiInput', 'swipe', '630', '2040', '630', '680', '600'],
    )
  })

  test('supports only named safe key events', async () => {
    const { buildUiInputCommand } = await import('../src/ui-actions.ts')

    assert.deepEqual(
      buildUiInputCommand({ action: 'button', name: 'back' }, FRAME),
      ['shell', 'uitest', 'uiInput', 'keyEvent', 'Back'],
    )
    assert.throws(
      () => buildUiInputCommand({ action: 'button', name: 'FactoryReset' }, FRAME),
      /unknown button/u,
    )
  })

  test('types focused Unicode text without invoking a shell parser', async () => {
    const { buildUiInputCommand } = await import('../src/ui-actions.ts')

    assert.deepEqual(
      buildUiInputCommand({ action: 'text', text: '鸿蒙 test' }, FRAME),
      ['shell', 'uitest', 'uiInput', 'text', '鸿蒙 test'],
    )
    assert.throws(
      () => buildUiInputCommand({ action: 'text', text: 'x\0y' }, FRAME),
      /invalid text/u,
    )
  })
})

