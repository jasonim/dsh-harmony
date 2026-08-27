import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

describe('Harmony lifecycle helpers', () => {
  test('builds explicit bounded Hvigor arguments', async () => {
    const { hostProcessEnvironment, hvigorArguments } = await import('../src/lifecycle.ts')

    assert.deepEqual(hvigorArguments({ module: 'entry', product: 'default', mode: 'debug' }), [
      'assembleHap', '--mode', 'module', '-p', 'module=entry@default', '-p', 'product=default',
      '--no-daemon', '--no-parallel',
    ])
    assert.throws(() => hvigorArguments({ module: '../entry', product: 'default' }), /invalid module/u)
    assert.equal(
      hostProcessEnvironment({ PATH: '/usr/bin' }, '/opt/node/bin/node').NODE_HOME,
      '/opt/node',
    )
    assert.equal(
      hostProcessEnvironment({ NODE_HOME: '/custom/node' }, '/opt/node/bin/node').NODE_HOME,
      '/custom/node',
    )
    assert.equal(
      hostProcessEnvironment({}, '/opt/node/bin/node', 'darwin', () => true).DEVECO_SDK_HOME,
      '/Applications/DevEco-Studio.app/Contents/sdk',
    )
    assert.equal(hostProcessEnvironment({}, '/opt/node/bin/node', 'linux').DEVECO_SDK_HOME, undefined)
  })

  test('finds one HAP while ignoring dependency and cache directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harmony-project-'))
    try {
      const wanted = join(root, 'entry', 'build', 'default', 'outputs', 'entry.hap')
      await mkdir(join(root, 'entry', 'build', 'default', 'outputs'), { recursive: true })
      await mkdir(join(root, 'oh_modules', 'bad'), { recursive: true })
      await writeFile(wanted, 'hap')
      await writeFile(join(root, 'oh_modules', 'bad', 'ignored.hap'), 'hap')
      const { findBuiltHap } = await import('../src/lifecycle.ts')

      assert.equal(await findBuiltHap(root), await realpath(wanted))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('parses grouped bm output into unique bundle names', async () => {
    const { parseBundleList } = await import('../src/lifecycle.ts')
    const output = 'ID: 100:\n\tcom.example.alpha\n\tcom.example.beta\nID: 101:\n\tcom.example.alpha\n'

    assert.deepEqual(parseBundleList(output), ['com.example.alpha', 'com.example.beta'])
  })

  test('builds safe install and launch commands without implicit replacement', async () => {
    const { installCommand, launchCommands } = await import('../src/lifecycle.ts')

    assert.deepEqual(installCommand('/tmp/app.hap', false), ['app', 'install', '/tmp/app.hap'])
    assert.deepEqual(installCommand('/tmp/app.hap', true), ['app', 'install', '-r', '/tmp/app.hap'])
    assert.deepEqual(launchCommands('com.example.app', 'EntryAbility', true), [
      ['shell', 'aa', 'force-stop', 'com.example.app'],
      ['shell', 'aa', 'start', '-b', 'com.example.app', '-a', 'EntryAbility'],
    ])
    assert.throws(() => launchCommands('com.example.app;rm', 'EntryAbility', false), /invalid bundle/u)
  })

  test('bounds HiLog output by lines and bytes', async () => {
    const { boundedLogText } = await import('../src/lifecycle.ts')
    const source = Array.from({ length: 20 }, (_, index) => `${index} ${'x'.repeat(20)}`).join('\n')

    const bounded = boundedLogText(source, { maxLines: 5, maxBytes: 90 })

    assert.ok(bounded.lines.length <= 5)
    assert.ok(Buffer.byteLength(bounded.text) <= 90)
    assert.equal(bounded.truncated, true)
  })

  test('builds fixed HiLog commands and merges bounded follow snapshots', async () => {
    const { collectLogSnapshots, hilogCommand } = await import('../src/lifecycle.ts')
    assert.deepEqual(hilogCommand({ pid: 42 }), ['shell', 'hilog', '-x', '-z', '300', '-P', '42'])
    assert.throws(() => hilogCommand({ pid: -1 }), /pid/u)

    let clock = 0
    const snapshots = ['old\nshared', 'shared\nnew', 'shared\nnew']
    const text = await collectLogSnapshots(
      async () => snapshots.shift() ?? '',
      { durationMs: 1000, pollMs: 500, now: () => clock, pause: async ms => { clock += ms } },
    )

    assert.equal(text, 'old\nshared\nnew')
  })
})
