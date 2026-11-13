import { configGet, configSet, onConfigChange, touches } from '../settings/appConfig'
// Colours and the interface font the user changed by hand (Options > Appearance). They lie on top of whatever theme is
// active (built-in or imported), so a theme can be taken as the base and adjusted colour by colour. Kept per user in
// designer.conf ([appearance.colors]).
//
// Keys of `colors`:
//   `--name`          an interface colour token of tokens.css
//   `editor:<id>`     a colour of the code editor (Monaco colour id, for example `editor.background`)
//   `syntax:<token>`  the colour of a kind of code (Monaco token name, for example `comment`)

const COLORS_PATH = ['appearance', 'colors'] as const

export interface ColorOverrides {
  colors: Record<string, string>
  /** Font family of the interface; empty: the default. */
  uiFont: string
}

export interface ColorItem {
  key: string
  label: string
}

export interface ColorGroup {
  id: string
  label: string
  hint: string
  items: ColorItem[]
}

/** The colours the user can change, grouped by their role. */
export const COLOR_GROUPS: ColorGroup[] = [
  {
    id: 'primary',
    label: 'Primary',
    hint: 'The main colour of the interface: active elements, links, the main button and the focus frame.',
    items: [
      { key: '--accent', label: 'Primary colour' },
      { key: '--button-bg', label: 'Main button' },
      { key: '--button-fg', label: 'Main button text' },
      { key: '--focus-ring', label: 'Focus frame' },
    ],
  },
  {
    id: 'secondary',
    label: 'Secondary',
    hint: 'Supporting colours: selections, highlights and the second accent.',
    items: [
      { key: '--accent-2', label: 'Secondary colour' },
      { key: '--selected-bg', label: 'Selected row' },
      { key: '--selected-fg', label: 'Selected row text' },
      { key: '--warm', label: 'Warm highlight' },
      { key: '--cyan', label: 'Cool highlight' },
    ],
  },
  {
    id: 'surfaces',
    label: 'Surfaces',
    hint: 'The backgrounds of the window.',
    items: [
      { key: '--bg', label: 'Window' },
      { key: '--bg-panel', label: 'Panels' },
      { key: '--bg-elevated', label: 'Menus and dialogs' },
      { key: '--bg-inset', label: 'Inactive tabs and recessed areas' },
      { key: '--bg-titlebar', label: 'Title bar' },
      { key: '--bg-titlebar-inactive', label: 'Title bar (window not in front)' },
    ],
  },
  {
    id: 'text',
    label: 'Text',
    hint: 'Text colours of the interface.',
    items: [
      { key: '--fg', label: 'Text' },
      { key: '--fg-muted', label: 'Secondary text' },
      { key: '--fg-comment', label: 'Hints and comments' },
      { key: '--fg-titlebar', label: 'Title bar text' },
      { key: '--fg-titlebar-inactive', label: 'Title bar text (window not in front)' },
    ],
  },
  {
    id: 'lines',
    label: 'Lines',
    hint: 'Borders and dividers.',
    items: [
      { key: '--border', label: 'Border' },
      { key: '--border-strong', label: 'Strong border' },
    ],
  },
  {
    id: 'status',
    label: 'Status',
    hint: 'Messages and states.',
    items: [
      { key: '--error', label: 'Error' },
      { key: '--warning', label: 'Warning' },
      { key: '--success', label: 'Success' },
    ],
  },
  {
    id: 'folders',
    label: 'Project tree',
    hint: 'Folder colours of the Projects tree.',
    items: [
      { key: '--folder-system', label: 'system' },
      { key: '--folder-preferences', label: 'preferences' },
      { key: '--folder-application', label: 'application' },
      { key: '--folder-context', label: 'context' },
      { key: '--folder-notificationtype', label: 'notificationtype' },
      { key: '--folder-entity', label: 'entity' },
      { key: '--folder-view', label: 'view' },
      { key: '--folder-dashboard', label: 'dashboard' },
      { key: '--folder-renderer', label: 'renderer' },
      { key: '--folder-process', label: 'process' },
      { key: '--folder-test', label: 'test' },
      { key: '--folder-service', label: 'service' },
      { key: '--folder-report', label: 'report' },
      { key: '--folder-language', label: 'language' },
      { key: '--folder-role', label: 'role' },
      { key: '--folder-alias', label: 'alias' },
      { key: '--folder-others', label: 'others' },
    ],
  },
  {
    id: 'editor',
    label: 'Code editor',
    hint: 'The colours of the editor area.',
    items: [
      { key: 'editor:editor.background', label: 'Background' },
      { key: 'editor:editor.foreground', label: 'Text' },
      { key: 'editor:editor.selectionBackground', label: 'Selection' },
      { key: 'editor:editor.lineHighlightBackground', label: 'Current line' },
      { key: 'editor:editorCursor.foreground', label: 'Cursor' },
      { key: 'editor:editorLineNumber.foreground', label: 'Line numbers' },
      { key: 'editor:editorLineNumber.activeForeground', label: 'Current line number' },
      { key: 'editor:editorWhitespace.foreground', label: 'Whitespace marks' },
    ],
  },
  {
    id: 'syntax',
    label: 'Code colours',
    hint: 'The colours of the kinds of code.',
    items: [
      { key: 'syntax:comment', label: 'Comments' },
      { key: 'syntax:string', label: 'Strings' },
      { key: 'syntax:number', label: 'Numbers' },
      { key: 'syntax:keyword', label: 'Keywords' },
      { key: 'syntax:type', label: 'Types' },
      { key: 'syntax:function', label: 'Functions' },
      { key: 'syntax:identifier', label: 'Names' },
      { key: 'syntax:operator', label: 'Operators' },
      { key: 'syntax:delimiter', label: 'Brackets and separators' },
      { key: 'syntax:constant', label: 'Constants' },
      { key: 'syntax:tag', label: 'Tags' },
      { key: 'syntax:attribute.name', label: 'Attribute names' },
    ],
  },
]

