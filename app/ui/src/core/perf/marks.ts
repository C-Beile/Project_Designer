/** Alle Marken als Text (`start=120 config=180 ...`, ms seit Beginn des Seitenladens), für das PERF-Log. */
export function perfMarksText(): string {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return ''
  return performance
    .getEntriesByType('mark')
    .filter((m) => m.name.startsWith('designer:'))
    .map((m) => `${m.name.slice(9)}=${Math.round(m.startTime)}`)
    .join(' ')
}

/** Zeitmarke im Browser-Zeitstrahl; `performance.mark` ist billig und taucht im DevTools-Profil auf. */
export function markPerf(name: string): void {
  if (typeof performance !== 'undefined' && performance.mark) performance.mark(`designer:${name}`)
}
