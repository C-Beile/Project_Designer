import type { SubTab } from '../tabs/tabModel'
import type { CodeTarget, DiffTarget, TreeNode } from '../wire/types'

// What the main window and its operating-system windows (floating panels, dialogs) say to each
// other. Everything travels as Tauri events; the project, the open objects and their unsaved state
// stay in the main window and in the backend actor, so a document is only ever edited in one place.

export type FloatView = 'scm' | 'services' | 'navigator' | 'properties' | 'output'

export const FLOAT_VIEWS: FloatView[] = ['scm', 'services', 'navigator', 'properties', 'output']

export const FLOAT_TITLES: Record<FloatView, string> = {
  scm: 'Source Control',
  services: 'Services',
  navigator: 'Navigator',
  properties: 'Properties',
  output: 'Output',
}

export const FLOAT_SIZES: Record<FloatView, { width: number; height: number }> = {
  scm: { width: 380, height: 640 },
  services: { width: 420, height: 560 },
  navigator: { width: 340, height: 560 },
  properties: { width: 420, height: 600 },
  output: { width: 760, height: 360 },
}

export const EVENTS = {
  windowResult: 'forge://window-result',
  windowGeometry: 'forge://window-geometry',
  floatReady: 'forge://float-ready',
  mainState: 'forge://main-state',
  floatAction: 'forge://float-action',
  scmRefresh: 'forge://scm-refresh',
  outputLines: 'forge://output-lines',
  editorCommand: 'forge://editor-command',
  closeRequested: 'forge://close-requested',
} as const

export interface Geometry {
  x: number
  y: number
  w: number
  h: number
}

/** The part of the main window's state that the floating Properties and Navigator draw from. */
export interface MainState {
  root: string
  /** `none` while nothing is selected; `project` and `module` show the project properties. */
  kind: 'none' | 'object' | 'project' | 'module'
  objectId: string | null
  objectType: string | null
  origin: string
  title: string
  projectName: string
  projectPath: string
  linkedRoot: string
  readOnlyHint: string
  selectedPath: string | null
  version: number
  /** Names of the model objects per type, for reference pickers. */
  objectsByType: Record<string, string[]>
}

export type FloatAction =
  | { type: 'navSelect'; nodeId: string; path: string; label: string }
  | { type: 'navReset'; path: string; label: string }
  | { type: 'navActivate'; path: string; label: string }
  | { type: 'edited'; nodeId: string }
  | { type: 'status'; text: string }
  | { type: 'goTo'; objectType: string; name: string }
  | { type: 'openCode'; code: CodeTarget }
  | { type: 'openFile'; path: string }
  | { type: 'modificationChanged' }
  | { type: 'openDiff'; target: DiffTarget }
  | { type: 'reload' }
  | { type: 'openSql'; sql: string }
  | { type: 'scmChanged' }
  | { type: 'editorDirty'; id: string; dirty: boolean }
  | { type: 'editorSaved'; id: string; ok: boolean }
  | { type: 'inspect'; nodeId: string; path: string; label: string }

/** What the main window asks an editor window to do. */
export type EditorCommand = { type: 'save'; id: string } | { type: 'refresh'; id: string } | { type: 'dock'; id: string } | { type: 'focus'; id: string }

/** What an editor window is opened with. */
export interface EditorWindowPayload {
  node: TreeNode
  project: string
  sub: SubTab
  /** Whether the document has unsaved changes at the moment it moves. */
  dirty: boolean
}

export interface WindowResultEvent {
  kind: 'float' | 'dialog' | 'editor'
  name: string
  /** JSON text of the result; null when the window was cancelled or closed. */
  result: string | null
  geometry?: Geometry | null
}

export function isFloatView(name: string): name is FloatView {
  return (FLOAT_VIEWS as string[]).includes(name)
}

/** Result of an editor window that docks back into the main window. */
export interface EditorDockResult {
  dock: true
  sub: SubTab
}
