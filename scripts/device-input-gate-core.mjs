export const HARNESS_BUNDLE = 'com.deepseek.dsh.harness'
export const HARNESS_ABILITY = 'EntryAbility'

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`)
  return value
}

export function centerOf(rect) {
  if (rect === null || typeof rect !== 'object') throw new TypeError('bounds are required')
  const x = finite(rect.x, 'x')
  const y = finite(rect.y, 'y')
  const width = finite(rect.width, 'width')
  const height = finite(rect.height, 'height')
  if (width < 1 || height < 1) throw new RangeError('bounds must have a positive area')
  return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }
}

export function assertHarnessForeground(nodes) {
  if (!Array.isArray(nodes)) throw new TypeError('UI nodes are required')
  const rootBundle = nodes.find(node => typeof node?.bundleName === 'string')?.bundleName
  if (rootBundle !== HARNESS_BUNDLE) {
    throw new Error('Refusing input gate because the deterministic harness is not foreground')
  }
}

function boundedPoint(point, screen) {
  return {
    x: Math.max(0, Math.min(Math.round(screen.width) - 1, Math.round(point.x))),
    y: Math.max(0, Math.min(Math.round(screen.height) - 1, Math.round(point.y))),
  }
}

export function deterministicInputPlan(screen, targets) {
  finite(screen?.width, 'screen width')
  finite(screen?.height, 'screen height')
  if (screen.width < 1 || screen.height < 1) throw new RangeError('screen dimensions must be positive')
  const click = boundedPoint(centerOf(targets.click), screen)
  const input = boundedPoint(centerOf(targets.input), screen)
  const list = targets.list
  const from = boundedPoint({ x: list.x + list.width / 2, y: list.y + list.height * 0.75 }, screen)
  const to = boundedPoint({ x: list.x + list.width / 2, y: list.y + list.height * 0.25 }, screen)
  return [
    ...Array.from({ length: 30 }, () => ({ kind: 'click', ...click })),
    ...Array.from({ length: 10 }, () => ({ kind: 'swipe', from, to, velocity: 600 })),
    { kind: 'focus', ...input },
    ...Array.from({ length: 10 }, () => ({ kind: 'text', text: 'x' })),
    { kind: 'back' },
  ]
}

