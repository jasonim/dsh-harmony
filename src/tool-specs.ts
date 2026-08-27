import { HARMONY_TOOL_NAMES, type HarmonyToolName } from './contracts.ts'

export interface ToolRuntime {
  execute(name: HarmonyToolName, args: Record<string, unknown>): Promise<unknown>
}

export interface HarmonyToolSpec {
  name: HarmonyToolName
  description: string
  write: boolean
  timeoutMs: number
  parameters: {
    type: 'object'
    additionalProperties: false
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
  execute(args: Record<string, unknown>): Promise<unknown>
}

const device = {
  type: 'string',
  description: 'Redacted device id returned by harmony_devices; required when multiple devices are connected.',
}

function schema(
  properties: Record<string, Record<string, unknown>> = {},
  required: string[] = [],
): HarmonyToolSpec['parameters'] {
  return { type: 'object', additionalProperties: false, properties, required }
}

interface Definition {
  description: string
  write?: boolean
  timeoutMs?: number
  parameters?: HarmonyToolSpec['parameters']
}

const definitions: Record<HarmonyToolName, Definition> = {
  harmony_devices: {
    description: 'List HDC targets with redacted identities and connection facts; only USB Connected devices are actionable.',
  },
  harmony_capabilities: {
    description: 'Report HDC and UiTest feature availability for one USB device, including structured degradation reasons.',
    parameters: schema({ device }),
  },
  harmony_build: {
    description: 'Build one explicit HarmonyOS project, module, product, and target with Hvigor without installing the result.',
    write: true,
    timeoutMs: 900_000,
    parameters: schema({
      projectPath: { type: 'string' }, module: { type: 'string' }, product: { type: 'string' },
      target: { type: 'string' }, mode: { type: 'string', enum: ['debug', 'release'], default: 'debug' },
    }, ['projectPath']),
  },
  harmony_install: {
    description: 'Install one validated HAP on an explicitly selected USB device; replacement is disabled unless requested.',
    write: true,
    timeoutMs: 300_000,
    parameters: schema({ device, hapPath: { type: 'string' }, replace: { type: 'boolean', default: false } }, ['hapPath']),
  },
  harmony_launch: {
    description: 'Launch an explicit HarmonyOS bundle and ability on the selected USB device, optionally stopping it first.',
    write: true,
    parameters: schema({ device, bundle: { type: 'string' }, ability: { type: 'string' }, relaunch: { type: 'boolean', default: false } }, ['bundle', 'ability']),
  },
  harmony_list_apps: {
    description: 'List installed HarmonyOS bundles with bounded output and an optional case-insensitive filter.',
    parameters: schema({ device, query: { type: 'string' } }),
  },
  harmony_screenshot: {
    description: 'Capture a fresh PNG frame into the plugin cache and return its frame identity, size, and dimensions.',
    parameters: schema({ device }),
  },
  harmony_interact: {
    description: 'Perform a frame-bound tap, drag, scroll, safe key event, or focused text input and return a fresh effect frame.',
    write: true,
    parameters: schema({
      device,
      action: { type: 'string', enum: ['tap', 'doubleTap', 'longPress', 'drag', 'scroll', 'button', 'text'] },
      frameId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      fromX: { type: 'number' }, fromY: { type: 'number' }, toX: { type: 'number' }, toY: { type: 'number' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      velocity: { type: 'number' }, name: { type: 'string', enum: ['back', 'home', 'power'] }, text: { type: 'string' },
    }, ['action']),
  },
  harmony_logs: {
    description: 'Read a bounded HiLog snapshot or bounded-duration follow stream, optionally filtered by bundle, pid, or text.',
    timeoutMs: 120_000,
    parameters: schema({ device, mode: { type: 'string', enum: ['snapshot', 'follow'], default: 'snapshot' }, bundle: { type: 'string' }, pid: { type: 'integer' }, grep: { type: 'string' }, durationSeconds: { type: 'integer', minimum: 1, maximum: 60 } }),
  },
  harmony_find_text: {
    description: 'Run local OCR over the current frame and return bounded text matches with confidence and pixel rectangles.',
    parameters: schema({ device, query: { type: 'string' }, minConfidence: { type: 'number', minimum: 0, maximum: 1 } }),
  },
  harmony_tap_text: {
    description: 'OCR the current frame and tap only one unambiguous text match, then capture the resulting frame.',
    write: true,
    parameters: schema({ device, query: { type: 'string' }, frameId: { type: 'string' }, minConfidence: { type: 'number' } }, ['query', 'frameId']),
  },
  harmony_wait_for: {
    description: 'Poll the bounded screenshot and OCR pipeline until text appears or disappears, or a timeout expires.',
    timeoutMs: 90_000,
    parameters: schema({ device, text: { type: 'string' }, mode: { type: 'string', enum: ['appear', 'disappear'], default: 'appear' }, timeoutMs: { type: 'integer', minimum: 100, maximum: 60000 } }, ['text']),
  },
  harmony_ui_tree: {
    description: 'Dump the foreground HarmonyOS accessibility tree as bounded, normalized nodes with stable identities and bounds.',
    parameters: schema({ device, maxDepth: { type: 'integer', minimum: 0, maximum: 100 }, filter: { type: 'string' } }),
  },
  harmony_tap_element: {
    description: 'Resolve exactly one UI-tree element by resource identity or text, refuse ambiguity, and tap its center.',
    write: true,
    parameters: schema({ device, resourceId: { type: 'string' }, text: { type: 'string' }, frameId: { type: 'string' } }, ['frameId']),
  },
  harmony_ui_rows: {
    description: 'Extract visible repeated list rows from a fresh UI tree with indices, aggregate descendant labels, and bounds.',
    parameters: schema({ device, maxDepth: { type: 'integer', minimum: 0, maximum: 100 } }),
  },
  harmony_tap_row: {
    description: 'Re-read list rows and tap a bounded relative point in one explicit row index without clamping mistakes.',
    write: true,
    parameters: schema({ device, index: { type: 'integer', minimum: 0 }, frameId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, ['index', 'frameId']),
  },
  harmony_app_info: {
    description: 'Return bounded installed-application facts for one explicit HarmonyOS bundle without changing device state.',
    parameters: schema({ device, bundle: { type: 'string' } }, ['bundle']),
  },
  harmony_processes: {
    description: 'List running HarmonyOS processes with bounded output and an optional case-insensitive name filter.',
    parameters: schema({ device, filter: { type: 'string' } }),
  },
}

export function createHarmonyToolSpecs(runtime: ToolRuntime): HarmonyToolSpec[] {
  return HARMONY_TOOL_NAMES.map(name => {
    const definition = definitions[name]
    return {
      name,
      description: definition.description,
      write: definition.write ?? false,
      timeoutMs: definition.timeoutMs ?? 120_000,
      parameters: definition.parameters ?? schema(),
      execute: args => runtime.execute(name, args),
    }
  })
}
