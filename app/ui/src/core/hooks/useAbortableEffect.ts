import { useEffect, type DependencyList } from 'react'

/**
 * Wie `useEffect`, aber mit einem `AbortSignal`, das beim Aufräumen abbricht. Ersetzt das handgebaute
 * `let cancelled = false` ... `cancelled = true`: Antworten prüfen `signal.aborted`, bevor sie Zustand setzen.
 * Die Funktion darf wie bei `useEffect` eine Aufräumfunktion zurückgeben (z. B. zum Abmelden).
 */
export function useAbortableEffect(effect: (signal: AbortSignal) => void | (() => void), deps: DependencyList): void {
  useEffect(() => {
    const controller = new AbortController()
    const cleanup = effect(controller.signal)
    return () => {
      controller.abort()
      cleanup?.()
    }
    // Die Liste bestimmt der Aufrufer, wie bei `useEffect`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
