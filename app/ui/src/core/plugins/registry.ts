import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import type { MenuEntry } from '../../tree/contextMenu'
import type { MenuContext, MenuItemDef } from '../../shell/menuModel'

// UI-Plugin-Register: Features (Git, SQL, Transpile ...) erweitern die Oberfläche selbst,
// der Kern kennt sie nicht. Ein Plugin ruft beim Start registerPlugin(...) und die
// register...-Funktionen auf; jede gibt eine Abmelde-Funktion zurück.
// Beiträge tragen optional `plugin` (Plugin-Id). Mit `plugin` gilt: Beitrag erscheint nur,
// wenn das Plugin registriert ist und alle seine `requires` ebenfalls (isPluginAvailable).
// Ohne `plugin` ist es ein Kern-Beitrag und immer da. `when` ist eine zusätzliche
// Laufzeit-Bedingung; sie wird beim Lesen ausgewertet (jeder Render).
// Menüs fragen nie "ist Git aktiv?", sondern: gibt es den Beitrag?
// Alle Register sind Stores (useSyncExternalStore); Hooks lesen sortiert nach `order`.

// ---------- Typen ----------

export interface PluginInfo {
  id: string
  name: string
  category: string
  version: string
  description: string
  requires?: string[]
  switchable: boolean
}

interface Contribution {
  /** Id des liefernden Plugins; leer = Kern. */
  plugin?: string
  order: number
  when?: () => boolean
}

export type CommandRun = (...args: unknown[]) => unknown

export interface MenuContribution extends Contribution {
  /** Id des Hauptmenüs (z. B. 'team'); unbekannte Ids legen ein neues Menü an. */
  menu: string
  /** Feste Einträge oder eine Funktion, die sie aus dem Menü-Kontext baut (Aktiv-Zustand, Hinweise). */
  items: MenuItemDef[] | ((ctx: MenuContext) => MenuItemDef[])
}

export interface OptionsPage extends Contribution {
  id: string
  category: string
  title: string
  component: ComponentType
}

/** Zustand, den die Toolbar den Beiträgen zum Berechnen von enabled/hint gibt. */
export interface ToolbarContext {
  hasProject: boolean
  /** Plugin in Tools > Plugins eingeschaltet (false = vom Nutzer abgeschaltet). */
  pluginActive: boolean
}

export interface ToolbarItem extends Contribution {
  id: string
  group: string
  label: string
  icon?: ReactNode
  command: string
  arg?: string
  /** Aktiv-Zustand und Tooltip aus dem Toolbar-Kontext; ohne Angabe: immer aktiv, Tooltip = label. */
  state?: (ctx: ToolbarContext) => { enabled: boolean; hint?: string }
}

/** Was die Statusleiste jedem Beitrag gibt: Daten der Shell je Plugin-Id und das gemeinsame Popup-Menü. */
export interface StatusBarSlotProps {
  data: Record<string, unknown>
  openMenu: (el: HTMLElement, entries: MenuEntry[], pick: (id: string) => void) => void
}

export interface StatusBarItem extends Contribution {
  id: string
  align: 'left' | 'right'
  component: ComponentType<StatusBarSlotProps>
}

export interface TreeContextItem extends Contribution {
  id: string
  objectTypes: string[]
  label: string
  command: string
}

export interface DialogEntry {
  id: string
  plugin?: string
  // Props sind Sache des öffnenden Plugins.
  component: ComponentType<any>
}

// ---------- Store ----------

interface State {
  plugins: Map<string, PluginInfo>
  commands: Map<string, { run: CommandRun; plugin?: string }>
  menus: MenuContribution[]
  options: OptionsPage[]
  toolbar: ToolbarItem[]
  statusBar: StatusBarItem[]
  tree: TreeContextItem[]
  dialogs: Map<string, DialogEntry>
}

function emptyState(): State {
  return {
    plugins: new Map(),
    commands: new Map(),
    menus: [],
    options: [],
    toolbar: [],
    statusBar: [],
    tree: [],
    dialogs: new Map(),
  }
}

let state: State = emptyState()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): State {
  return state
}

/** Ersetzt den Zustand unveränderlich (neue Referenz) und benachrichtigt die Hooks. */
function update(patch: Partial<State>): void {
  state = { ...state, ...patch }
  for (const l of [...listeners]) l()
}

/** Fügt ein Element nach Id ersetzend ein; gibt die Abmelde-Funktion zurück. */
function addList<K extends keyof State, T>(key: K, item: T, idOf: (t: T) => string | undefined): () => void {
  const list = state[key] as unknown as T[]
  const id = idOf(item)
  const next = [...list.filter((x) => id === undefined || idOf(x) !== id), item]
  update({ [key]: next } as Partial<State>)
  return () => {
    const cur = state[key] as unknown as T[]
    if (cur.includes(item)) update({ [key]: cur.filter((x) => x !== item) } as Partial<State>)
  }
}

// ---------- Verfügbarkeit ----------

function availableIn(s: State, id: string, seen: Set<string> = new Set()): boolean {
  const p = s.plugins.get(id)
  if (!p || seen.has(id)) return false
  seen.add(id)
  return (p.requires ?? []).every((r) => availableIn(s, r, new Set(seen)))
}

/** Plugin ist registriert und alle `requires` (rekursiv) auch. */
export function isPluginAvailable(id: string): boolean {
  return availableIn(state, id)
}

