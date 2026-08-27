import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  classifyUiTestCapabilities,
  deviceHash,
  parseCliArgs,
  parseHdcTargets,
  summarizeDurations,
} from '../scripts/lib/probe-core.mjs'

describe('parseHdcTargets', () => {
  it('parses verbose USB, TCP, unauthorized, and offline target rows', () => {
    const output = [
      'FMR0223C13000657 USB Connected HUAWEI_Pura hdc',
      '192.168.1.20:5555 TCP Offline localhost hdc',
      'ABCDEF0123456789 Unauthorized',
    ].join('\n')

    assert.deepEqual(parseHdcTargets(output), [
      {
        connectKey: 'FMR0223C13000657',
        transport: 'USB',
        state: 'Connected',
        name: 'HUAWEI_Pura',
        daemon: 'hdc',
      },
      {
        connectKey: '192.168.1.20:5555',
        transport: 'TCP',
        state: 'Offline',
        name: 'localhost',
        daemon: 'hdc',
      },
      {
        connectKey: 'ABCDEF0123456789',
        transport: 'Unknown',
        state: 'Unauthorized',
        name: undefined,
        daemon: undefined,
      },
    ])
  })

  it('treats empty markers and blank output as no targets', () => {
    assert.deepEqual(parseHdcTargets(''), [])
    assert.deepEqual(parseHdcTargets('[Empty]\n'), [])
  })

  it('parses non-verbose target output without inventing readiness', () => {
    assert.deepEqual(parseHdcTargets('FMR0223C13000657\n'), [
      {
        connectKey: 'FMR0223C13000657',
        transport: 'Unknown',
        state: 'Unknown',
        name: undefined,
        daemon: undefined,
      },
    ])
  })
})

describe('classifyUiTestCapabilities', () => {
  it('gates shell input at 4.1.2 and bundle-filtered trees at 5.1.1.2', () => {
    assert.deepEqual(classifyUiTestCapabilities('4.1.1.1'), {
      version: '4.1.1.1',
      screenshot: true,
      dumpLayout: true,
      shellInput: false,
      richTree: false,
      bundleFilteredTree: false,
      focusedTextInput: false,
    })

    assert.equal(classifyUiTestCapabilities('4.1.2.0').shellInput, true)
    assert.equal(classifyUiTestCapabilities('4.1.4.0').richTree, true)
    assert.equal(classifyUiTestCapabilities('5.1.1.1').focusedTextInput, true)
    assert.equal(classifyUiTestCapabilities('5.1.1.2').bundleFilteredTree, true)
  })

  it('returns conservative capabilities for missing or malformed versions', () => {
    assert.deepEqual(classifyUiTestCapabilities('not-a-version'), {
      version: undefined,
      screenshot: false,
      dumpLayout: false,
      shellInput: false,
      richTree: false,
      bundleFilteredTree: false,
      focusedTextInput: false,
    })
  })
})

describe('parseCliArgs', () => {
  it('supports read-only list, full probe, and screenshot soak modes', () => {
    assert.deepEqual(parseCliArgs(['--list']), {
      mode: 'list',
      device: undefined,
      soak: 0,
      json: true,
    })
    assert.deepEqual(parseCliArgs(['--device', 'abc', '--all']), {
      mode: 'all',
      device: 'abc',
      soak: 0,
      json: true,
    })
    assert.deepEqual(parseCliArgs(['--device', 'abc', '--soak', '25']), {
      mode: 'soak',
      device: 'abc',
      soak: 25,
      json: true,
    })
  })

  it('rejects ambiguous, mutating, and unbounded options', () => {
    assert.throws(() => parseCliArgs([]), /exactly one mode/i)
    assert.throws(() => parseCliArgs(['--list', '--all']), /exactly one mode/i)
    assert.throws(() => parseCliArgs(['--all']), /requires --device/i)
    assert.throws(() => parseCliArgs(['--device', 'abc', '--soak', '0']), /between 1 and 500/i)
    assert.throws(() => parseCliArgs(['--device', 'abc', '--tap', '1', '1']), /unknown option/i)
  })
})

describe('safe reporting helpers', () => {
  it('creates stable non-reversible display ids without returning the connect key', () => {
    const first = deviceHash('FMR0223C13000657')
    const second = deviceHash('FMR0223C13000657')

    assert.match(first, /^device-[a-f0-9]{12}$/)
    assert.equal(first, second)
    assert.equal(first.includes('FMR0223C13000657'), false)
  })

  it('summarizes duration samples with deterministic nearest-rank percentiles', () => {
    assert.deepEqual(summarizeDurations([10, 30, 20, 40]), {
      count: 4,
      minMs: 10,
      maxMs: 40,
      meanMs: 25,
      p50Ms: 20,
      p95Ms: 40,
    })
    assert.deepEqual(summarizeDurations([]), {
      count: 0,
      minMs: undefined,
      maxMs: undefined,
      meanMs: undefined,
      p50Ms: undefined,
      p95Ms: undefined,
    })
  })
})
