/**
 * Zeigt die Seite erst nach zwei Frames und geladenen Schriften, damit man kein ungestyltes Zwischenbild sieht.
 * `showWindow`: das OS-Fenster startet unsichtbar und erscheint fertig gezeichnet.
 */
export function revealApp(showWindow = false): void {
  const root = document.documentElement
  const done = () => {
    root.setAttribute('data-ready', '')
    if (!showWindow) return
    // Ein Frame warten, damit der Inhalt schon gemalt ist, wenn das Fenster erscheint.
    requestAnimationFrame(() => {
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('window_show')).catch(() => {})
    })
  }
  const show = () => requestAnimationFrame(() => requestAnimationFrame(done))
  const fonts = typeof document !== 'undefined' ? document.fonts?.ready : undefined
  if (fonts) void fonts.then(show, show)
  else show()
}
