export interface ThemeKey {
  /** Schlüssel in der TOML-Datei: `kategorie.name`. */
  key: string
  /** CSS-Variable, die das Theme setzt (bis die Oberfläche auf die neuen Namen umgestellt ist). */
  cssVar: string
  description: string
}

/** Alles, was ein Nutzer in einem Theme setzen darf. Alles andere ist intern (Entwickler). */
export const THEME_KEYS: ThemeKey[] = [
  { key: 'surface.base', cssVar: '--bg', description: 'Hauptfläche, Editor' },
  { key: 'surface.raised', cssVar: '--bg-elevated', description: 'Menüs, Dialoge, Popover' },
  { key: 'surface.panel', cssVar: '--bg-panel', description: 'Seitenflächen, aktiver Tab' },
  { key: 'surface.inset', cssVar: '--bg-inset', description: 'vertiefte oder inaktive Flächen' },
  { key: 'surface.titlebar', cssVar: '--bg-titlebar', description: 'Titelleiste' },
  { key: 'surface.titlebar-inactive', cssVar: '--bg-titlebar-inactive', description: 'Titelleiste, Fenster ohne Fokus' },
  { key: 'text.primary', cssVar: '--fg', description: 'normaler Text' },
  { key: 'text.muted', cssVar: '--fg-muted', description: 'Nebentext' },
  { key: 'text.comment', cssVar: '--fg-comment', description: 'Kommentare, Platzhalter' },
  { key: 'text.titlebar', cssVar: '--fg-titlebar', description: 'Text der Titelleiste' },
  { key: 'text.titlebar-inactive', cssVar: '--fg-titlebar-inactive', description: 'Text der Titelleiste ohne Fokus' },
  { key: 'border.subtle', cssVar: '--border', description: 'feine Trennlinien' },
  { key: 'border.strong', cssVar: '--border-strong', description: 'deutliche Rahmen' },
  { key: 'border.focus', cssVar: '--focus-ring', description: 'Fokusring' },
  { key: 'accent.primary', cssVar: '--accent', description: 'Hauptakzent, Links' },
  { key: 'accent.secondary', cssVar: '--accent-2', description: 'zweiter Akzent' },
  { key: 'accent.warm', cssVar: '--warm', description: 'warmer Akzent' },
  { key: 'accent.cool', cssVar: '--cyan', description: 'kühler Akzent' },
  { key: 'state.error', cssVar: '--error', description: 'Fehler' },
  { key: 'state.warning', cssVar: '--warning', description: 'Warnung' },
  { key: 'state.success', cssVar: '--success', description: 'Erfolg' },
  { key: 'selection.background', cssVar: '--selected-bg', description: 'Hintergrund einer Auswahl' },
  { key: 'selection.text', cssVar: '--selected-fg', description: 'Text einer Auswahl' },
  { key: 'selection.row', cssVar: '--selection', description: 'gewählte Zeile in Listen und Properties' },
  { key: 'button.primary.background', cssVar: '--button-bg', description: 'Hauptknopf, Hintergrund' },
  { key: 'button.primary.text', cssVar: '--button-fg', description: 'Hauptknopf, Text' },
]

export const THEME_KEY_NAMES = new Set(THEME_KEYS.map((k) => k.key))
export const THEME_KINDS = ['dark', 'light'] as const
export type ThemeKind = (typeof THEME_KINDS)[number]

export interface EditorKey {
  /** Schlüssel in der TOML-Datei, zum Beispiel `editor.background`. */
  key: string
  /** Monaco-Farbname (`colors` eines Monaco-Themes). */
  monaco: string
  description: string
  /** Farbe, wenn das Theme den Schlüssel nicht setzt (Standard von Monaco `vs-dark` bzw. `vs`). */
  fallback: { dark: string; light: string }
}

/** Farben des Code-Editors. */
export const EDITOR_KEYS: EditorKey[] = [
  { key: 'editor.background', monaco: 'editor.background', description: 'Hintergrund des Editors', fallback: { dark: '#1e1e1e', light: '#ffffff' } },
  { key: 'editor.foreground', monaco: 'editor.foreground', description: 'Standardtext', fallback: { dark: '#d4d4d4', light: '#000000' } },
  { key: 'editor.selection', monaco: 'editor.selectionBackground', description: 'Markierter Text', fallback: { dark: '#264f78', light: '#add6ff' } },
  { key: 'editor.line-highlight', monaco: 'editor.lineHighlightBackground', description: 'Zeile des Cursors', fallback: { dark: '#2a2a2a', light: '#f5f5f5' } },
  { key: 'editor.cursor', monaco: 'editorCursor.foreground', description: 'Cursor', fallback: { dark: '#aeafad', light: '#000000' } },
  { key: 'editor.line-number', monaco: 'editorLineNumber.foreground', description: 'Zeilennummern', fallback: { dark: '#858585', light: '#237893' } },
  { key: 'editor.line-number-active', monaco: 'editorLineNumber.activeForeground', description: 'Zeilennummer der Cursor-Zeile', fallback: { dark: '#c6c6c6', light: '#0b216f' } },
]

export interface SyntaxKey {
  /** Schlüssel in der TOML-Datei: `editor.syntax.<name>`. */
  key: string
  /** Monaco-Token. */
  token: string
  description: string
  /** `italic`, wenn das Token in dieser Farbe kursiv gesetzt wird. */
  style?: 'italic'
  fallback: { dark: string; light: string }
}

/** Farben der Code-Elemente (Syntax). */
export const SYNTAX_KEYS: SyntaxKey[] = [
  { key: 'editor.syntax.keyword', token: 'keyword', description: 'Schlüsselwörter (function, if, select)', fallback: { dark: '#569cd6', light: '#0000ff' } },
  { key: 'editor.syntax.string', token: 'string', description: 'Texte in Anführungszeichen', fallback: { dark: '#ce9178', light: '#a31515' } },
  { key: 'editor.syntax.number', token: 'number', description: 'Zahlen', fallback: { dark: '#b5cea8', light: '#098658' } },
  { key: 'editor.syntax.comment', token: 'comment', description: 'Kommentare', style: 'italic', fallback: { dark: '#6a9955', light: '#008000' } },
  { key: 'editor.syntax.function', token: 'function', description: 'Funktionen und Methoden', fallback: { dark: '#dcdcaa', light: '#795e26' } },
  { key: 'editor.syntax.type', token: 'type', description: 'Typen und Klassen', fallback: { dark: '#4ec9b0', light: '#267f99' } },
  { key: 'editor.syntax.variable', token: 'variable', description: 'Variablen', fallback: { dark: '#9cdcfe', light: '#001080' } },
  { key: 'editor.syntax.constant', token: 'constant', description: 'Konstanten', fallback: { dark: '#4fc1ff', light: '#0070c1' } },
  { key: 'editor.syntax.identifier', token: 'identifier', description: 'Namen ohne besondere Rolle', fallback: { dark: '#d4d4d4', light: '#000000' } },
  { key: 'editor.syntax.operator', token: 'operator', description: 'Operatoren (+, =, &&)', fallback: { dark: '#d4d4d4', light: '#000000' } },
  { key: 'editor.syntax.delimiter', token: 'delimiter', description: 'Klammern und Trennzeichen', fallback: { dark: '#d4d4d4', light: '#000000' } },
]

export const EDITOR_KEY_NAMES = new Set([...EDITOR_KEYS.map((k) => k.key), ...SYNTAX_KEYS.map((k) => k.key)])