function visible(s: State, c: { plugin?: string; when?: () => boolean }): boolean {
  if (c.plugin !== undefined && !availableIn(s, c.plugin)) return false
  return c.when ? c.when() : true
}

function byOrder<T extends { order: number }>(list: T[]): T[] {
  // Array.sort ist stabil: gleiche `order` behalten Registrierungsreihenfolge.
  return [...list].sort((a, b) => a.order - b.order)
}

// ---------- register... ----------

export function registerPlugin(info: PluginInfo): () => void {
  const next = new Map(state.plugins).set(info.id, info)
  update({ plugins: next })
  return () => {
    if (state.plugins.get(info.id) !== info) return
    const m = new Map(state.plugins)
    m.delete(info.id)
    update({ plugins: m })
  }
}

export function registerCommand(id: string, run: CommandRun, plugin?: string): () => void {
  const entry = { run, plugin }
  update({ commands: new Map(state.commands).set(id, entry) })
  return () => {
    if (state.commands.get(id) !== entry) return
    const m = new Map(state.commands)
    m.delete(id)
    update({ commands: m })
  }
}

export function hasCommand(id: string): boolean {
  const c = state.commands.get(id)
  return !!c && (c.plugin === undefined || availableIn(state, c.plugin))
}

/** Führt den Befehl aus; false, wenn es ihn (oder sein Plugin) nicht gibt. */
export function runCommandById(id: string, ...args: unknown[]): boolean {
  if (!hasCommand(id)) return false
  state.commands.get(id)!.run(...args)
  return true
}

/** Wie runCommandById, wartet aber auf den Befehl (Fehler gehen an den Aufrufer). false = unbekannt. */
export async function runCommandAsync(id: string, ...args: unknown[]): Promise<boolean> {
  if (!hasCommand(id)) return false
  await state.commands.get(id)!.run(...args)
  return true
}

export function registerMenuContribution(c: MenuContribution): () => void {
  return addList('menus', c, () => undefined)
}

export function registerOptionsPage(p: OptionsPage): () => void {
  return addList('options', p, (x) => x.id)
}

export function registerToolbarItem(i: ToolbarItem): () => void {
  return addList('toolbar', i, (x) => x.id)
}

export function registerStatusBarItem(i: StatusBarItem): () => void {
  return addList('statusBar', i, (x) => x.id)
}

export function registerTreeContextItem(i: TreeContextItem): () => void {
  return addList('tree', i, (x) => x.id)
}

export function registerDialog(d: DialogEntry): () => void {
  update({ dialogs: new Map(state.dialogs).set(d.id, d) })
  return () => {
    if (state.dialogs.get(d.id) !== d) return
    const m = new Map(state.dialogs)
    m.delete(d.id)
    update({ dialogs: m })
  }
}

/** Dialog-Komponente, falls registriert und Plugin verfügbar. */
export function getDialog(id: string): DialogEntry | undefined {
  const d = state.dialogs.get(id)
  return d && visible(state, d) ? d : undefined
}

// ---------- Lesen (nicht-reaktiv) ----------

function readMenu(s: State, menu: string, ctx?: MenuContext): MenuItemDef[] {
  return byOrder(s.menus.filter((m) => m.menu === menu && visible(s, m))).flatMap((m) =>
    typeof m.items === 'function' ? (ctx ? m.items(ctx) : []) : m.items,
  )
}
function readOptions(s: State): OptionsPage[] {
  return byOrder(s.options.filter((p) => visible(s, p)))
}
function readToolbar(s: State, group: string): ToolbarItem[] {
  return byOrder(s.toolbar.filter((i) => i.group === group && visible(s, i)))
}
function readStatusBar(s: State, align: 'left' | 'right'): StatusBarItem[] {
  return byOrder(s.statusBar.filter((i) => i.align === align && visible(s, i)))
}
function readTree(s: State, objectType: string | null): TreeContextItem[] {
  if (!objectType) return []
  return byOrder(s.tree.filter((i) => i.objectTypes.includes(objectType) && visible(s, i)))
}

// ---------- Hooks ----------
// `when` kann sich ohne Store-Änderung ändern, daher wird bei jedem Render neu gefiltert.

export function useMenuContributions(menu: string, ctx?: MenuContext): MenuItemDef[] {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return readMenu(s, menu, ctx)
}

/** Nicht-reaktiv (für buildMenus): Einträge der Menü-Beiträge im aktuellen Zustand. */
export function getMenuContributions(menu: string, ctx?: MenuContext): MenuItemDef[] {
  return readMenu(state, menu, ctx)
}

export function useOptionsPages(): OptionsPage[] {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return readOptions(s)
}

export function useToolbarItems(group: string): ToolbarItem[] {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return readToolbar(s, group)
}

export function useStatusBarItems(align: 'left' | 'right'): StatusBarItem[] {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return readStatusBar(s, align)
}

export function useTreeContextItems(objectType: string | null): TreeContextItem[] {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return readTree(s, objectType)
}

export function usePlugins(): PluginInfo[] {
  const s = useSyncExternalStore(subscribe, getSnapshot)
  return [...s.plugins.values()]
}

/** Nur für Tests - Produktionscode muss das Register nie leeren. */
export function _resetPluginRegistryForTests(): void {
  state = emptyState()
  for (const l of [...listeners]) l()
}
