import { useEffect, useMemo, useRef, useState } from 'react'
import { configGet, configSet } from '../settings/appConfig'
import { ConfiguredIcon } from '../core/icons/Icon'
import { Button, Dropdown, Input, MultiSelect } from '../core/ui/controls'
import { projectColor } from '../core/projectColor'
import { objectTypeId } from '../tree/treeIcons'
import { baseName } from './shellHelpers'

// Datei > Open (Ctrl+O): Popup im Designer. Sucht die Objekte aller offenen Projekte, gruppiert nach
// Projekt (einklappbar, nur Projekte mit Treffern). `*` ist Platzhalter, Enter oder Klick öffnet.
// Welche Typen gesucht werden, merkt sich `designer.conf` (`[search] disabledTypes`).

export interface ModelEntry {
  type: string
  name: string
  /** Projektordner, zu dem das Objekt gehört (leer: ein Projekt). */
  projectRoot?: string
}

export function matchModels<T extends { name: string }>(models: T[], query: string, limit = 200): T[] {
  const q = query.trim()
  if (!q) return models.slice(0, limit)
  const pattern = new RegExp(q.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i')
  return models.filter((m) => pattern.test(m.name)).slice(0, limit)
}

const TYPE_LABELS: Record<string, string> = {
  entity: 'Entity',
  neonView: 'View',
  neonContext: 'Context',
  process: 'Process',
  system: 'System',
  aliasDefinition: 'Alias',
  serviceDefinition: 'Service',
  entityWebservice: 'Service',
}
const typeLabel = (type: string) => TYPE_LABELS[type] ?? type

const typeColor = (type: string) => `var(--folder-${objectTypeId(type)}, var(--fg-muted))`

function TypeIcon({ type }: { type: string }) {
  return (
    <span className="open-model-icon" style={{ color: typeColor(type) }}>
      <ConfiguredIcon id={objectTypeId(type)} area="tree" fallback="file-text" />
    </span>
  )
}

const readDisabled = () => configGet<string[]>('search', 'disabledTypes') ?? []

type GroupBy = 'project' | 'type'
const GROUP_OPTIONS = [
  { id: 'project', label: 'By project' },
  { id: 'type', label: 'By type' },
]
const readGroupBy = (): GroupBy => (configGet<string>('search', 'groupBy') === 'type' ? 'type' : 'project')

/** So viele Treffer zeigt ein Projekt, bis man es aufklappt (damit das nächste Projekt sichtbar bleibt). */
const PER_PROJECT = 6

interface Group {
  key: string
  /** Nur bei Gruppierung nach Typ. */
  type?: string
  label: string
  rows: ModelEntry[]
}

interface ResultGroupsProps {
  groups: Group[]
  byType: boolean
  projects: string[]
  closed: Set<string>
  expanded: Set<string>
  onExpand: (root: string) => void
  visible: ModelEntry[]
  current: number
  onToggle: (root: string) => void
  onHover: (index: number) => void
  onPick: (m: ModelEntry) => void
}

function ResultGroups({ groups, byType, projects, closed, expanded, onExpand, visible, current, onToggle, onHover, onPick }: ResultGroupsProps) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.key} role="group" aria-label={g.label}>
          <Button variant="bare" className="ui-Button open-model-group" aria-expanded={!closed.has(g.key)} title={byType ? g.label : g.key} onPress={() => onToggle(g.key)}>
            <ConfiguredIcon id="chevron" area="control" fallback={closed.has(g.key) ? 'caret-right' : 'caret-down'} size="sm" />
            {g.type ? <TypeIcon type={g.type} /> : null}
            {!byType && projects.length > 1 && projectColor(g.key, projects) ? <span className="open-model-dot" style={{ background: projectColor(g.key, projects) }} /> : null}
            <span className="open-model-group-name">{g.label}</span>
            <span className="open-model-count">{g.rows.length}</span>
          </Button>
          {closed.has(g.key)
            ? null
            : (expanded.has(g.key) ? g.rows : g.rows.slice(0, PER_PROJECT)).map((m) => (
                <div
                  key={`${m.projectRoot}:${m.type}:${m.name}`}
                  role="option"
                  aria-selected={visible[current] === m}
                  className={`open-model-row${visible[current] === m ? ' is-selected' : ''}`}
                  onMouseMove={() => onHover(visible.indexOf(m))}
                  onClick={() => onPick(m)}
                >
                  <span className="open-model-bar-type" style={{ background: typeColor(m.type) }} />
                  {byType ? null : <TypeIcon type={m.type} />}
                  <span className="open-model-name">{m.name}</span>
                  <span className="open-model-type" style={byType ? undefined : { color: typeColor(m.type) }}>
                    {byType ? (m.projectRoot ? baseName(m.projectRoot) : '') : typeLabel(m.type)}
                  </span>
                </div>
              ))}
          {!closed.has(g.key) && !expanded.has(g.key) && g.rows.length > PER_PROJECT ? (
            <Button variant="bare" className="ui-Button open-model-more" onPress={() => onExpand(g.key)}>
              Show {g.rows.length - PER_PROJECT} more
            </Button>
          ) : null}
        </div>
      ))}
    </>
  )
}

