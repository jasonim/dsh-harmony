import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

describe('stream capabilities', () => {
  test('signs, verifies, scopes, expires, and rejects tampering', async () => {
    const { StreamAccessController } = await import('../src/stream-access.ts')
    let now = 1000
    const access = new StreamAccessController({
      key: async () => Buffer.alloc(32, 7),
      now: () => now,
    })

    const signed = await access.sign({ kind: 'frame', device: 'device-abcdef123456', session: 's1' }, 500)

    assert.equal((await access.verify(signed.token, 'frame'))?.device, 'device-abcdef123456')
    assert.equal(await access.verify(signed.token, 'control'), undefined)
    assert.equal(await access.verify(`${signed.token}x`, 'frame'), undefined)
    now = 1501
    assert.equal(await access.verify(signed.token, 'frame'), undefined)
  })

  test('accepts only loopback peers, loopback Host, and same-origin browsers', async () => {
    const { isLoopbackAddress, isTrustedRequest } = await import('../src/stream-access.ts')

    assert.equal(isLoopbackAddress('127.0.0.1'), true)
    assert.equal(isLoopbackAddress('::1'), true)
    assert.equal(isLoopbackAddress('192.168.1.2'), false)
    const request = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
    }
    assert.equal(isTrustedRequest(request, true), true)
    assert.equal(isTrustedRequest({ ...request, headers: { ...request.headers, host: 'evil.test' } }, true), false)
    assert.equal(isTrustedRequest({ ...request, headers: { ...request.headers, 'sec-fetch-site': 'cross-site' } }, true), false)
  })

  test('serves only regular files contained in the screenshot root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-harmony-route-'))
    const outside = join(root, '..', `outside-${Date.now()}.png`)
    try {
      await mkdir(join(root, 'device'), { recursive: true })
      const inside = join(root, 'device', 'frame.png')
      const linked = join(root, 'device', 'linked.png')
      await writeFile(inside, 'png')
      await writeFile(outside, 'secret')
      await symlink(outside, linked)
      const { openContainedFile } = await import('../src/stream-access.ts')

      assert.equal((await openContainedFile(root, inside))?.toString(), 'png')
      assert.equal(await openContainedFile(root, outside), undefined)
      assert.equal(await openContainedFile(root, linked), undefined)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { force: true })
    }
  })
})
