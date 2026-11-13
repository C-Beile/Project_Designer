import { configGet, configSet } from '../settings/appConfig'
import { useMemo, useState } from 'react'
import type { Problem } from '../problems/problemStore'
import { normId } from '../problems/problemStore'
import { Chevron, SeverityIcon } from './SeverityIcon'

// Scan Services window (manual 10.5, screenshot 170): errors and warnings of the whole project as
// a tree - type, object, file, message - with a button bar on the left: refresh, structure,
// show ignored, expand all, collapse all. "Ignore selected tasks" hides warnings (never errors)
// until "Include selected tasks" or the switch for ignored tasks brings them back.

const IGNORED_PATH = ['scan', 'ignored'] as const

function loadIgnored(): Set<string> {
  const parsed = configGet<unknown>(...IGNORED_PATH)
  return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
}

function saveIgnored(set: Set<string>) {
  configSet(IGNORED_PATH, [...set])
}

export const taskKey = (p: Problem) => `${normId(p.nodeId ?? p.file ?? '')}|${p.message}`

interface Group {
  key: string
  label: string
  count: number
  objects: { key: string; label: string; file: string; tasks: Problem[] }[]
}

export function groupProblems(problems: Problem[], by: 'type' | 'severity'): Group[] {
  const groups = new Map<string, Map<string, Problem[]>>()
  for (const p of problems) {
    const g = by === 'type' ? (p.objectType ?? 'project') : p.severity
    const o = p.nodeId ?? p.file ?? '(build)'
    if (!groups.has(g)) groups.set(g, new Map())
    const objs = groups.get(g)!
    if (!objs.has(o)) objs.set(o, [])
    objs.get(o)!.push(p)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, objs]) => ({
      key,
      label: key,
      count: [...objs.values()].reduce((n, l) => n + l.length, 0),
      objects: [...objs.entries()]
        .map(([k, tasks]) => ({ key: k, label: tasks[0].object ?? k.split(/[\\/]/).pop() ?? k, file: k.split(/[\\/]/).pop() ?? k, tasks }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })),
    }))
}

function ToolIcon({ kind }: { kind: 'refresh' | 'structure' | 'ignored' | 'expand' | 'collapse' }) {
  const p = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
  switch (kind) {
    case 'refresh':
      return (
        <svg {...p}>
          <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
        </svg>
      )
    case 'structure':
      return (
        <svg {...p}>
          <path d="M2.5 3.5h4M5.5 8h4M8.5 12.5h5M2.5 3.5v4.5h3M5.5 8v4.5h3" />
        </svg>
      )
    case 'ignored':
      return (
        <svg {...p}>
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
          <path d="M3 13L13 3" />
        </svg>
      )
    case 'expand':
      return (
        <svg {...p}>
          <path d="M4 6l4-3 4 3M4 10l4 3 4-3" />
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <path d="M4 3l4 3 4-3M4 13l4-3 4 3" />
        </svg>
      )
  }
}

