/**
 * Die Seite selbst scrollt nie: jedes Panel scrollt in sich. Fokus, Ankersprünge und `scrollIntoView` können die Seite trotz
 * `overflow: hidden` verschieben, dann steht das Fenster halb aus dem Bild. Diese Sperre stellt sie sofort zurück.
 */
export function installNoPageScroll(): () => void {
  const reset = () => {
    const el = document.scrollingElement
    if (el && (el.scrollTop !== 0 || el.scrollLeft !== 0)) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
    for (const node of [document.documentElement, document.body]) {
      if (node && (node.scrollTop !== 0 || node.scrollLeft !== 0)) {
        node.scrollTop = 0
        node.scrollLeft = 0
      }
    }
  }
  window.addEventListener('scroll', reset, true)
  document.addEventListener('focusin', reset, true)
  return () => {
    window.removeEventListener('scroll', reset, true)
    document.removeEventListener('focusin', reset, true)
  }
}
