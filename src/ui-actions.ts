export interface HarmonyFrameReference {
  id: string
  width: number
  height: number
  orientation: string
}

export type HarmonyUiAction =
  | { action: 'tap' | 'doubleTap' | 'longPress'; frameId: string; x: number; y: number }
  | {
    action: 'drag'
    frameId: string
    fromX: number
    fromY: number
    toX: number
    toY: number
    velocity?: number
  }
  | {
    action: 'scroll'
    frameId: string
    direction: 'up' | 'down' | 'left' | 'right'
    velocity?: number
  }
  | { action: 'button'; name: 'back' | 'home' | 'power' }
  | { action: 'text'; text: string }

const BUTTONS = Object.freeze({
  back: 'Back',
  home: 'Home',
  power: 'Power',
})

function normalized(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('UiTest coordinates must be normalized between 0 and 1')
  }
  return value
}

function pixel(value: number, size: number): string {
  return String(Math.round(normalized(value) * size))
}

function requireFrame(frameId: string, frame: HarmonyFrameReference): void {
  if (frameId !== frame.id) {
    throw new Error(`Refusing action for stale frame ${frameId}; current frame is ${frame.id}`)
  }
  if (!Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height)
    || frame.width < 1 || frame.height < 1) {
    throw new TypeError('Current frame dimensions are invalid')
  }
}

function velocity(value?: number): string {
  const candidate = value ?? 600
  if (!Number.isFinite(candidate) || candidate < 200 || candidate > 40_000) {
    throw new RangeError('UiTest velocity must be between 200 and 40000')
  }
  return String(Math.round(candidate))
}

function textArgument(text: string): string {
  if (typeof text !== 'string' || text.length === 0 || text.length > 4096 || text.includes('\0')) {
    throw new TypeError('UiTest received invalid text')
  }
  return text
}

export function buildUiInputCommand(
  action: HarmonyUiAction,
  frame: HarmonyFrameReference,
): string[] {
  const prefix = ['shell', 'uitest', 'uiInput']
  if (action.action === 'button') {
    const key = (BUTTONS as Readonly<Record<string, string>>)[action.name]
    if (key === undefined) throw new TypeError(`UiTest received unknown button ${String(action.name)}`)
    return [...prefix, 'keyEvent', key]
  }
  if (action.action === 'text') return [...prefix, 'text', textArgument(action.text)]

  requireFrame(action.frameId, frame)
  if (action.action === 'tap' || action.action === 'doubleTap' || action.action === 'longPress') {
    const command = action.action === 'tap'
      ? 'click'
      : action.action === 'doubleTap'
        ? 'doubleClick'
        : 'longClick'
    return [...prefix, command, pixel(action.x, frame.width), pixel(action.y, frame.height)]
  }
  if (action.action === 'drag') {
    return [
      ...prefix,
      'drag',
      pixel(action.fromX, frame.width),
      pixel(action.fromY, frame.height),
      pixel(action.toX, frame.width),
      pixel(action.toY, frame.height),
      velocity(action.velocity),
    ]
  }

  const paths = {
    down: [0.5, 0.75, 0.5, 0.25],
    up: [0.5, 0.25, 0.5, 0.75],
    right: [0.75, 0.5, 0.25, 0.5],
    left: [0.25, 0.5, 0.75, 0.5],
  } as const
  const path = paths[action.direction]
  if (path === undefined) throw new TypeError(`UiTest received unknown scroll direction ${String(action.direction)}`)
  return [
    ...prefix,
    'swipe',
    pixel(path[0], frame.width),
    pixel(path[1], frame.height),
    pixel(path[2], frame.width),
    pixel(path[3], frame.height),
    velocity(action.velocity),
  ]
}
