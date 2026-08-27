#!/usr/bin/env node

import { parseCliArgs } from './lib/probe-core.mjs'
import { probeScreenshotArtifact, probeTreeArtifact } from './lib/probe-artifacts.mjs'
import { runDeviceProbe, runListProbe, runSoakProbe } from './lib/probe-report.mjs'
import { ProbeProcessError, resolveHdcBinary } from './lib/probe-runner.mjs'

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function sanitizedError(error) {
  if (error instanceof TypeError || error instanceof RangeError) {
    return {
      schemaVersion: 1,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'Probe request was rejected',
      },
    }
  }
  if (error instanceof ProbeProcessError) {
    return {
      schemaVersion: 1,
      error: {
        code: error.code,
        message: 'Probe could not complete',
      },
    }
  }
  return {
    schemaVersion: 1,
    error: {
      code: 'PROBE_FAILED',
      message: 'Probe could not complete',
    },
  }
}

async function main() {
  const request = parseCliArgs(process.argv.slice(2))
  const hdcBinary = resolveHdcBinary()
  if (request.mode === 'list') return runListProbe({ hdcBinary })
  if (request.mode === 'all') {
    return runDeviceProbe({
      hdcBinary,
      reference: request.device,
      screenshotProbe: probeScreenshotArtifact,
      treeProbe: probeTreeArtifact,
    })
  }
  return runSoakProbe({
    hdcBinary,
    reference: request.device,
    iterations: request.soak,
    screenshotProbe: probeScreenshotArtifact,
  })
}

try {
  printJson(await main())
} catch (error) {
  printJson(sanitizedError(error))
  process.exitCode = 1
}
