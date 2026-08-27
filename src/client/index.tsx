import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { harmonyPanelStore, type HarmonyPanelStore } from './panel-store.ts'
import { grantNeedsRefresh, normalizedPoint, parseHarmonyResult, type HarmonyPanelSource } from './protocol.ts'

export const name = 'dsh-harmony-client'
export const inject = ['slots']
const GRANT_PATH = '/_dsh/dsh-harmony/grant'
const REFRESH_MS = 1100
const PANEL_WIDTH = 420
const PANEL_BREAKPOINT = 900

interface Grant {
  frameUrl: string
  captureUrl: string
  controlUrl: string
  expiresAt: number
}

function useHarmonyPanelDock(open: boolean): boolean {
  const [docked, setDocked] = useState(false)

  useLayoutEffect(() => {
    if (!open || window.innerWidth < PANEL_BREAKPOINT) return
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const computedMargin = Number.parseFloat(window.getComputedStyle(appRoot).marginRight)
    if (appRoot.style.marginRight.trim() !== '' || (Number.isFinite(computedMargin) && computedMargin > 0.5)) return

    const previousMarginRight = appRoot.style.marginRight
    const previousMinWidth = appRoot.style.minWidth
    appRoot.style.marginRight = `${PANEL_WIDTH}px`
    appRoot.style.minWidth = '0'
    setDocked(true)
    return () => {
      appRoot.style.marginRight = previousMarginRight
      appRoot.style.minWidth = previousMinWidth
      setDocked(false)
    }
  }, [open])

  return docked
}

function HarmonyLivePanel(props: { source: HarmonyPanelSource; onClose(): void }): React.JSX.Element {
  const { source, onClose } = props
  const [grant, setGrant] = useState<Grant>()
  const [grantEpoch, setGrantEpoch] = useState(0)
  const [frameId, setFrameId] = useState(source.frameId)
  const [imageUrl, setImageUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const pointer = useRef<{ x: number; y: number }>()
  const docked = useHarmonyPanelDock(true)

  useEffect(() => {
    setFrameId(source.frameId)
    setGrant(undefined)
    setImageUrl(undefined)
  }, [source.device, source.frameId])

  useEffect(() => {
    let active = true
    void fetch(GRANT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: source.device, session: `panel:${source.device}` }),
    }).then(async response => {
      if (!response.ok) throw new Error(`grant failed (${response.status})`)
      return response.json() as Promise<Grant>
    }).then(value => {
      if (active) {
        setGrant(value)
        setError(undefined)
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [grantEpoch, source.device])

  useEffect(() => {
    if (grant === undefined) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const capture = async (): Promise<void> => {
      let repeat = true
      try {
        if (grantNeedsRefresh(grant.expiresAt)) {
          repeat = false
          setGrant(undefined)
          setGrantEpoch(value => value + 1)
          return
        }
        const response = await fetch(grant.captureUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        })
        if (response.status === 401) {
          repeat = false
          setGrant(undefined)
          setGrantEpoch(value => value + 1)
          return
        }
        if (!response.ok) throw new Error(`capture failed (${response.status})`)
        const value = await response.json() as { frame?: { frameId?: string } }
        if (!active) return
        if (typeof value.frame?.frameId === 'string') setFrameId(value.frame.frameId)
        setImageUrl(`${grant.frameUrl}?v=${Date.now()}`)
        setError(undefined)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (active && repeat) timer = setTimeout(() => { void capture() }, REFRESH_MS)
      }
    }
    void capture()
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [grant])

  const control = async (payload: Record<string, unknown>): Promise<void> => {
    if (grant === undefined) return
    const response = await fetch(grant.controlUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
    if (response.status === 401) {
      setGrant(undefined)
      setGrantEpoch(value => value + 1)
    } else if (!response.ok) setError(`control failed (${response.status})`)
  }

  return (
    <aside
      data-harmony-panel-surface={docked ? 'docked' : 'overlay'}
      aria-label="HarmonyOS 实时预览"
      style={{
        position: 'fixed', zIndex: 1200, right: 0, top: 0, bottom: 0,
        width: `min(${PANEL_WIDTH}px, 92vw)`, background: '#11151a', color: '#f0f3f6',
        borderLeft: '1px solid #30363d', boxShadow: '-12px 0 30px rgba(0,0,0,.35)',
        display: 'flex', flexDirection: 'column', padding: 12,
      }}
    >
      <header style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <strong style={{ flex: 1 }}>HarmonyOS 实时预览 · {source.device}</strong>
        <button type="button" onClick={() => { void control({ action: 'button', name: 'back' }) }}>Back</button>
        <button type="button" onClick={() => { void control({ action: 'button', name: 'home' }) }}>Home</button>
        <button type="button" onClick={onClose}>关闭</button>
      </header>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {imageUrl === undefined ? <span>正在连接真机…</span> : (
          <img
            src={imageUrl}
            alt="HarmonyOS live preview"
            draggable={false}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'contain', touchAction: 'none', userSelect: 'none',
            }}
            onPointerDown={event => {
              pointer.current = normalizedPoint(event, event.currentTarget.getBoundingClientRect())
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerUp={event => {
              const start = pointer.current
              pointer.current = undefined
              if (start === undefined) return
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
        {error ?? `${source.width ?? '?'}×${source.height ?? '?'} · ${frameId} · ${REFRESH_MS}ms polling`}
      </footer>
    </aside>
  )
}

function HarmonyPanelHost(props: { store: HarmonyPanelStore }): React.JSX.Element | null {
  const source = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot, props.store.getSnapshot)
  if (source === undefined) return null
  return <HarmonyLivePanel source={source} onClose={props.store.close} />
}

export function mountHarmonyPanelHost(ownerDocument: Document = document): { dispose(): void } {
  const container = ownerDocument.createElement('div')
  container.dataset.harmonyPanelHost = 'true'
  ownerDocument.body.append(container)
  let root: Root | undefined = createRoot(container)
  const store = harmonyPanelStore()
  root.render(<HarmonyPanelHost store={store} />)

  return {
    dispose() {
      store.close()
      root?.unmount()
      root = undefined
      container.remove()
    },
  }
}

function HarmonyDeviceCard(props: ToolCallViewProps): React.JSX.Element {
  const source = useMemo(() => parseHarmonyResult(props.block), [props.block])
  const store = harmonyPanelStore()

  useEffect(() => {
    if (source !== undefined) store.openIfIdle(source)
  }, [source, store])

  if (source === undefined) return <div style={{ padding: 10, color: '#8b949e' }}>HarmonyOS tool result</div>
  return (
    <button
      type="button"
      onClick={() => store.open(source)}
      style={{ cursor: 'pointer', width: '100%', textAlign: 'left', padding: '8px 10px' }}
    >
      HarmonyOS 实时预览 · {source.device}
    </button>
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
  if (typeof document !== 'undefined') ctx.effect(() => {
    const host = mountHarmonyPanelHost(document)
    return () => host.dispose()
  }, 'dsh-harmony: live device panel')
}

export { grantNeedsRefresh, normalizedPoint, parseHarmonyResult, type HarmonyPanelSource } from './protocol.ts'