export function ScanServicesPanel({ problems, scanning, onRefresh, onOpen }: { problems: Problem[]; scanning: boolean; onRefresh: () => void; onOpen: (p: Problem) => void }) {
  const [ignored, setIgnored] = useState<Set<string>>(loadIgnored)
  const [showIgnored, setShowIgnored] = useState(false)
  const [by, setBy] = useState<'type' | 'severity'>('type')
  const [includeWarnings, setIncludeWarnings] = useState(true)
  const [structureOpen, setStructureOpen] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const visible = useMemo(
    () => problems.filter((p) => p.source !== 'build' && p.source !== 'js').filter((p) => (p.severity === 'Error' || includeWarnings) && (showIgnored || !ignored.has(taskKey(p)))),
    [problems, ignored, showIgnored, includeWarnings],
  )
  const groups = useMemo(() => groupProblems(visible, by), [visible, by])

  const allKeys = () => {
    const keys: string[] = []
    for (const g of groups) {
      keys.push(`g:${g.key}`)
      for (const o of g.objects) keys.push(`o:${g.key}:${o.key}`, `f:${g.key}:${o.key}`)
    }
    return keys
  }

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function setIgnore(to: boolean) {
    const tasks = visible.filter((p) => selected.has(p.id))
    const next = new Set(ignored)
    for (const t of tasks) {
      if (to && t.severity === 'Error') continue
      if (to) next.add(taskKey(t))
      else next.delete(taskKey(t))
    }
    setIgnored(next)
    saveIgnored(next)
    setSelected(new Set())
  }

  const selectedTasks = visible.filter((p) => selected.has(p.id))
  const errors = visible.filter((p) => p.severity === 'Error').length

  return (
    <div className="forge-scan">
      <div className="forge-scan-bar" role="toolbar" aria-label="Scan Services actions" aria-orientation="vertical">
        <button type="button" aria-label="Refresh" title="Refresh all Scan Services for the complete project" onClick={onRefresh} disabled={scanning}>
          <ToolIcon kind="refresh" />
        </button>
        <button type="button" aria-label="Structure" title="Choose what is shown and how the tree is structured" aria-pressed={structureOpen} onClick={() => setStructureOpen((v) => !v)}>
          <ToolIcon kind="structure" />
        </button>
        <button type="button" aria-label="Show ignored tasks" title="Show the tasks marked as ignored" aria-pressed={showIgnored} onClick={() => setShowIgnored((v) => !v)}>
          <ToolIcon kind="ignored" />
        </button>
        <button type="button" aria-label="Expand all" title="Expand all nodes" onClick={() => setOpen(new Set(allKeys()))}>
          <ToolIcon kind="expand" />
        </button>
        <button type="button" aria-label="Collapse all" title="Collapse all nodes" onClick={() => setOpen(new Set())}>
          <ToolIcon kind="collapse" />
        </button>
      </div>
      <div className="forge-scan-main">
        {structureOpen ? (
          <div className="forge-scan-structure" role="group" aria-label="Structure">
            <label className="forge-check">
              <input type="radio" name="scan-by" checked={by === 'type'} onChange={() => setBy('type')} />
              <span>By model type</span>
            </label>
            <label className="forge-check">
              <input type="radio" name="scan-by" checked={by === 'severity'} onChange={() => setBy('severity')} />
              <span>By severity</span>
            </label>
            <label className="forge-check">
              <input type="checkbox" checked={includeWarnings} onChange={(e) => setIncludeWarnings(e.target.checked)} />
              <span>Include warnings</span>
            </label>
          </div>
        ) : null}
        <div className="forge-scan-actions">
          <button type="button" disabled={selectedTasks.length === 0 || selectedTasks.every((t) => t.severity === 'Error')} onClick={() => setIgnore(true)}>
            Ignore selected tasks
          </button>
          <button type="button" disabled={selectedTasks.length === 0 || !selectedTasks.some((t) => ignored.has(taskKey(t)))} onClick={() => setIgnore(false)}>
            Include selected tasks
          </button>
          <button type="button" disabled={selectedTasks.length !== 1} onClick={() => selectedTasks[0] && onOpen(selectedTasks[0])}>
            Open in editor
          </button>
          <span className="forge-field-hint forge-scan-summary">
            {scanning ? 'Scanning the project…' : visible.length === 0 ? 'No tasks found.' : `${errors} error(s), ${visible.length - errors} warning(s)`}
          </span>
        </div>
        <ul className="forge-scan-tree" role="tree" aria-label="Scan Services results">
          {groups.map((g) => {
            const gk = `g:${g.key}`
            return (
              <li key={g.key} role="treeitem" aria-expanded={open.has(gk)}>
                <button type="button" className="forge-scan-node" onClick={() => toggle(gk)}>
                  <Chevron open={open.has(gk)} />
                  <span className="forge-scan-label">{g.label}</span>
                  <span className="forge-count">{g.count}</span>
                </button>
                {open.has(gk) ? (
                  <ul role="group">
                    {g.objects.map((o) => {
                      const ok = `o:${g.key}:${o.key}`
                      const fk = `f:${g.key}:${o.key}`
                      return (
                        <li key={o.key} role="treeitem" aria-expanded={open.has(ok)}>
                          <button type="button" className="forge-scan-node" onClick={() => toggle(ok)}>
                            <Chevron open={open.has(ok)} />
                            <span className="forge-scan-label">{o.label}</span>
                            <span className="forge-count">{o.tasks.length}</span>
                          </button>
                          {open.has(ok) ? (
                            <ul role="group">
                              <li role="treeitem" aria-expanded={open.has(fk)}>
                                <button type="button" className="forge-scan-node" onClick={() => toggle(fk)}>
                                  <Chevron open={open.has(fk)} />
                                  <span className="forge-scan-label is-file">{o.file}</span>
                                </button>
                                {open.has(fk) ? (
                                  <ul role="group">
                                    {o.tasks.map((t) => (
                                      <li
                                        key={t.id}
                                        role="treeitem"
                                        aria-selected={selected.has(t.id)}
                                        className={`forge-scan-task is-${t.severity.toLowerCase()}${ignored.has(taskKey(t)) ? ' is-ignored' : ''}${selected.has(t.id) ? ' is-selected' : ''}`}
                                        onClick={(e) =>
                                          setSelected((prev) => {
                                            const next = new Set(e.ctrlKey || e.metaKey ? prev : [])
                                            if (next.has(t.id) && (e.ctrlKey || e.metaKey)) next.delete(t.id)
                                            else next.add(t.id)
                                            return next
                                          })
                                        }
                                        onDoubleClick={() => onOpen(t)}
                                      >
                                        <span className="forge-scan-icon" aria-label={t.severity}>
                                          <SeverityIcon severity={t.severity} />
                                        </span>
                                        <span className="forge-scan-message">{t.message}</span>
                                        {t.line ? <span className="forge-scan-line">{t.line}</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </li>
                            </ul>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
