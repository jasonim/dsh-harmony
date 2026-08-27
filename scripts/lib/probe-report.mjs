import { classifyUiTestCapabilities, parseHdcTargets } from './probe-core.mjs'
import {
  ProbeProcessError,
  extractUiTestVersion,
  publicTarget,
  resolveTarget,
  runProcess,
} from './probe-runner.mjs'

const DEFAULT_COMMAND_OPTIONS = Object.freeze({ timeoutMs: 10_000, maxBytes: 256 * 1024 })

function hdcVersionOf(output) {
  return String(output ?? '').match(/\bVer:\s*([^\s,]+)/u)?.[1]
}

function commandSucceeded(result) {
  return result.exitCode === 0 && result.signal === null
}

function commandListed(output, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'u').test(String(output ?? ''))
}

async function executeHdc(execute, hdcBinary, args, options = DEFAULT_COMMAND_OPTIONS) {
  return execute(hdcBinary, args, options)
}

async function inventory({ hdcBinary, execute }) {
  const [versionResult, targetsResult] = await Promise.all([
    executeHdc(execute, hdcBinary, ['-v']),
    executeHdc(execute, hdcBinary, ['list', 'targets', '-v']),
  ])
  if (!commandSucceeded(versionResult)) {
    throw new ProbeProcessError('HDC_VERSION_FAILED', 'Unable to read the HDC version')
  }
  if (!commandSucceeded(targetsResult)) {
    throw new ProbeProcessError('HDC_LIST_FAILED', 'Unable to list HDC targets')
  }

  return {
    hdcVersion: hdcVersionOf(versionResult.stdout),
    targets: parseHdcTargets(targetsResult.stdout),
  }
}

export async function runListProbe({ hdcBinary, execute = runProcess }) {
  const { hdcVersion, targets } = await inventory({ hdcBinary, execute })
  return {
    schemaVersion: 1,
    mode: 'list',
    generatedAt: new Date().toISOString(),
    host: { hdcVersion },
    deviceCount: targets.length,
    devices: targets.map(publicTarget),
  }
}

function unavailableArtifact(code) {
  return { available: false, reason: { code } }
}

async function safeArtifactProbe(probe, context, failureCode) {
  if (typeof probe !== 'function') return unavailableArtifact('PROBE_NOT_CONFIGURED')
  try {
    return await probe(context)
  } catch (error) {
    return unavailableArtifact(error instanceof ProbeProcessError ? error.code : failureCode)
  }
}

async function uiTestReport({ hdcBinary, execute, target }) {
  const prefix = ['-t', target.connectKey, 'shell', 'uitest']
  const versionResult = await executeHdc(execute, hdcBinary, [...prefix, '--version'])
  if (!commandSucceeded(versionResult)) {
    return {
      available: false,
      reason: { code: 'UITEST_VERSION_FAILED' },
      capabilities: classifyUiTestCapabilities(undefined),
      commands: {},
    }
  }

  const version = extractUiTestVersion(versionResult.stdout)
  if (!version) {
    return {
      available: false,
      reason: { code: 'UITEST_VERSION_UNPARSEABLE' },
      capabilities: classifyUiTestCapabilities(undefined),
      commands: {},
    }
  }

  const [helpResult, inputHelpResult] = await Promise.all([
    executeHdc(execute, hdcBinary, [...prefix, 'help']),
    executeHdc(execute, hdcBinary, [...prefix, 'uiInput', 'help']),
  ])
  const help = commandSucceeded(helpResult) ? helpResult.stdout : ''
  const inputHelp = commandSucceeded(inputHelpResult) ? inputHelpResult.stdout : ''
  const capabilities = classifyUiTestCapabilities(version)

  return {
    available: true,
    version,
    capabilities,
    commands: {
      screenCap: commandListed(help, 'screenCap'),
      dumpLayout: commandListed(help, 'dumpLayout'),
      uiInput: commandListed(help, 'uiInput'),
      click: commandListed(inputHelp, 'click'),
      swipe: commandListed(inputHelp, 'swipe'),
      drag: commandListed(inputHelp, 'drag'),
      inputText: commandListed(inputHelp, 'inputText'),
      focusedText: commandListed(inputHelp, 'text'),
      keyEvent: commandListed(inputHelp, 'keyEvent'),
    },
  }
}

export async function runDeviceProbe({
  hdcBinary,
  reference,
  execute = runProcess,
  screenshotProbe,
  treeProbe,
}) {
  const { hdcVersion, targets } = await inventory({ hdcBinary, execute })
  const target = resolveTarget(targets, reference)
  const context = { hdcBinary, execute, target }
  const uiTest = await uiTestReport(context)
  const [screenshot, uiTree] = await Promise.all([
    safeArtifactProbe(screenshotProbe, context, 'SCREENSHOT_PROBE_FAILED'),
    safeArtifactProbe(treeProbe, context, 'UI_TREE_PROBE_FAILED'),
  ])

  return {
    schemaVersion: 1,
    mode: 'all',
    generatedAt: new Date().toISOString(),
    host: { hdcVersion },
    device: publicTarget(target),
    uiTest,
    screenshot,
    uiTree,
  }
}
