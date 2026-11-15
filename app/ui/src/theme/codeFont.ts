import { FONT_STACKS, styleConfig } from '../config/styleConfig'

const FALLBACK = "'Cascadia Mono', Consolas, monospace"

/** Schriftfolge für Code: eigener Name des Nutzers mit Rückfall, leer = Standard aus `style.toml` (`[font] code`). */
export function codeFontStack(family: string): string {
  const own = family.trim()
  return own ? `${own}, ${FALLBACK}` : FONT_STACKS[styleConfig.font.code as keyof typeof FONT_STACKS]
}

/** Wartet, bis die erste Schrift der Folge geladen ist. Monaco misst Zeichen beim Start; mit einer noch nicht geladenen Schrift sitzt der Cursor versetzt. */
export function whenFontReady(stack: string): Promise<void> {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (!fonts?.load) return Promise.resolve()
  return fonts.load(`13px ${stack.split(',')[0].trim()}`).then(
    () => undefined,
    () => undefined,
  )
}
