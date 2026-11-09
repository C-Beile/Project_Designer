import * as monaco from 'monaco-editor'
import { ensureMonacoLanguagesDefined, gitTokenRules } from './monacoLanguages'
import { getOptions, subscribeOptions } from '../settings/options'
import { findCustomTheme, subscribeCustomThemes } from './customThemes'
import { editorOverrides, subscribeColorOverrides } from './colorOverrides'
import { isPluginActive, subscribePluginPrefs } from '../settings/plugins'
import type { MonacoThemeData } from './vscodeTheme'

// Monaco ships its own theme engine, entirely separate from tokens.css - defining a proper Night
// Owl theme here closes the one remaining unthemed seam in Forge: without this, the embedded
// `.js` code editor (editors/JDitoCodeField.tsx) rendered with Monaco's built-in light "vs"
// theme regardless of the app's own dark/light choice, exactly the kind of theme-break
// ui-reference-car-training.md flags as the thing Forge must NOT repeat.
//
// Colors are the same literal hex values as theme/tokens.css (itself sourced from the real
// sdras/night-owl-vscode-theme repo, see that file's header comment) - duplicated here rather
// than read from CSS custom properties because Monaco's `defineTheme` API requires literal
// values, not var() references. Two values (editorLineNumber.foreground, both themes) are
// deliberately NOT the literal Night Owl originals - those fail WCAG AA here, see the inline
// comments below and p6-theming-notes.md for the numbers. Every other color here is the same
// already-AA-verified token from tokens.css, not a separate palette.

export const NIGHT_OWL_DARK = 'forge-night-owl-dark'
export const NIGHT_OWL_LIGHT = 'forge-night-owl-light'
export const LION_DARK = 'forge-lion-dark'

let defined = false

// The data of the built-in themes, kept so the colours the user changed can be put on top of them.
const builtinData = new Map<string, MonacoThemeData>()

function defineBuiltin(id: string, data: MonacoThemeData): void {
  builtinData.set(id, data)
  monaco.editor.defineTheme(id, data)
}

/** Registers both Monaco themes once per process. Safe to call multiple times. */
export function ensureMonacoThemesDefined(): void {
  if (defined) return
  defined = true
  ensureMonacoLanguagesDefined()

  defineBuiltin(NIGHT_OWL_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      ...gitTokenRules('night-owl'),
      { token: 'comment', foreground: '637777', fontStyle: 'italic' },
      { token: 'string', foreground: 'ecc48d' },
      { token: 'number', foreground: 'f78c6c' },
      { token: 'keyword', foreground: 'c792ea' },
      { token: 'identifier', foreground: 'd6deeb' },
      { token: 'type', foreground: 'ffcb8b' },
      { token: 'function', foreground: '82aaff' },
      { token: 'delimiter', foreground: 'd6deeb' },
      { token: 'operator', foreground: '7fdbca' },
      { token: 'variable', foreground: 'd6deeb' },
      { token: 'variable.predefined', foreground: '82aaff' },
      { token: 'constant', foreground: '82aaff' },
    ],
    colors: {
      'editor.background': '#011627',
      'editor.foreground': '#d6deeb',
      // Night Owl's own editorLineNumber.foreground (#4b6479) is only 2.97:1 on this background -
      // fails AA for what is still real, functional text (line numbers are used to navigate, not
      // purely decorative). Reusing the already AA-checked --fg-muted value (4.53:1, see
      // p6-theming-notes.md) instead of inventing a third grey.
      'editorLineNumber.foreground': '#62829c',
      'editorLineNumber.activeForeground': '#d6deeb',
      'editor.selectionBackground': '#1d3b53',
      'editorCursor.foreground': '#82aaff',
      'editor.inactiveSelectionBackground': '#1d3b5380',
      'editorWidget.background': '#021320',
      'editorWidget.border': '#5f7e97',
      'editor.lineHighlightBackground': '#0b294280',
      // Diff view as in the ADITO Designer: added lines in green, removed lines in grey.
      'diffEditor.insertedLineBackground': '#2e6b3a80',
      'diffEditor.insertedTextBackground': '#3c8c4a80',
      'diffEditor.removedLineBackground': '#8080804d',
      'diffEditor.removedTextBackground': '#80808080',
      'diffEditorGutter.insertedLineBackground': '#2e6b3a99',
      'diffEditorGutter.removedLineBackground': '#80808066',
      'focusBorder': '#82aaff',
    },
  })

  defineBuiltin(LION_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      ...gitTokenRules('lion'),
      { token: 'comment', foreground: '8a8a8a', fontStyle: 'italic' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'keyword', foreground: '569cd6' },
      { token: 'identifier', foreground: 'd4d4d4' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'function', foreground: 'dcdcaa' },
      { token: 'delimiter', foreground: 'd4d4d4' },
      { token: 'operator', foreground: 'd4d4d4' },
      { token: 'variable', foreground: '9cdcfe' },
      { token: 'constant', foreground: '4fc1ff' },
    ],
    colors: {
      'editor.background': '#2b2b2b',
      'editor.foreground': '#d4d4d4',
      'editorLineNumber.foreground': '#8a8a8a',
      'editorLineNumber.activeForeground': '#d4d4d4',
      'editor.selectionBackground': '#2a78b4',
      'editorCursor.foreground': '#4aa8e8',
      'editor.inactiveSelectionBackground': '#2a78b480',
      'editorWidget.background': '#303030',
      'editorWidget.border': '#8a8a8a',
      'editor.lineHighlightBackground': '#323232',
      // Diff view as in the ADITO Designer: added lines in green, removed lines in grey.
      'diffEditor.insertedLineBackground': '#2e6b3a80',
      'diffEditor.insertedTextBackground': '#3c8c4a80',
      'diffEditor.removedLineBackground': '#8080804d',
      'diffEditor.removedTextBackground': '#80808080',
      'diffEditorGutter.insertedLineBackground': '#2e6b3a99',
      'diffEditorGutter.removedLineBackground': '#80808066',
      'focusBorder': '#4aa8e8',
    },
  })

  defineBuiltin(NIGHT_OWL_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [
      ...gitTokenRules('light'),
      { token: 'comment', foreground: '989fb1', fontStyle: 'italic' },
      { token: 'string', foreground: '4876d6' },
      { token: 'number', foreground: 'aa0982' },
      { token: 'keyword', foreground: '994cc3' },
      { token: 'identifier', foreground: '403f53' },
      { token: 'type', foreground: 'b76d19' },
      { token: 'function', foreground: '994cc3' },
      { token: 'delimiter', foreground: '403f53' },
      { token: 'operator', foreground: '0c969b' },
      { token: 'variable', foreground: '403f53' },
      { token: 'variable.predefined', foreground: '4876d6' },
      { token: 'constant', foreground: '4876d6' },
    ],
    colors: {
      'editor.background': '#fbfbfb',
      'editor.foreground': '#403f53',
      // Night Owl Light's own editorLineNumber.foreground (#90a7b2) is only 2.43:1 here - same AA
      // failure as the dark theme's line-number color above; reusing --fg-muted's already AA-
      // checked value (4.53:1) instead.
      'editorLineNumber.foreground': '#5c7885',
      'editorLineNumber.activeForeground': '#403f53',
      'editor.selectionBackground': '#d3e8f8',
      'editorCursor.foreground': '#4070d4',
      'editor.inactiveSelectionBackground': '#d3e8f880',
      'editorWidget.background': '#f0f0f0',
      'editorWidget.border': '#93a1a1',
      'editor.lineHighlightBackground': '#f6f6f6',
      // Diff view as in the ADITO Designer: added lines in green, removed lines in grey.
      'diffEditor.insertedLineBackground': '#b7e0bd80',
      'diffEditor.insertedTextBackground': '#8fd09a80',
      'diffEditor.removedLineBackground': '#c8c8c880',
      'diffEditor.removedTextBackground': '#b0b0b080',
      'focusBorder': '#4070d4',
    },
  })
}

