import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

test('TypeScript build configuration emits host and client declarations', async () => {
  const host = JSON.parse(await readFile(new URL('tsconfig.json', root), 'utf8'))
  const client = JSON.parse(await readFile(new URL('tsconfig.client.json', root), 'utf8'))

  assert.equal(host.compilerOptions.module, 'nodenext')
  assert.equal(host.compilerOptions.declaration, true)
  assert.equal(host.compilerOptions.outDir, 'lib')
  assert.equal(client.compilerOptions.jsx, 'react-jsx')
  assert.equal(client.compilerOptions.declarationDir, 'lib/types')
})

test('host, client, and build helper entry points exist', async () => {
  await Promise.all([
    access(new URL('src/index.ts', root)),
    access(new URL('src/client/index.tsx', root)),
    access(new URL('scripts/run-tool.mjs', root)),
    access(new URL('scripts/build-client.mjs', root)),
  ])
})

test('host entry exposes the stable Cordis lifecycle contract', async () => {
  const source = await readFile(new URL('src/index.ts', root), 'utf8')

  assert.match(source, /export const name = PLUGIN_NAME/u)
  assert.match(source, /export const inject = \['tools'\]/u)
  assert.match(source, /export function apply/u)
  assert.match(source, /ctx\.effect/u)
})

test('client entry declares every Cordis service it reads', async () => {
  const source = await readFile(new URL('src/client/index.tsx', root), 'utf8')

  assert.match(source, /export const inject = \['slots'\]/u)
  assert.match(source, /ctx\.slots/u)
})
