// Fehler-Popups ins Protokoll schreiben, ohne dass der Kern die Tauri-Schicht kennt.
// `main.tsx` setzt die Senke (api.logClientError); ohne Senke (Tests) passiert nichts.

type Sink = (message: string) => void

let sink: Sink | null = null

export function setErrorLogSink(next: Sink | null): void {
  sink = next
}

/** Die ersten Zeilen des Aufruf-Stapels (Datei:Zeile) ohne die Log-Hilfen selbst: zeigt, wo der Fehler ausgelöst wurde. */
export function callSite(depth = 4): string {
  const lines = (new Error().stack ?? '').split(String.fromCharCode(10)).slice(1)
  return lines
    .filter((l) => !/errorLog|notifications\.tsx|tauriApi/.test(l))
    .slice(0, depth)
    .map((l) => '  ' + l.trim())
    .join(String.fromCharCode(10))
}

/** Schreibt einen Fehler ins Protokoll; Fehler beim Schreiben werden verschluckt. */
export function logError(message: string): void {
  try {
    sink?.(message)
  } catch {
    // Das Protokoll darf nie selbst einen Fehler auslösen.
  }
}