// Imported themes are registered with Monaco when they are first needed, and again when the same
// theme was imported anew (the stored object changes then).
const registeredCustom = new Map<string, MonacoThemeData>()

const OVERRIDE_THEME = 'forge-user-colours'
let overrideStamp = ''

/** The theme with the colours the user changed by hand put on top; the same id is defined anew when the colours change. */
function withUserColours(baseId: string, base: MonacoThemeData | undefined): string {
  const { colors, rules } = editorOverrides()
  if (!base || (Object.keys(colors).length === 0 && rules.length === 0)) return baseId
  const stamp = JSON.stringify([baseId, colors, rules])
  if (stamp !== overrideStamp) {
    // A later rule of the same token wins, so the user's rules go to the end.
    monaco.editor.defineTheme(OVERRIDE_THEME, { ...base, colors: { ...base.colors, ...colors }, rules: [...base.rules, ...rules] })
    overrideStamp = stamp
  }
  return OVERRIDE_THEME
}

/** Maps Forge's own theme name (theme/useTheme.ts) to the matching Monaco theme id. */
export function monacoThemeFor(forgeTheme: 'dark' | 'light' | 'lion'): string {
  const custom = getOptions().editor.colorTheme && isPluginActive('vscode-themes') ? findCustomTheme(getOptions().editor.colorTheme) : undefined
  if (custom) {
    ensureMonacoThemesDefined()
    if (registeredCustom.get(custom.id) !== custom.data) {
      monaco.editor.defineTheme(custom.id, custom.data)
      registeredCustom.set(custom.id, custom.data)
    }
    return withUserColours(custom.id, custom.data)
  }
  const id = forgeTheme === 'lion' ? LION_DARK : forgeTheme === 'light' ? NIGHT_OWL_LIGHT : NIGHT_OWL_DARK
  const mine = editorOverrides()
  if (Object.keys(mine.colors).length === 0 && mine.rules.length === 0) return id
  ensureMonacoThemesDefined()
  return withUserColours(id, builtinData.get(id))
}

/**
 * Reads the theme Forge currently has applied (via `data-theme` on `<html>`, set by
 * theme/useTheme.ts) without needing a React context plumbed down to every Monaco host - the
 * `<html>` attribute is already the single source of truth useTheme.ts writes to.
 */
export function currentForgeTheme(): 'dark' | 'light' | 'lion' {
  if (typeof document === 'undefined') return 'dark'
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'light' || attr === 'lion' ? attr : 'dark'
}

/**
 * Keeps a live Monaco editor instance in sync with theme toggles (chrome/TitleBar.tsx's toggle
 * button) by observing the same `data-theme` attribute useTheme.ts writes on `<html>`. Returns an
 * unsubscribe function.
 */
export function watchForgeThemeForMonaco(onChange: (monacoTheme: string) => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {}
  }
  const target = document.documentElement
  const apply = () => onChange(monacoThemeFor(currentForgeTheme()))
  const observer = new MutationObserver(apply)
  observer.observe(target, { attributes: true, attributeFilter: ['data-theme'] })
  // The editor theme can also change through the Options window or a newly imported theme.
  const offOptions = subscribeOptions(apply)
  const offThemes = subscribeCustomThemes(apply)
  const offColors = subscribeColorOverrides(apply)
  const offPlugins = subscribePluginPrefs(apply)
  return () => {
    observer.disconnect()
    offOptions()
    offThemes()
    offColors()
    offPlugins()
  }
}
