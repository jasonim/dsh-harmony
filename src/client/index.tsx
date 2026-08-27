import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { normalizedPoint, parseHarmonyResult } from './protocol.ts'

export const name = 'dsh-harmony-client'
const GRANT_PATH = '/_dsh/dsh-harmony/grant'
const REFRESH_MS = 1100

interface Grant {
  frameUrl: string
  captureUrl: string
  controlUrl: string
  expiresAt: number
}

function HarmonyDeviceCard(props: ToolCallViewProps): React.JSX.Element {
  const source = useMemo(() => parseHarmonyResult(props.block), [props.block])
  const [open, setOpen] = useState(false)
  const [grant, setGrant] = useState<Grant>()
  const [frameId, setFrameId] = useState(source?.frameId)
  const [imageUrl, setImageUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const pointer = useRef<{ x: number; y: number }>()

  useEffect(() => {
    if (!open || source === undefined) return
    let active = true
    void fetch(GRANT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device: source.device,
        session: String(props.sessionId ?? props.callId ?? 'conversation'),
      }),
    }).then(async response => {
      if (!response.ok) throw new Error(`grant failed (${response.status})`)
      return response.json() as Promise<Grant>
    }).then(value => {
      if (active) setGrant(value)
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [open, props.callId, props.sessionId, source])

  useEffect(() => {
    if (!open || grant === undefined) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const capture = async (): Promise<void> => {
      try {
        const response = await fetch(grant.captureUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        })
        if (!response.ok) throw new Error(`capture failed (${response.status})`)
        const value = await response.json() as { frame?: { frameId?: string } }
        if (!active) return
        if (typeof value.frame?.frameId === 'string') setFrameId(value.frame.frameId)
        setImageUrl(`${grant.frameUrl}?v=${Date.now()}`)
        setError(undefined)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (active) timer = setTimeout(() => { void capture() }, REFRESH_MS)
      }
    }
    void capture()
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [grant, open])

  const control = async (payload: Record<string, unknown>): Promise<void> => {
    if (grant === undefined) return
    const response = await fetch(grant.controlUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (!response.ok) setError(`control failed (${response.status})`)
  }

  if (source === undefined) return <div style={{ padding: 10, color: '#8b949e' }}>HarmonyOS tool result</div>
  return (
    <div style={{ padding: 10, border: '1px solid rgba(127,127,127,.25)', borderRadius: 10 }}>
      <button type="button" onClick={() => setOpen(true)} style={{ cursor: 'pointer' }}>
        打开 HarmonyOS 真机 · {source.device}
      </button>
      {open ? (
        <aside style={{
          position: 'fixed', zIndex: 2147483000, right: 0, top: 0, bottom: 0,
          width: 'min(420px, 92vw)', background: '#11151a', color: '#f0f3f6',
          borderLeft: '1px solid #30363d', boxShadow: '-12px 0 30px rgba(0,0,0,.35)',
          display: 'flex', flexDirection: 'column', padding: 12,
        }}>
          <header style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ flex: 1 }}>HarmonyOS · {source.device}</strong>
            <button type="button" onClick={() => { void control({ action: 'button', name: 'back' }) }}>Back</button>
            <button type="button" onClick={() => { void control({ action: 'button', name: 'home' }) }}>Home</button>
            <button type="button" onClick={() => setOpen(false)}>关闭</button>
          </header>
          <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            {imageUrl === undefined ? <span>正在连接真机…</span> : (
              <img
                src={imageUrl}
                alt="HarmonyOS live preview"
                draggable={false}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', touchAction: 'none', userSelect: 'none' }}
                onPointerDown={event => {
                  pointer.current = normalizedPoint(event, event.currentTarget.getBoundingClientRect())
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerUp={event => {
                  const start = pointer.current
                  pointer.current = undefined
                  if (start === undefined || frameId === undefined) return
                  const end = normalizedPoint(event, event.currentTarget.getBoundingClientRect())
                  const distance = Math.hypot(end.x - start.x, end.y - start.y)
                  void control(distance < 0.02
                    ? { action: 'tap', frameId, x: end.x, y: end.y }
                    : { action: 'drag', frameId, fromX: start.x, fromY: start.y, toX: end.x, toY: end.y })
                }}
              />
            )}
          </div>
          <footer style={{ minHeight: 22, color: error === undefined ? '#8b949e' : '#ff7b72', fontSize: 12 }}>
            {error ?? `${source.width ?? '?'}×${source.height ?? '?'} · ${frameId ?? 'waiting'} · ${REFRESH_MS}ms polling`}
          </footer>
        </aside>
      ) : null}
    </div>
  )
}

function registerCard(ctx: ClientContext, toolName: string): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: toolName },
    HarmonyDeviceCard,
  ))
}

export function apply(ctx: ClientContext): void {
  for (const tool of ['harmony_screenshot', 'harmony_interact', 'harmony_tap_element', 'harmony_tap_text', 'harmony_tap_row']) {
    registerCard(ctx, tool)
  }
}

export { normalizedPoint, parseHarmonyResult, type HarmonyPanelSource } from './protocol.ts'
