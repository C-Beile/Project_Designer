import type { MonacoThemeData } from './vscodeTheme'
import { deriveWorkbenchColors } from './workbenchColors'

// Makes an imported VS Code theme colour the whole interface and not only the editor: the theme's
// workbench colours (`colors`) are turned into the interface's own colour tokens (tokens.css).
// Tokens the theme does not define keep the value of the dark or light base palette.

/** CSS token -> VS Code colour keys, the first one the theme defines wins. */
const TOKEN_SOURCES: [string, string[]][] = [
  ['--bg', ['editor.background']],
  ['--bg-elevated', ['editorWidget.background', 'dropdown.background', 'menu.background', 'sideBar.background']],
  ['--bg-panel', ['sideBar.background', 'panel.background', 'tab.activeBackground', 'editorGroupHeader.tabsBackground']],
  ['--bg-inset', ['tab.inactiveBackground', 'activityBar.background', 'editorGroupHeader.tabsBackground']],
  ['--bg-titlebar', ['titleBar.activeBackground', 'activityBar.background', 'sideBar.background']],
  ['--bg-titlebar-inactive', ['titleBar.inactiveBackground', 'sideBar.background']],
  ['--fg', ['editor.foreground', 'foreground']],
  ['--fg-titlebar', ['titleBar.activeForeground', 'foreground', 'editor.foreground']],
  ['--fg-titlebar-inactive', ['titleBar.inactiveForeground', 'descriptionForeground']],
  ['--fg-muted', ['descriptionForeground', 'sideBarTitle.foreground', 'tab.inactiveForeground']],
  ['--fg-comment', ['descriptionForeground', 'editorLineNumber.foreground']],
  ['--border', ['panel.border', 'editorGroup.border', 'sideBar.border', 'contrastBorder']],
  ['--border-strong', ['dropdown.border', 'input.border', 'focusBorder', 'panel.border']],
  ['--selection', ['list.activeSelectionBackground', 'list.inactiveSelectionBackground', 'editor.selectionBackground']],
  ['--selected-bg', ['list.activeSelectionBackground', 'editor.selectionBackground']],
  ['--selected-fg', ['list.activeSelectionForeground', 'editor.foreground', 'foreground']],
  ['--accent', ['textLink.foreground', 'button.background', 'focusBorder', 'progressBar.background']],
  ['--focus-ring', ['focusBorder', 'textLink.foreground', 'button.background']],
  ['--button-bg', ['button.background', 'textLink.foreground']],
  ['--button-fg', ['button.foreground']],
  ['--error', ['editorError.foreground', 'errorForeground']],
  ['--warning', ['editorWarning.foreground', 'list.warningForeground']],
]

/** The interface tokens a theme defines, and whether the theme is a light one. */
export function uiTokensFor(data: MonacoThemeData): { tokens: Record<string, string>; light: boolean } {
  // Window colours the theme does not bring are derived from its editor colours, also for themes installed earlier.
  const colors = { ...data.colors }
  const rule = (token: string) => data.rules.find((r) => r.token === token && r.foreground)?.foreground
  deriveWorkbenchColors(colors, { keyword: rule('keyword') ? `#${rule('keyword')}` : undefined, string: rule('string') ? `#${rule('string')}` : undefined, comment: rule('comment') ? `#${rule('comment')}` : undefined })
  const tokens: Record<string, string> = {}
  for (const [token, keys] of TOKEN_SOURCES) {
    const key = keys.find((k) => colors[k])
    if (key) tokens[token] = colors[key]
  }
  return { tokens, light: data.base === 'vs' || data.base === 'hc-light' }
}

let appliedTokens: string[] = []

/** Colours the interface with a theme, or back to the base palette with `undefined`. `base` is the theme the user chose in the title bar. */
export function applyUiTheme(data: MonacoThemeData | undefined, base: string): void {
  const root = document.documentElement
  for (const token of appliedTokens) root.style.removeProperty(token)
  appliedTokens = []
  if (!data) {
    root.setAttribute('data-theme', base)
    return
  }
  const { tokens, light } = uiTokensFor(data)
  root.setAttribute('data-theme', light ? 'light' : 'dark')
  for (const [token, value] of Object.entries(tokens)) {
    root.style.setProperty(token, value)
    appliedTokens.push(token)
  }
}
