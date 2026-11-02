import { useMemo, useState } from 'react'
import type { Problem } from '../problems/problemStore'
import { normId } from '../problems/problemStore'

// Scan Services window (manual 10.5, screenshot 170): errors and warnings of the whole project as
// a tree - type, object, file, message - with a button bar on the left: refresh, structure,
// show ignored, expand all, collapse all. "Ignore selected tasks" hides warnings (never errors)
// until "Include selected tasks" or the switch for ignored tasks brings them back.

export const SCAN_IGNORED_KEY = 'forge.scanIgnored.v1'

function loadIgnored(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SCAN_IGNORED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveIgnored(set: Set<string>) {
  try {
    window.localStorage.setItem(SCAN_IGNORED_KEY, JSON.stringify([...set]))
  } catch {
    // the choice still applies for this session
  }
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
          ↻
        </button>
        <button type="button" aria-label="Structure" title="Choose what is shown and how the tree is structured" aria-pressed={structureOpen} onClick={() => setStructureOpen((v) => !v)}>
          ▦
        </button>
        <button type="button" aria-label="Show ignored tasks" title="Show the tasks marked as ignored" aria-pressed={showIgnored} onClick={() => setShowIgnored((v) => !v)}>
          ⊖
        </button>
        <button type="button" aria-label="Expand all" title="Expand all nodes" onClick={() => setOpen(new Set(allKeys()))}>
          ⤢
        </button>
        <button type="button" aria-label="Collapse all" title="Collapse all nodes" onClick={() => setOpen(new Set())}>
          ⤡
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
          <span className="forge-field-hint">
            {scanning ? 'Scanning the project…' : visible.length === 0 ? 'No tasks found.' : `${errors} error(s), ${visible.length - errors} warning(s)`}
          </span>
        </div>
        <ul className="forge-scan-tree" role="tree" aria-label="Scan Services results">
          {groups.map((g) => {
            const gk = `g:${g.key}`
            return (
              <li key={g.key} role="treeitem" aria-expanded={open.has(gk)}>
                <button type="button" className="forge-scan-node" onClick={() => toggle(gk)}>
                  <span aria-hidden="true">{open.has(gk) ? '⌄' : '›'}</span> {g.label} ({g.count})
                </button>
                {open.has(gk) ? (
                  <ul role="group">
                    {g.objects.map((o) => {
                      const ok = `o:${g.key}:${o.key}`
                      const fk = `f:${g.key}:${o.key}`
                      return (
                        <li key={o.key} role="treeitem" aria-expanded={open.has(ok)}>
                          <button type="button" className="forge-scan-node" onClick={() => toggle(ok)}>
                            <span aria-hidden="true">{open.has(ok) ? '⌄' : '›'}</span> {o.label} ({o.tasks.length})
                          </button>
                          {open.has(ok) ? (
                            <ul role="group">
                              <li role="treeitem" aria-expanded={open.has(fk)}>
                                <button type="button" className="forge-scan-node" onClick={() => toggle(fk)}>
                                  <span aria-hidden="true">{open.has(fk) ? '⌄' : '›'}</span> {o.file}
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
                                          {t.severity === 'Error' ? '●' : '▲'}
                                        </span>
                                        {t.message}
                                        {t.line ? <span className="forge-field-hint"> [{t.line}]</span> : null}
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
