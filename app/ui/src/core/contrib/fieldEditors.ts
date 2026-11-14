import type { ComponentType } from 'react'
import type { ForgeApi } from '../../api/ForgeApi'
import type { SheetRow, WireValue } from '../../wire/types'
import { createStore } from '../store'

/** Was ein Panel einem Feld-Editor mitgibt: die Zeile, den Zustand und die Handgriffe des Panels. */
export interface FieldContext {
  api: ForgeApi
  row: SheetRow
  canEdit: boolean
  /** Werte, die ein Verweis anbietet. */
  options: string[]
  commit: (value: WireValue) => void
  openLinked: () => void
  openList: () => void
  goTo: () => void
  search: () => void
  pickIcon: () => void
  browseImage: () => void
  browseConfig: () => void
  editConfig: () => void
  /** Das Panel kennt einen Editor für die Config-Datei (System-Objekt, Pfad `$`). */
  canEditConfig: boolean
  hasProject: boolean
}

export interface FieldEditorSpec {
  id: string
  /** Der erste Editor, dessen `matches` stimmt, zeichnet den Wert (kleinere `order` zuerst). */
  matches: (row: SheetRow) => boolean
  order?: number
  component: ComponentType<{ ctx: FieldContext }>
}

export interface FieldActionSpec {
  id: string
  /** Alle Aktionen, deren `matches` stimmt, erscheinen als Knöpfe hinter dem Wert. */
  matches: (row: SheetRow, ctx: FieldContext) => boolean
  order?: number
  component: ComponentType<{ ctx: FieldContext }>
}

const editors = createStore<FieldEditorSpec[]>([])
const actions = createStore<FieldActionSpec[]>([])

const byOrder = <T extends { order?: number }>(list: T[]) => [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

/** Neue Wertdarstellung für Eigenschaften = ein Aufruf. Eine Id ersetzt den früheren Eintrag. */
export function registerFieldEditor(spec: FieldEditorSpec): () => void {
  editors.update((list) => [...list.filter((e) => e.id !== spec.id), spec])
  return () => editors.update((list) => list.filter((e) => e !== spec))
}

export function registerFieldAction(spec: FieldActionSpec): () => void {
  actions.update((list) => [...list.filter((a) => a.id !== spec.id), spec])
  return () => actions.update((list) => list.filter((a) => a !== spec))
}

export function findFieldEditor(row: SheetRow): FieldEditorSpec | undefined {
  return byOrder(editors.get()).find((e) => e.matches(row))
}

export function getFieldActions(row: SheetRow, ctx: FieldContext): FieldActionSpec[] {
  return byOrder(actions.get()).filter((a) => a.matches(row, ctx))
}

export function _resetFieldEditorsForTests(): void {
  editors.set([])
  actions.set([])
}
