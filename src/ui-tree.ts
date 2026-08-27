export interface HarmonyBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface HarmonyUiNode {
  index: number
  depth: number
  id?: string
  accessibilityId?: string
  key?: string
  type?: string
  text?: string
  description?: string
  hint?: string
  bundleName?: string
  abilityName?: string
  bounds: HarmonyBounds
  enabled: boolean
  clickable: boolean
  visible: boolean
  scrollable: boolean
  parentIndex?: number
}

interface RawUiNode {
  attributes?: Record<string, unknown>
  children?: unknown
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return fallback
}

export function parseBounds(value: unknown): HarmonyBounds {
  const match = typeof value === 'string'
    ? value.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/u)
    : null
  if (match === null) return { x: 0, y: 0, width: 0, height: 0 }
  const [, left, top, right, bottom] = match.map(Number)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

export function flattenUiTree(
  root: unknown,
  options: { maxDepth?: number; maxNodes?: number } = {},
): { nodes: HarmonyUiNode[]; truncated: boolean } {
  const maxDepth = options.maxDepth ?? 40
  const maxNodes = options.maxNodes ?? 1000
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 100) {
    throw new RangeError('maxDepth must be between 0 and 100')
  }
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 5000) {
    throw new RangeError('maxNodes must be between 1 and 5000')
  }

  const nodes: HarmonyUiNode[] = []
  let truncated = false
  const visit = (value: unknown, depth: number, parentIndex?: number): void => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return
    if (nodes.length >= maxNodes) {
      truncated = true
      return
    }
    const raw = value as RawUiNode
    const attributes = raw.attributes ?? {}
    const index = nodes.length
    nodes.push({
      index,
      depth,
      ...(stringValue(attributes.id) === undefined ? {} : { id: stringValue(attributes.id) }),
      ...(stringValue(attributes.accessibilityId) === undefined
        ? {}
        : { accessibilityId: stringValue(attributes.accessibilityId) }),
      ...(stringValue(attributes.key) === undefined ? {} : { key: stringValue(attributes.key) }),
      ...(stringValue(attributes.type) === undefined ? {} : { type: stringValue(attributes.type) }),
      ...(stringValue(attributes.text) === undefined ? {} : { text: stringValue(attributes.text) }),
      ...(stringValue(attributes.description) === undefined
        ? {}
        : { description: stringValue(attributes.description) }),
      ...(stringValue(attributes.hint) === undefined ? {} : { hint: stringValue(attributes.hint) }),
      ...(stringValue(attributes.bundleName) === undefined
        ? {}
        : { bundleName: stringValue(attributes.bundleName) }),
      ...(stringValue(attributes.abilityName) === undefined
        ? {}
        : { abilityName: stringValue(attributes.abilityName) }),
      bounds: parseBounds(attributes.bounds),
      enabled: booleanValue(attributes.enabled, true),
      clickable: booleanValue(attributes.clickable, false),
      visible: booleanValue(attributes.visible, true),
      scrollable: booleanValue(attributes.scrollable, false),
      ...(parentIndex === undefined ? {} : { parentIndex }),
    })
    const children = Array.isArray(raw.children)
      ? raw.children
      : typeof raw.children === 'object' && raw.children !== null
        ? Object.values(raw.children)
        : []
    if (children.length > 0 && depth >= maxDepth) {
      truncated = true
      return
    }
    for (const child of children) visit(child, depth + 1, index)
  }
  visit(root, 0)
  return { nodes, truncated }
}

export interface HarmonyNodeQuery {
  resourceId?: string
  text?: string
}

function candidatesFor(node: HarmonyUiNode, query: HarmonyNodeQuery): string[] {
  if (query.resourceId !== undefined) {
    return [node.id, node.accessibilityId, node.key].filter((value): value is string => value !== undefined)
  }
  return [node.text, node.description, node.hint].filter((value): value is string => value !== undefined)
}

export function findUniqueNode(
  nodes: readonly HarmonyUiNode[],
  query: HarmonyNodeQuery,
): HarmonyUiNode {
  const needle = (query.resourceId ?? query.text)?.trim()
  if (needle === undefined || needle === '') throw new TypeError('Element query requires resourceId or text')
  const exact = nodes.filter(node => candidatesFor(node, query).some(value => value === needle))
  const matches = exact.length > 0
    ? exact
    : nodes.filter(node => candidatesFor(node, query)
      .some(value => value.toLocaleLowerCase().includes(needle.toLocaleLowerCase())))
  if (matches.length === 0) throw new Error(`UI element ${JSON.stringify(needle)} was not found`)
  if (matches.length > 1) throw new Error(`UI element ${JSON.stringify(needle)} is ambiguous (${matches.length} matches)`)
  return matches[0]
}

export function assertTappable(node: HarmonyUiNode): void {
  if (!node.enabled) throw new Error('Refusing to tap a disabled UI element')
  if (!node.visible) throw new Error('Refusing to tap an invisible UI element')
  if (node.bounds.width < 1 || node.bounds.height < 1) {
    throw new Error('Refusing to tap an element with invalid bounds')
  }
}

