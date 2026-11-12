import { configGet, configSet, onConfigChange, touches } from './appConfig'
// Plugin list of Tools > Plugins (manual chapter 14). The original Designer loads NetBeans
// modules (nbm); Dito Designer has no such plugin loader. Its plugins are built-in components,
// so the dialog shows them with their real state: active, deactivated by the user, or not
// implemented yet. Only components that can be switched off safely may be deactivated.

export interface PluginInfo {
  id: string
  name: string
  category: string
  version: string
  author: string
  description: string
  /** The component exists in this version. */
  implemented: boolean
  /** The user may deactivate it (menus and buttons of the component are then dimmed). */
  switchable: boolean
  /** Off until the user switches it on (for example the VS Code theme import). */
  defaultOff?: boolean
  notes: string[]
}

const VERSION = '1.0.0-rc11'
const AUTHOR = 'C.Beile'

export const PLUGINS: PluginInfo[] = [
  {
    id: 'asciidoc',
    name: 'AsciidoctorJ',
    category: 'ADITO / AsciiDoc',
    version: '-',
    author: 'ADITO Software GmbH',
    description: 'Preview tab for adoc files (manual 14.3). Not implemented in Dito Designer yet.',
    implemented: false,
    switchable: false,
    notes: [],
  },
  {
    id: 'cloud',
    name: 'Cloud Support',
    category: 'ADITO / Cloud',
    version: '-',
    author: 'ADITO Software GmbH',
    description: 'Connecting to cloud systems through the Self-Service Portal (manual 14.6). Not implemented yet; the SSH tunnel with basic or key authentication is available in the Services window.',
    implemented: false,
    switchable: false,
    notes: [],
  },
  {
    id: 'liquibase',
    name: 'Liquibase',
    category: 'ADITO / Database',
    version: '-',
    author: 'ADITO Software GmbH',
    description: 'Update, Drop All and the changelog helpers (manual 14.5). Not implemented yet; changelog files appear in the project tree and can be edited as text.',
    implemented: false,
    switchable: false,
    notes: [],
  },
  {
    id: 'nodejs',
    name: 'NodeJS & TypeScript',
    category: 'ADITO / Editors',
    version: '-',
    author: 'ADITO Software GmbH',
    description: 'npm install, NodeJS scripts and run configs (manual 14.7). Not implemented yet; js, ts and json files open in the text editor.',
    implemented: false,
    switchable: false,
    notes: [],
  },
  {
    id: 'encoding',
    name: 'Encoding Support',
    category: 'ADITO / File',
    version: VERSION,
    author: AUTHOR,
    description: 'Files are read and written byte for byte; encoding and line endings of existing files are kept.',
    implemented: true,
    switchable: false,
    notes: ['Built into the application.'],
  },
  {
    id: 'sqlformatter',
    name: 'SQL Formatter',
    category: 'ADITO / SQL',
    version: '-',
    author: 'ADITO Software GmbH',
    description: 'Formatting of SQL statements (manual 14.9). Not implemented yet.',
    implemented: false,
    switchable: false,
    notes: [],
  },
  {
    id: 'git',
    name: 'Git',
    category: 'ADITO / VCS',
    version: VERSION,
    author: AUTHOR,
    description: 'Commit, Pull, Push, Switch Branch and History through the Team menu, the toolbar and the context menu. Stash, revert, cherry-pick and the history graph are missing.',
    implemented: true,
    switchable: true,
    notes: ['Deactivating dims the Team menu, the git toolbar buttons and the Git entries of the context menus.'],
  },
  {
    id: 'vscode-themes',
    name: 'VS Code Theme Import',
    category: 'Dito / Appearance',
    version: VERSION,
    author: AUTHOR,
    description: 'Installs colour themes of VS Code (.json, .tmTheme, .vsix, the folder of an extension) and lists them in Options > Appearance. Colours can always be changed by hand, with or without this plugin.',
    implemented: true,
    switchable: true,
    defaultOff: true,
    notes: ['Off by default. Switching it off brings the standard theme back.'],
  },
  {
    id: 'sql',
    name: 'Execute SQL',
    category: 'Dito / Database',
    version: VERSION,
    author: AUTHOR,
    description: 'SQL window of the Services tab with result tabs, history and export.',
    implemented: true,
    switchable: true,
    notes: ['Deactivating dims the SQL button of the toolbar.'],
  },
  {
    id: 'deploy',
    name: 'Deploy',
    category: 'Dito / Database',
    version: VERSION,
    author: AUTHOR,
    description: 'Deploy of the project into the system database.',
    implemented: true,
    switchable: false,
    notes: ['Core component.'],
  },
  {
    id: 'catalog',
    name: 'Property Catalog',
    category: 'Dito / Core',
    version: VERSION,
    author: AUTHOR,
    description: 'Reads the property definitions out of the installed ADITO Designer.',
    implemented: true,
    switchable: false,
    notes: ['Core component.'],
  },
  {
    id: 'modifications',
    name: 'Modifications',
    category: 'Dito / Core',
    version: VERSION,
    author: AUTHOR,
    description: 'Edits of module objects are written as modifications of the project.',
    implemented: true,
    switchable: false,
    notes: ['Core component.'],
  },
  {
    id: 'transpiler',
    name: 'Transpiler',
    category: 'Dito / Core',
    version: VERSION,
    author: AUTHOR,
    description: 'Partial and full transpile with the official ADITO transpiler or the experimental own engine.',
    implemented: true,
    switchable: false,
    notes: ['Core component.'],
  },
]

