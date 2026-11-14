/** Zeitmarke im Browser-Zeitstrahl; `performance.mark` ist billig und taucht im DevTools-Profil auf. */
export function markPerf(name: string): void {
  if (typeof performance !== 'undefined' && performance.mark) performance.mark(`designer:${name}`)
}
