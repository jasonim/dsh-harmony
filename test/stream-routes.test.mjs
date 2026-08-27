import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

function miniServer() {
  const exact = new Map()
  const prefixes = new Map()
  const server = http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://local').pathname
    let route = exact.get(path)
    if (!route) route = [...prefixes].find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1]
    if (!route) return response.writeHead(404).end()
    Promise.resolve(route.handler(request, response)).catch(() => response.writeHead(500).end())
  })
  return {
    server,
    register(route) {
      const map = route.kind === 'exact' ? exact : prefixes
      map.set(route.path, route)
      return () => map.delete(route.path)
    },
  }
}

test('signed frame routes grant, capture, serve, and control a device', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-harmony-routes-'))
  await mkdir(join(root, 'device-abcdef123456'), { recursive: true })
  const path = join(root, 'device-abcdef123456', 'frame.png')
  await writeFile(path, 'png-bytes')
  const calls = []
  const frame = { id: 'frame-1', device: 'device-abcdef123456', path, width: 100, height: 200 }
  const runtime = {
    latestFrame: () => frame,
    async execute(name, args) {
      calls.push({ name, args })
      if (name === 'harmony_devices') return { count: 1, ready: ['device-abcdef123456'] }
      if (name === 'harmony_screenshot') return { frameId: 'frame-1', width: 100, height: 200 }
      if (name === 'harmony_interact') return { action: args.action, frame: { frameId: 'frame-2' } }
      throw new Error('unexpected tool')
    },
  }
  const { StreamAccessController } = await import('../src/stream-access.ts')
  const { HarmonyStreamRoutes, mountStreamRoutes } = await import('../src/stream-routes.ts')
  const access = new StreamAccessController({ key: async () => Buffer.alloc(32, 9) })
  const carrier = miniServer()
  const routes = new HarmonyStreamRoutes(runtime, access, { screenshotRoot: root })
  const dispose = mountStreamRoutes(carrier, routes)
  await new Promise(resolve => carrier.server.listen(0, '127.0.0.1', resolve))
  const address = carrier.server.address()
  const origin = `http://localhost:${address.port}`
  const headers = { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
  try {
    const grantResponse = await fetch(`${origin}/_dsh/dsh-harmony/grant`, {
      method: 'POST', headers, body: JSON.stringify({ device: 'device-abcdef123456', session: 'session-1' }),
    })
    assert.equal(grantResponse.status, 200)
    const grant = await grantResponse.json()

    const capture = await fetch(`${origin}${grant.captureUrl}`, {
      method: 'POST', headers, body: '{}',
    })
    assert.equal(capture.status, 200)
    const image = await fetch(`${origin}${grant.frameUrl}`, { headers: { 'sec-fetch-site': 'same-origin' } })
    assert.equal(await image.text(), 'png-bytes')
    const control = await fetch(`${origin}${grant.controlUrl}`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'tap', frameId: 'frame-1', x: 0.5, y: 0.5 }),
    })
    assert.equal(control.status, 200)
    assert.ok(calls.some(call => call.name === 'harmony_interact'))
  } finally {
    dispose()
    await new Promise(resolve => carrier.server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

