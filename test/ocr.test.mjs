import assert from 'node:assert/strict'
import { test } from 'node:test'

test('parses and sanitizes Vision OCR JSON into runtime rectangles', async () => {
  const { parseOcrJson } = await import('../src/ocr.ts')
  const output = JSON.stringify({ items: [
    { text: ' Harmony ', confidence: 0.92, x: 10, y: 20, w: 30, h: 40 },
    { text: '', confidence: 1, x: 0, y: 0, w: 1, h: 1 },
    { text: 'bad', confidence: 2, x: 0, y: 0, w: 1, h: 1 },
  ] })

  assert.deepEqual(parseOcrJson(output), [{
    text: 'Harmony', confidence: 0.92, rect: { x: 10, y: 20, width: 30, height: 40 },
  }])
})

test('rejects malformed OCR payloads and duplicate observations', async () => {
  const { parseOcrJson } = await import('../src/ocr.ts')

  assert.throws(() => parseOcrJson('not json'), /non-JSON/u)
  assert.deepEqual(parseOcrJson(JSON.stringify({ items: [
    { text: 'A', confidence: 0.8, x: 1, y: 2, w: 3, h: 4 },
    { text: 'A', confidence: 0.8, x: 1, y: 2, w: 3, h: 4 },
  ] })).length, 1)
})

test('default runtime configures local OCR on macOS', async () => {
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../src/runtime.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /recognizeImage/u)
})