export function OpenModelDialog({ models, projects = [], onPick, onClose }: { models: ModelEntry[]; projects?: string[]; onPick: (m: ModelEntry) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [disabled, setDisabled] = useState<string[]>(readDisabled)
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [groupBy, setGroupBy] = useState<GroupBy>(readGroupBy)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const types = useMemo(() => [...new Set(models.map((m) => m.type))].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b))), [models])
  const enabled = types.filter((t) => !disabled.includes(t))

  const groups = useMemo<Group[]>(() => {
    const hits = matchModels(
      models.filter((m) => !disabled.includes(m.type)),
      query,
    )
    const byKey = new Map<string, ModelEntry[]>()
    for (const m of hits) {
      const key = groupBy === 'type' ? m.type : (m.projectRoot ?? '')
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push(m)
    }
    const list = [...byKey.entries()].map(([key, rows]): Group => (groupBy === 'type' ? { key, type: key, label: typeLabel(key), rows } : { key, label: key ? baseName(key) : 'Project', rows }))
    return groupBy === 'type' ? list.sort((a, b) => a.label.localeCompare(b.label)) : list
  }, [models, disabled, query, groupBy])

  const visible = useMemo(() => groups.flatMap((g) => (closed.has(g.key) ? [] : expanded.has(g.key) ? g.rows : g.rows.slice(0, PER_PROJECT))), [groups, closed, expanded])
  const total = groups.reduce((n, g) => n + g.rows.length, 0)

  useEffect(() => {
    setIndex(0)
    setClosed(new Set())
    setExpanded(new Set())
  }, [query, groupBy])
  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView?.({ block: 'nearest' })
  }, [index])

  const setEnabledTypes = (ids: string[]) => {
    const next = types.filter((t) => !ids.includes(t))
    setDisabled(next)
    setIndex(0)
    configSet(['search', 'disabledTypes'], next)
  }
  const changeGroupBy = (v: string) => {
    const next: GroupBy = v === 'type' ? 'type' : 'project'
    setGroupBy(next)
    configSet(['search', 'groupBy'], next === 'type' ? 'type' : '')
  }
  const toggleGroup = (root: string) =>
    setClosed((prev) => {
      const next = new Set(prev)
      if (!next.delete(root)) next.add(root)
      return next
    })

  const filterActive = enabled.length < types.length
  const current = Math.min(index, Math.max(0, visible.length - 1))

  return (
    <div className="forge-qs-backdrop open-model-backdrop" onMouseDown={onClose}>
      <div
        className="open-model"
        role="dialog"
        aria-label="Open"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex(Math.min(visible.length - 1, current + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex(Math.max(0, current - 1))
          } else if (e.key === 'Enter' && visible[current]) {
            e.preventDefault()
            onPick(visible[current])
          }
        }}
      >
        <div className="open-model-bar">
          <Input autoFocus type="text" placeholder="Name, * as wildcard" aria-label="Data model name" value={query} onChange={(e) => setQuery(e.target.value)} />
          <MultiSelect
            aria-label="Search in types"
            options={types.map((t) => ({ id: t, label: typeLabel(t), icon: <TypeIcon type={t} /> }))}
            value={enabled}
            onChange={setEnabledTypes}
            active={filterActive}
            summary={filterActive ? `${enabled.length} of ${types.length} types` : 'All types'}
          />
          <Dropdown aria-label="Group results" value={groupBy} options={GROUP_OPTIONS} onChange={changeGroupBy} />
        </div>
        <div ref={listRef} className="open-model-list" role="listbox" aria-label="Matching data models">
          <ResultGroups groups={groups} byType={groupBy === 'type'} projects={projects} closed={closed} visible={visible} current={current} onToggle={toggleGroup} onExpand={(root) => setExpanded((prev) => new Set(prev).add(root))} expanded={expanded} onHover={setIndex} onPick={onPick} />
          {total === 0 ? <div className="open-model-empty">{filterActive ? 'No data model matches. Check the type filter.' : 'No data model matches.'}</div> : null}
        </div>
        <div className="open-model-hint">
          <span>Enter opens · Esc closes</span>
          <span>
            {total} {total === 1 ? 'match' : 'matches'} in {groups.length} {groupBy === 'type' ? (groups.length === 1 ? 'type' : 'types') : groups.length === 1 ? 'project' : 'projects'}
          </span>
        </div>
      </div>
    </div>
  )
}