/**
 * Liste für den Plugins-Dialog: die feste Liste, aber Name, Kategorie, Version, Beschreibung und
 * "abschaltbar" kommen aus dem UI-Register, sobald sich ein Plugin dort angemeldet hat.
 * Ein Plugin, das im Register steht, aber nicht in der festen Liste, wird angehängt.
 */
export function mergePluginList(registered: { id: string; name: string; category: string; version: string; description: string; switchable: boolean }[]): PluginInfo[] {
  const byId = new Map(registered.map((r) => [r.id, r]))
  const merged = PLUGINS.map((p) => {
    const r = byId.get(p.id)
    if (!r) return p
    byId.delete(p.id)
    return { ...p, name: r.name, category: r.category, version: r.version, description: r.description, switchable: r.switchable, implemented: true }
  })
  for (const r of byId.values()) merged.push({ ...r, author: AUTHOR, implemented: true, notes: [] })
  return merged
}

const PLUGINS_PATH = ['plugins'] as const

export interface PluginPrefs {
  deactivated: string[]
  /** Plugins that are off by default and that the user switched on. */
  activated: string[]
  /** How often the (non-existing) catalog would be checked; kept for the Settings tab. */
  checkFrequency: 'startup' | 'weekly' | 'monthly' | 'never'
}

function load(): PluginPrefs {
  const parsed = configGet<Partial<PluginPrefs>>(...PLUGINS_PATH) ?? {}
  const freq = parsed.checkFrequency
  return {
    deactivated: Array.isArray(parsed.deactivated) ? parsed.deactivated.filter((x): x is string => typeof x === 'string') : [],
    activated: Array.isArray(parsed.activated) ? parsed.activated.filter((x): x is string => typeof x === 'string') : [],
    checkFrequency: freq === 'weekly' || freq === 'monthly' || freq === 'never' ? freq : 'startup',
  }
}

let current = load()
const listeners = new Set<() => void>()

export function getPluginPrefs(): PluginPrefs {
  return current
}

export function setPluginPrefs(next: PluginPrefs): void {
  current = next
  // Der Standard (Start-Prüfung) steht nicht in der Datei.
  configSet(PLUGINS_PATH, { ...next, checkFrequency: next.checkFrequency === 'startup' ? undefined : next.checkFrequency })
  listeners.forEach((l) => l())
}

/** Reads the choice from storage again, after the Plugins window (another window) changed it. */
export function reloadPluginPrefs(): void {
  current = load()
  listeners.forEach((l) => l())
}

// Beim Laden der Konfiguration und bei Änderungen aus einem anderen Fenster (Plugins-Fenster) neu lesen.
onConfigChange((path) => {
  if (touches(path, PLUGINS_PATH)) reloadPluginPrefs()
})

export function subscribePluginPrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function pluginState(plugin: PluginInfo, prefs: PluginPrefs): 'active' | 'deactivated' | 'missing' {
  if (!plugin.implemented) return 'missing'
  if (plugin.defaultOff) return prefs.activated.includes(plugin.id) ? 'active' : 'deactivated'
  return prefs.deactivated.includes(plugin.id) ? 'deactivated' : 'active'
}

/** The prefs with the given plugins switched on or off; a plugin that is off by default is tracked the other way round. */
export function withPluginActive(prefs: PluginPrefs, ids: string[], active: boolean): PluginPrefs {
  let { deactivated, activated } = prefs
  for (const id of ids) {
    if (PLUGINS.find((p) => p.id === id)?.defaultOff) activated = active ? [...activated.filter((x) => x !== id), id] : activated.filter((x) => x !== id)
    else deactivated = active ? deactivated.filter((x) => x !== id) : [...deactivated.filter((x) => x !== id), id]
  }
  return { ...prefs, deactivated, activated }
}

export function isPluginActive(id: string, prefs: PluginPrefs = current): boolean {
  const p = PLUGINS.find((x) => x.id === id)
  return !!p && pluginState(p, prefs) === 'active'
}

export function resetPluginsForTests(): void {
  current = { deactivated: [], activated: [], checkFrequency: 'startup' }
  configSet(PLUGINS_PATH, undefined)
}
