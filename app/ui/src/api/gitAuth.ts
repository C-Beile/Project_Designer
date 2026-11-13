// Anmeldung bei Git-Netzwerkaufrufen (Pull, Push, Fetch). Das Fenster des Git Credential Managers ist
// abgeschaltet; schlägt die Anmeldung fehl, fragt ein Handler des Git-Plugins den Benutzer im Designer
// und der Aufruf läuft danach genau einmal erneut. Ohne Handler bleibt alles beim Alten.

export interface GitAuthContext {
  root: string
  /** Adresse von `origin`, für die Anzeige. */
  url: string | null
  /** Meldet am Remote an; Git speichert die Daten danach selbst. Wirft bei falschen Daten. */
  login: (user: string, password: string) => Promise<void>
}

/** Fragt den Benutzer; true = angemeldet, der Aufruf wird wiederholt. */
export type GitAuthHandler = (ctx: GitAuthContext) => Promise<boolean>

let handler: GitAuthHandler | null = null

export function setGitAuthHandler(h: GitAuthHandler): () => void {
  handler = h
  return () => {
    if (handler === h) handler = null
  }
}

const AUTH_FAILURE = /authentication failed|could not read (username|password)|terminal prompts disabled|http basic: access denied|invalid (username or password|credentials)|returned error: 40[13]|the requested url returned error: 40[13]/i

/** Der Git-Text sagt, dass die Anmeldung am Remote fehlt oder falsch ist (nicht: SSH-Schlüssel). */
export function isAuthFailure(text: string): boolean {
  return AUTH_FAILURE.test(text)
}

const messageOf = (e: unknown): string => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e))
const failedOutput = (r: unknown): boolean => typeof r === 'object' && r !== null && (r as { ok?: unknown }).ok === false && isAuthFailure(String((r as { text?: unknown }).text ?? ''))

/**
 * Führt `call` aus. Meldet Git einen Anmeldefehler (als Fehler oder als `ok: false`) und gibt es einen
 * Handler, fragt er den Benutzer und `call` läuft einmal erneut; sonst kommt das erste Ergebnis zurück.
 */
export async function withGitAuth<T>(call: () => Promise<T>, context: () => Promise<GitAuthContext>): Promise<T> {
  let first: { value: T } | { error: unknown }
  try {
    first = { value: await call() }
  } catch (error) {
    first = { error }
  }
  const failed = 'error' in first ? isAuthFailure(messageOf(first.error)) : failedOutput(first.value)
  if (failed && handler) {
    const signedIn = await handler(await context()).catch(() => false)
    if (signedIn) return call()
  }
  if ('error' in first) throw first.error
  return first.value
}
