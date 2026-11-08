/** Kopiert Text in die Zwischenablage. true = geklappt. Fällt auf `execCommand` zurück, wenn die Clipboard-API fehlt. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // weiter mit dem Rückfall
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy')
    area.remove()
    return !!ok
  } catch {
    return false
  }
}
