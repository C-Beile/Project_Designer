// A theme that only knows the editor (a TextMate theme, or a VS Code theme with few window colours) leaves the rest of the
// window without colours. This fills the missing window colours (side bar, tabs, title bar, lists, buttons ...) from the
// editor colours, so the whole window looks like one theme instead of the editor on a foreign background. Colours the
// theme defines itself are never replaced.

function rgbOf(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

/** `amount` of `to` mixed into `from` (0 = from, 1 = to). */
export function mix(from: string, to: string, amount: number): string {
  const a = rgbOf(from)
  const b = rgbOf(to)
  return '#' + a.map((c, i) => Math.round(c + (b[i] - c) * amount).toString(16).padStart(2, '0')).join('')
}

const SIX = /^#[0-9a-f]{6}/i

/** Fills `colors` in place. `code` holds the colours of keywords, strings and comments for the accent. */
export function deriveWorkbenchColors(colors: Record<string, string>, code: { keyword?: string; string?: string; comment?: string } = {}): void {
  const bg = colors['editor.background']
  const fg = colors['editor.foreground']
  if (!bg || !fg || !SIX.test(bg) || !SIX.test(fg)) return
  const dark = (parseInt(bg.slice(1, 3), 16) * 299 + parseInt(bg.slice(3, 5), 16) * 587 + parseInt(bg.slice(5, 7), 16) * 114) / 1000 <= 160
  const deeper = dark ? '#000000' : '#ffffff'
  const lighter = dark ? '#ffffff' : '#000000'
  const cursor = colors['editorCursor.foreground']
  const accent = (cursor && SIX.test(cursor) ? cursor.slice(0, 7) : undefined) ?? code.keyword ?? code.string ?? fg
  const comment = code.comment ?? mix(fg, bg, 0.5)
  const selection = colors['editor.selectionBackground']
  const derived: Record<string, string> = {
    foreground: fg,
    descriptionForeground: mix(fg, bg, 0.4),
    'sideBar.background': mix(bg, deeper, 0.18),
    'panel.background': mix(bg, deeper, 0.1),
    'editorWidget.background': mix(bg, lighter, 0.07),
    'menu.background': mix(bg, lighter, 0.07),
    'dropdown.background': mix(bg, lighter, 0.07),
    'tab.activeBackground': bg,
    'tab.inactiveBackground': mix(bg, deeper, 0.3),
    'activityBar.background': mix(bg, deeper, 0.3),
    'editorGroupHeader.tabsBackground': mix(bg, deeper, 0.3),
    'titleBar.activeBackground': mix(bg, deeper, 0.35),
    'titleBar.inactiveBackground': mix(bg, deeper, 0.45),
    'titleBar.activeForeground': mix(fg, bg, 0.15),
    'titleBar.inactiveForeground': mix(fg, bg, 0.5),
    'panel.border': mix(bg, lighter, 0.12),
    'dropdown.border': mix(bg, lighter, 0.2),
    focusBorder: accent,
    'textLink.foreground': accent,
    'button.background': accent,
    'button.foreground': dark ? bg : '#ffffff',
    'list.activeSelectionBackground': selection && SIX.test(selection) ? selection.slice(0, 7) : mix(bg, accent, 0.25),
    'list.activeSelectionForeground': fg,
    'editorLineNumber.foreground': mix(comment, bg, 0.2),
    'editorLineNumber.activeForeground': fg,
    'editorWhitespace.foreground': mix(bg, lighter, 0.12),
    'editorIndentGuide.background': mix(bg, lighter, 0.1),
    'editorBracketMatch.border': accent,
  }
  for (const [key, value] of Object.entries(derived)) if (!colors[key]) colors[key] = value
}
