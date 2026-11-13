import type { ForgeApi } from '../api/ForgeApi'

// Die eine App-Konfiguration (`designer.conf` im App-Datenordner, TOML). Die Oberfläche lädt sie beim
// Start einmal ins Gedächtnis; gelesen wird synchron aus dem Gedächtnis, geschrieben wird sofort ins
// Gedächtnis und gebündelt (kurz verzögert) ans Backend. Änderungen eines Fensters erreichen die anderen
// über das Ereignis `forge://config-changed`.
//
// Pfad = Liste von Schlüsseln: `['appearance', 'theme']` ist der Schlüssel `theme` im Abschnitt `[appearance]`.
// Ein Schlüssel darf Punkte und Schrägstriche enthalten (z. B. ein Projektordner). `undefined` oder `null`
// löscht den Wert: leere Werte stehen nie in der Datei. Kein `localStorage`.

type Path = readonly string[]
type Json = unknown

const WRITE_DELAY_MS = 300

let data: Record<string, Json> = {}
let sender: ForgeApi['configSet'] | null = null
const pending = new Map<string, { path: Path; value: Json }>()
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(path: Path) => void>()

const keyOf = (path: Path) => JSON.stringify(path)

function isTable(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Der Wert unter dem Pfad, oder `undefined`. */
export function configGet<T = unknown>(...path: string[]): T | undefined {
  let current: Json = data
  for (const key of path) {
    if (!isTable(current)) return undefined
    current = current[key]
  }
  return current as T | undefined
}

function put(path: Path, value: Json): void {
  if (path.length === 0) return
  const empty = value === undefined || value === null || (isTable(value) && Object.keys(value).length === 0)
  let current = data
  const trail: { table: Record<string, Json>; key: string }[] = []
  for (const key of path.slice(0, -1)) {
    trail.push({ table: current, key })
    const next = current[key]
    if (isTable(next)) current = next
    else {
      if (empty) return
      const made: Record<string, Json> = {}
      current[key] = made
      current = made
    }
  }
  const last = path[path.length - 1]
  if (empty) delete current[last]
  else current[last] = value
  // Leere Abschnitte fallen weg, wie in der Datei.
  for (let i = trail.length - 1; i >= 0; i--) {
    const { table, key } = trail[i]
    const child = table[key]
    if (isTable(child) && Object.keys(child).length === 0) delete table[key]
  }
}

function notify(path: Path): void {
  for (const l of listeners) l(path)
}

function flush(): void {
  if (timer) clearTimeout(timer)
  timer = null
  const send = sender
  const items = [...pending.values()]
  pending.clear()
  if (!send) return
  for (const { path, value } of items) void send([...path], value ?? null).catch(() => {})
}

/** Setzt den Wert unter dem Pfad: sofort im Gedächtnis, gebündelt im Backend. */
export function configSet(path: Path, value: Json): void {
  put(path, value)
  notify(path)
  if (!sender) return
  pending.set(keyOf(path), { path, value })
  if (!timer) timer = setTimeout(flush, WRITE_DELAY_MS)
}

/** Hört auf Änderungen (auch aus anderen Fenstern). Gibt die Abmeldefunktion zurück. */
export function onConfigChange(listener: (path: Path) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Pfad mit Schrägstrichen: so steht er in der Datei, so wird er verglichen. */
export function slash(path: string): string {
  return path.split(String.fromCharCode(92)).join('/')
}

/** Ob die Änderung `changed` den Abschnitt `section` berührt (gleicher Pfad oder darüber/darunter). */
export function touches(changed: Path, section: Path): boolean {
  const n = Math.min(changed.length, section.length)
  for (let i = 0; i < n; i++) if (changed[i] !== section[i]) return false
  return true
}

/**
 * Lädt die Konfiguration einmal und verbindet das Schreiben mit dem Backend. `listen` hört auf
 * `forge://config-changed` (Fenster, in denen kein Tauri läuft, lassen es weg).
 */
export async function loadAppConfig(api: ForgeApi, listen?: (event: string, handler: (payload: unknown) => void) => () => void): Promise<() => void> {
  try {
    const loaded = await api.configGet()
    data = isTable(loaded) ? loaded : {}
  } catch {
    data = {}
  }
  sender = (path, value) => api.configSet(path, value)
  // Wer seine Einstellungen schon beim Import gelesen hat, liest jetzt neu (Pfad [] berührt jeden Abschnitt).
  notify([])
  const onPageHide = () => flush()
  window.addEventListener('pagehide', onPageHide)
  const stop = listen?.('forge://config-changed', (payload) => {
    const event = payload as { path?: string[]; value?: Json } | null
    if (!event?.path) return
    // Ein noch nicht gesendeter eigener Wert ist neuer als das Echo.
    if (pending.has(keyOf(event.path))) return
    put(event.path, event.value)
    notify(event.path)
  })
  return () => {
    window.removeEventListener('pagehide', onPageHide)
    stop?.()
  }
}

/** Nur für Tests und zum Zurücksetzen: leert das Gedächtnis und verwirft Wartendes. */
export function _resetAppConfigForTests(): void {
  data = {}
  sender = null
  pending.clear()
  if (timer) clearTimeout(timer)
  timer = null
  listeners.clear()
}

/** Nur für Tests: sendet Wartendes sofort. */
export function _flushAppConfigForTests(): void {
  flush()
}
