function targetText(target: EventTarget | null): string {
  if (!target) return 'no target'
  const el = target as Partial<HTMLElement> & { src?: string; href?: string }
  if (typeof el.tagName === 'string') return `<${el.tagName.toLowerCase()}${el.src ? ` src="${el.src}"` : el.href ? ` href="${el.href}"` : ''}>`
  return target.constructor?.name ?? 'unknown target'
}

/** Beschreibt ein Browser-Ereignis, das als Fehler auftaucht (z. B. ein Worker oder Skript, das nicht lädt). */
function eventText(e: Event): string {
  const parts = [`${e.constructor?.name ?? 'Event'} "${e.type}" on ${targetText(e.target)}`]
  const withMessage = e as Partial<ErrorEvent>
  if (withMessage.message) parts.push(withMessage.message)
  if (withMessage.filename) parts.push(`at ${withMessage.filename}:${withMessage.lineno ?? 0}:${withMessage.colno ?? 0}`)
  return parts.join(' - ')
}

/** Macht aus einem beliebigen Fehlerwert einen lesbaren Text. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof Event !== 'undefined' && e instanceof Event) return eventText(e)
  if (e && typeof e === 'object') {
    const message = (e as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
    try {
      const json = JSON.stringify(e)
      if (json && json !== '{}') return json
    } catch {
      // nicht serialisierbar: unten String(e)
    }
  }
  return String(e)
}

/** Alles, was wir über einen Fehlerwert wissen, für das Protokoll und den Knopf "Copy details": Name, Meldung und Aufrufstapel. */
export function errorDetails(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}${e.stack ? `\n${e.stack}` : ''}${e.cause ? `\nCaused by: ${errorDetails(e.cause)}` : ''}`
  return errorText(e)
}
