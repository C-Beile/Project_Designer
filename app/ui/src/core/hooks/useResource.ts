import { useEffect, useState } from 'react'
import { errorText } from '../errorText'
import { createStore } from '../store'

export interface Resource<T> {
  /** Letzter erfolgreicher Wert; bleibt beim Neuladen stehen. */
  data: T | undefined
  error: string | undefined
  loading: boolean
  reload: () => void
}

const tagVersions = createStore<Record<string, number>>({})

/** Lädt alle Ressourcen neu, die mit diesem Tag angemeldet sind (z. B. `project` bei `forge://project-changed`). */
export function invalidateResources(tag: string): void {
  tagVersions.update((v) => ({ ...v, [tag]: (v[tag] ?? 0) + 1 }))
}

/**
 * `clearOnReload`: der alte Wert verschwindet beim Neuladen (sonst bleibt er stehen, bis der neue da ist).
 * Lädt einen Wert und lädt neu, wenn sich `deps` ändern, `reload()` gerufen wird oder ein Tag ungültig wird.
 * Ersetzt das handgebaute `let cancelled = false` in Effekten: veraltete Antworten werden verworfen (AbortSignal).
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[], tags: readonly string[] = [], options: { clearOnReload?: boolean } = {}): Resource<T> {
  const versions = tagVersions.use()
  const [manual, setManual] = useState(0)
  const [state, setState] = useState<{ data: T | undefined; error: string | undefined; loading: boolean }>({ data: undefined, error: undefined, loading: true })
  const tagKey = tags.map((t) => `${t}:${versions[t] ?? 0}`).join(',')

  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ data: options.clearOnReload ? undefined : s.data, error: undefined, loading: true }))
    load(controller.signal).then(
      (data) => !controller.signal.aborted && setState({ data, error: undefined, loading: false }),
      (e) => !controller.signal.aborted && setState((s) => ({ ...s, error: errorText(e), loading: false })),
    )
    return () => controller.abort()
    // `load` ist absichtlich nicht in der Liste: der Aufrufer nennt in `deps`, was das Neuladen auslöst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tagKey, manual])

  return { ...state, reload: () => setManual((n) => n + 1) }
}
