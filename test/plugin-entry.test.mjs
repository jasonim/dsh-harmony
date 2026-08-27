import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('host entry constructs the executable runtime instead of a pending stub', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')

  assert.match(source, /import \{ HarmonyRuntime \} from '\.\/runtime\.ts'/u)
  assert.match(source, /new HarmonyRuntime\(/u)
  assert.doesNotMatch(source, /runtime initialization is pending/u)
})

test('apply registers all tools and disposes them in reverse order', async () => {
  const { apply } = await import('../src/index.ts')
  const registered = []
  const disposed = []
  const ctx = {
    tools: {
      register(tool) {
        registered.push(tool.name)
        return () => disposed.push(tool.name)
      },
    },
    effect(setup) {
      return setup()
    },
  }

  const dispose = apply(ctx)
  await dispose()

  assert.equal(registered.length, 18)
  assert.deepEqual(disposed, [...registered].reverse())
})

