import type { HarmonyPanelSource } from './protocol.ts'

export interface HarmonyPanelStore {
  getSnapshot(): HarmonyPanelSource | undefined
  subscribe(listener: () => void): () => void
  open(source: HarmonyPanelSource): true
  openIfIdle(source: HarmonyPanelSource): boolean
  close(): void
}

export function createHarmonyPanelStore(): HarmonyPanelStore {
  let current: HarmonyPanelSource | undefined
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open(source) {
      current = source
      emit()
      return true
    },
    openIfIdle(source) {
      if (current !== undefined) return false
      current = source
      emit()
      return true
    },
    close() {
      if (current === undefined) return
      current = undefined
      emit()
    },
  }
}

let sharedStore: HarmonyPanelStore | undefined

export function harmonyPanelStore(): HarmonyPanelStore {
  sharedStore ??= createHarmonyPanelStore()
  return sharedStore
}