const HEX = /^#[0-9a-f]{6}$/i

function load(): ColorOverrides {
  const parsed = configGet<Partial<ColorOverrides>>(...COLORS_PATH) ?? {}
  const colors: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed.colors ?? {})) if (typeof value === 'string' && HEX.test(value)) colors[key] = value.toLowerCase()
  return { colors, uiFont: typeof parsed.uiFont === 'string' ? parsed.uiFont : '' }
}

let current: ColorOverrides = load()
const listeners = new Set<() => void>()

export function getColorOverrides(): ColorOverrides {
  return current
}

export function saveColorOverrides(next: ColorOverrides): void {
  current = next
  // Ohne Änderungen steht nichts in der Datei.
  configSet(COLORS_PATH, Object.keys(next.colors).length === 0 && !next.uiFont ? undefined : { colors: next.colors, uiFont: next.uiFont || undefined })
  listeners.forEach((l) => l())
}

/** Reads the stored values again (another window saved them). */
export function reloadColorOverrides(): void {
  current = load()
  listeners.forEach((l) => l())
}

// Beim Laden der Konfiguration und bei Änderungen aus einem anderen Fenster neu lesen.
onConfigChange((path) => {
  if (touches(path, COLORS_PATH)) reloadColorOverrides()
})

export function subscribeColorOverrides(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

let appliedKeys: string[] = []

/** Puts the interface colours and the interface font on the window; earlier ones that are gone are taken off again. */
export function applyColorOverrides(overrides: ColorOverrides = current): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const key of appliedKeys) root.style.removeProperty(key)
  appliedKeys = []
  for (const [key, value] of Object.entries(overrides.colors)) {
    if (!key.startsWith('--')) continue
    root.style.setProperty(key, value)
    appliedKeys.push(key)
  }
  if (overrides.uiFont.trim()) {
    root.style.setProperty('--font-ui', overrides.uiFont.trim())
    appliedKeys.push('--font-ui')
  }
}

/** The editor part of the overrides: Monaco colour ids and syntax colours. */
export function editorOverrides(overrides: ColorOverrides = current): { colors: Record<string, string>; rules: { token: string; foreground: string }[] } {
  const colors: Record<string, string> = {}
  const rules: { token: string; foreground: string }[] = []
  for (const [key, value] of Object.entries(overrides.colors)) {
    if (key.startsWith('editor:')) colors[key.slice('editor:'.length)] = value
    else if (key.startsWith('syntax:')) rules.push({ token: key.slice('syntax:'.length), foreground: value.slice(1) })
  }
  return { colors, rules }
}
