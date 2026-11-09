import { getWindowBackend } from '../../windows/windowService'

// Hört auf ein Event des Backends; gibt die Abmeldefunktion für useEffect zurück.
export function listenBackend(event: string, handler: (payload: unknown) => void): () => void {
  let stop: (() => void) | null = null
  let gone = false
  void getWindowBackend()
    .listen(event, handler)
    .then((u) => (gone ? u() : (stop = u)))
    .catch(() => {})
  return () => {
    gone = true
    stop?.()
  }
}
