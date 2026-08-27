import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path) {
  return readFile(new URL(path, root), 'utf8')
}

test('release documentation describes installation, tools, and honest preview limits', async () => {
  const readme = await read('README.md')
  assert.match(readme, /dsh plugin --profile web add/)
  assert.match(readme, /18 tools/)
  assert.match(readme, /0\.5[–-]2 FPS/)
  assert.match(readme, /USB/)
  assert.match(readme, /harmony_capabilities/)
})

test('release carries MIT and upstream attribution', async () => {
  const license = await read('LICENSE')
  const notices = await read('THIRD_PARTY_NOTICES.md')
  assert.match(license, /MIT License/)
  assert.match(notices, /ZSeven.W|ZSeven—W/)
  assert.match(notices, /dsh-ios/)
  assert.match(notices, /dsh-android/)
  assert.match(notices, /assets\/ocr\.swift/)
})

test('bundled DSH skill teaches frame-bound and ambiguity-safe operation', async () => {
  const skill = await read('skills/dsh-harmony/SKILL.md')
  assert.match(skill, /^---[\s\S]+name: dsh-harmony/m)
  assert.match(skill, /harmony_devices/)
  assert.match(skill, /frameId/)
  assert.match(skill, /ambiguous/i)
  assert.match(skill, /USB/)
})
