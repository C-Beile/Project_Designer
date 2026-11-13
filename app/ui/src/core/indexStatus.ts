import { useSyncExternalStore } from 'react'
import type { IndexProgress, IndexStatus } from '../wire/types'
import { notify } from './notifications'

// Stand des Projekt-Index je Projekt (Backend: crates/project-index). Gespeist von `forge://index-progress`
// und vom Befehl `index_status`. Der Name ist bewusst NICHT `projectIndex`: `editors/projectIndex.ts` meint etwas anderes.

export interface IndexEntry {
  project: string
  generation: number
  phase: IndexProgress['phase']
  done: number
  total: number
  percent: number | null
  currentFile: string | null
  /** Dauer des letzten fertigen Aufbaus in ms. */
  readyMs: number | null
  /** Zeitpunkt (ms), seit dem der Index fertig ist. */
  readyAt: number | null
}

interface State {
  projects: Record<string, IndexEntry>
}

let state: State = { projects: {} }
const listeners = new Set<() => void>()
let pending = false
let openLog: (() => void) | null = null

function emit() {
  for (const l of listeners) l()
}

/** Schreibt höchstens einmal pro Animations-Frame an die Oberfläche (der Fortschritt kommt oft). */
function scheduleEmit() {
  if (pending) return
  pending = true
  const run = () => {
    pending = false
    emit()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useIndexStatus(): State {
  return useSyncExternalStore(subscribe, () => state)
}

export function getIndexState(): State {
  return state
}

function put(entry: IndexEntry, now: () => number) {
  const old = state.projects[entry.project]
  if (old && entry.generation < old.generation) return
  const readyAt = entry.phase === 'ready' ? (old?.phase === 'ready' && old.generation === entry.generation ? old.readyAt : now()) : null
  state = { projects: { ...state.projects, [entry.project]: { ...entry, readyAt } } }
  scheduleEmit()
}

/** Event `forge://index-progress`. Alte Generationen werden ignoriert. */
export function applyIndexProgress(p: IndexProgress, now: () => number = Date.now): void {
  const old = state.projects[p.project]
  const parsedMs = p.phase === 'ready' && p.message ? Number.parseInt(p.message, 10) : NaN
  // Ein Aufbau kann unter einer Sekunde dauern, dann sieht man den Balken kaum. Das Ende meldet darum ein Hinweis.
  if (p.phase === 'ready' && old && BUSY.includes(old.phase) && p.generation >= old.generation) {
    const name = p.project.split(/[\\/]/).filter(Boolean).pop() ?? p.project
    const took = Number.isFinite(parsedMs) ? ` in ${(parsedMs / 1000).toFixed(1)} s` : ''
    notify(`Index ready: ${name}, ${p.done} objects${took}`, { kind: 'success', timeoutMs: 4000 })
  }
  put(
    {
      project: p.project,
      generation: p.generation,
      phase: p.phase,
      done: p.done,
      total: p.total,
      percent: p.percent,
      currentFile: p.currentFile ?? (p.phase === 'ready' ? null : (old?.currentFile ?? null)),
      readyMs: Number.isFinite(parsedMs) ? parsedMs : (old?.readyMs ?? null),
      readyAt: null,
    },
    now,
  )
}

/** Antwort von `index_status` (Stand nach einem Fenster-Reload). */
export function applyIndexStatus(s: IndexStatus, now: () => number = Date.now): void {
  put({ project: s.project, generation: s.generation, phase: s.phase, done: s.done, total: s.total, percent: null, currentFile: null, readyMs: s.lastBuildMs, readyAt: null }, now)
}

export function removeIndexProject(project: string): void {
  if (!(project in state.projects)) return
  const next = { ...state.projects }
  delete next[project]
  state = { projects: next }
  scheduleEmit()
}

const BUSY: ReadonlyArray<IndexProgress['phase']> = ['queued', 'listing', 'reading', 'linking']

export interface IndexSummary {
  kind: 'busy' | 'ready'
  text: string
  /** null = Dauer unbekannt (laufender Streifen). */
  percent: number | null
  tooltip: string
}

const READY_SHOWN_MS = 5000

/** Was die Statusleiste zeigt; `null` = nichts. */
export function summarizeIndex(projects: IndexEntry[], now: number): IndexSummary | null {
  const busy = projects.filter((p) => BUSY.includes(p.phase))
  if (busy.length > 0) {
    const names = busy.map((p) => p.project)
    const withPercent = busy.filter((p) => p.percent !== null)
    const percent = withPercent.length === busy.length ? Math.round(busy.reduce((s, p) => s + (p.percent ?? 0), 0) / busy.length) : null
    const queuedOnly = busy.every((p) => p.phase === 'queued')
    const listing = busy.find((p) => p.phase === 'listing')
    const file = [...busy].reverse().find((p) => p.currentFile)?.currentFile
    let text: string
    if (queuedOnly) text = 'Indexing queued...'
    else if (listing && percent === null) text = `Indexing... ${listing.done} files`
    else text = `Indexing ${percent ?? 0}%${file ? `  ${file}` : ''}`
    return { kind: 'busy', text, percent: queuedOnly ? null : percent, tooltip: `Project index: ${names.join(', ')}` }
  }
  const ready = projects.filter((p) => p.phase === 'ready' && p.readyAt !== null && now - p.readyAt < READY_SHOWN_MS)
  if (ready.length > 0) {
    const ms = ready.reduce((s, p) => s + (p.readyMs ?? 0), 0)
    return { kind: 'ready', text: ms > 0 ? `Index ready (${(ms / 1000).toFixed(1)} s)` : 'Index ready', percent: 100, tooltip: `Project index ready: ${ready.map((p) => p.project).join(', ')}` }
  }
  return null
}

export const INDEX_READY_SHOWN_MS = READY_SHOWN_MS

/** Die Shell sagt, was ein Klick auf den Eintrag tut (Output > IDE Log öffnen). */
export function setIndexOpenLog(fn: (() => void) | null): void {
  openLog = fn
}

export function openIndexLog(): void {
  openLog?.()
}

export function _resetIndexStatusForTests(): void {
  state = { projects: {} }
  openLog = null
  pending = false
  emit()
}
