import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, it } from 'node:test'

import { deviceHash } from '../scripts/lib/probe-core.mjs'

function runCli(args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('scripts/probe-device.mjs'), ...args], {
      cwd: resolve('.'),
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', exitCode => resolvePromise({
      exitCode,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
  })
}

async function createFakeHdc(directory) {
  const path = join(directory, 'fake-hdc.mjs')
  const source = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const key = args.join('\\u0000')
if (key === '-v') console.log('Ver: 3.2.0c')
else if (key === 'list\\u0000targets\\u0000-v') console.log('SERIAL-ONE USB Connected Pura hdc')
else if (key.endsWith('uitest\\u0000--version')) console.log('uitest version 5.1.1.2')
else if (key.endsWith('uitest\\u0000help')) console.log('screenCap dumpLayout uiInput --version')
else if (key.endsWith('uitest\\u0000uiInput\\u0000help')) console.log('click swipe drag inputText text keyEvent')
else if (args[2] === 'file' && args[3] === 'recv') {
  if (args[4].endsWith('.png')) {
    const png = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
    png.writeUInt32BE(100, 16)
    png.writeUInt32BE(200, 20)
    writeFileSync(args[5], png)
  } else writeFileSync(args[5], JSON.stringify({ children: [] }))
}
else if (args[2] === 'shell') process.exit(0)
else process.exit(9)
`
  await writeFile(path, source)
  await chmod(path, 0o755)
  return path
}

describe('probe-device CLI', () => {
  it('lists redacted devices as machine-readable JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-harmony-cli-test-'))
    try {
      const fakeHdc = await createFakeHdc(directory)
      const result = await runCli(['--list'], { ...process.env, HARMONY_HDC: fakeHdc })

      assert.equal(result.exitCode, 0)
      assert.equal(result.stderr, '')
      const report = JSON.parse(result.stdout)
      assert.equal(report.mode, 'list')
      assert.equal(report.devices[0].id, deviceHash('SERIAL-ONE'))
      assert.equal(result.stdout.includes('SERIAL-ONE'), false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('runs the full observational probe without exposing the selected connect key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-harmony-cli-test-'))
    try {
      const fakeHdc = await createFakeHdc(directory)
      const result = await runCli(
        ['--device', deviceHash('SERIAL-ONE'), '--all'],
        { ...process.env, HARMONY_HDC: fakeHdc },
      )

      assert.equal(result.exitCode, 0)
      const report = JSON.parse(result.stdout)
      assert.equal(report.mode, 'all')
      assert.equal(report.screenshot.available, true)
      assert.equal(report.uiTree.parseableJson, true)
      assert.equal(result.stdout.includes('SERIAL-ONE'), false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('returns a sanitized JSON error for invalid arguments', async () => {
    const result = await runCli([], process.env)
    assert.equal(result.exitCode, 1)
    assert.deepEqual(JSON.parse(result.stdout), {
      schemaVersion: 1,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'Probe request was rejected',
      },
    })
  })
})
