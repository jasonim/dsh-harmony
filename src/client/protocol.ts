export interface HarmonyPanelSource {
  device: string
  frameId: string
  width?: number
  height?: number
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseHarmonyResult(block: unknown): HarmonyPanelSource | undefined {
  if (!record(block) || block.kind !== 'tool-result' || block.isError === true || !Array.isArray(block.content)) return undefined
  for (const item of block.content) {
    if (!record(item) || item.type !== 'text' || typeof item.text !== 'string') continue
    let value: unknown
    try {
      value = JSON.parse(item.text)
    } catch {
      continue
    }
    if (!record(value)) continue
    const candidate = record(value.frame) ? value.frame : value
    if (typeof candidate.device !== 'string' || !/^device-[a-f0-9]{12}$/u.test(candidate.device)) continue
    if (typeof candidate.frameId !== 'string' || !/^frame-\d+$/u.test(candidate.frameId)) continue
    return {
      device: candidate.device,
      frameId: candidate.frameId,
      ...(typeof candidate.width === 'number' ? { width: candidate.width } : {}),
      ...(typeof candidate.height === 'number' ? { height: candidate.height } : {}),
    }
  }
  return undefined
}

export function normalizedPoint(
  point: { clientX: number; clientY: number },
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) throw new RangeError('image rectangle must be positive')
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  return {
    x: clamp((point.clientX - rect.left) / rect.width),
    y: clamp((point.clientY - rect.top) / rect.height),
  }
}

export function containedImageRect(
  rect: { left: number; top: number; width: number; height: number },
  naturalWidth?: number,
  naturalHeight?: number,
): { left: number; top: number; width: number; height: number } {
  if (
    typeof naturalWidth !== 'number' || typeof naturalHeight !== 'number'
    || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)
    || naturalWidth <= 0 || naturalHeight <= 0 || rect.width <= 0 || rect.height <= 0
  ) return rect

  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const width = naturalWidth * scale
  const height = naturalHeight * scale
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  }
}

export function grantNeedsRefresh(expiresAt: number, now = Date.now(), skewMs = 5_000): boolean {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || !Number.isFinite(skewMs) || skewMs < 0) return true
  return expiresAt - now <= skewMs
}
