import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorProps } from './registry'
import { field, textField, textValue } from '../wire/types'
import { EditableText } from './EditableText'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'
import { confirmDialog, promptDialog } from '../core/dialogService'
import { useProjectIndex } from './projectIndex'
import { addEntry, deleteEntry, parseLanguageEntries, setEntry } from './languageEntries'
import { copyValuesPlan, removeKeysPlan } from './languageOps'
import { errorText } from '../core/errorText'

// Language editor (original Designer, shot 103): table Module | Key | Value, sortable by column,
// thousands of rows drawn through a window of rows. Key and value of every row can be edited
// (double click, or just type on the selected row; Enter, Tab and Esc as in a grid), a completely
// empty row can be added (button, context menu, Insert key) and a row deleted (with a question).
// Everything is written as text of the .aod file (`languageEntries.ts`): the order of the entries,
// the line ends and the escaping of the file stay as they are, and every change is one undo step.
// Module objects are read-only: the automatic modification (MODIFY / INSERT / DELETE of single
// entries) is not built for language entries.
//
// A second shape exists under the same `language` folder (`_____LANGUAGE_EXTRA`: `sqlModels`
// instead of a `keyValueMap`); it has no key/value pairs and gets a note.

const ROW_H = 22

// The nine toolbar icons of the original in their order (shot 106). Their meaning is not documented
// (the first three look like import and export, the others like refresh, edit, search, language and
// table functions); only Refresh does something here, the others are shown dimmed.
const ORIGINAL_ICONS: { label: string; glyph: string; hint: string; working: boolean }[] = [
  { label: 'Export', glyph: '\u2B06', hint: 'Export', working: false },
  { label: 'Import', glyph: '\u2B07', hint: 'Import', working: false },
  { label: 'Import from file', glyph: '\u2913', hint: 'Import from file', working: false },
  { label: 'Refresh', glyph: '\u21BB', hint: 'Reads the file again', working: true },
  { label: 'Edit', glyph: '\u270E', hint: 'Edit', working: false },
  { label: 'Find', glyph: '\u2315', hint: 'Find', working: false },
  { label: 'Languages', glyph: '\u2316', hint: 'Languages', working: false },
  { label: 'Compare', glyph: '\u25A4', hint: 'Compare', working: false },
  { label: 'Sort', glyph: '\u2630', hint: 'Sort', working: false },
]

type Column = 'module' | 'name' | 'value'

interface Row {
  file: number
  module: string
  name: string
  value: string
}

function moduleOf(nodeId: string): string {
  const m = /node_modules[\\/](@[^\\/]+[\\/][^\\/]+)/.exec(nodeId)
  return m ? m[1].replace('\\', '/') : ''
}

export function LanguageEditor({ nodeId, tree, api, onTreeChange }: EditorProps) {
  const name = textField(tree, 'name') ?? ''
  const hasMap = !!field(tree, 'keyValueMap')
  const [source, setSource] = useState<{ text: string; read_only: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const index = useProjectIndex()
  const [sort, setSort] = useState<{ col: Column; dir: 1 | -1 } | null>({ col: 'module', dir: 1 })
  const [marked, setMarked] = useState<Set<number>>(new Set())
  const anchor = useRef<number | null>(null)
  const [needle, setNeedle] = useState('')
  const [scope, setScope] = useState<'all' | Column>('all')
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState<{ file: number; col: 'name' | 'value'; seed?: string } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; file: number | null } | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(420)
  const box = useRef<HTMLDivElement | null>(null)
  const busy = useRef(false)
  const cancelled = useRef(false)

  const reload = useCallback(() => {
    api
      .getObjectSource(nodeId)
      .then((s) => setSource(s))
      .catch((e) => setError(errorText(e)))
  }, [api, nodeId])
  useEffect(reload, [reload, tree])

  const module = moduleOf(nodeId)
  const readOnly = source?.read_only ?? true
  const parsed = useMemo(() => (source ? parseLanguageEntries(source.text) : null), [source])

  const rows = useMemo<Row[]>(() => (parsed?.entries ?? []).map((e, file) => ({ file, module, name: e.name, value: e.value })), [parsed, module])
  const duplicates = useMemo(() => {
    const count = new Map<string, number>()
    for (const r of rows) count.set(r.name, (count.get(r.name) ?? 0) + 1)
    return count
  }, [rows])
  const duplicateKeys = useMemo(() => [...duplicates.values()].filter((n) => n > 1).length, [duplicates])

  const shown = useMemo(() => {
    const q = needle.trim().toLowerCase()
    let list = rows
    if (q) list = list.filter((r) => (scope === 'all' ? [r.module, r.name, r.value] : [r[scope]]).some((t) => t.toLowerCase().includes(q)))
    if (sort) {
      const { col, dir } = sort
      list = [...list].sort((a, b) => dir * a[col].localeCompare(b[col], undefined, { sensitivity: 'base' }) || a.file - b.file)
    }
    return list
  }, [rows, needle, scope, sort])

  const apply = useCallback(
    async (next: string | null) => {
      if (next === null || !source || next === source.text || busy.current) return
      busy.current = true
      try {
        const outcome = await api.setObjectSource(nodeId, next)
        setError(null)
        setSource({ text: next, read_only: false })
        onTreeChange(outcome.tree)
      } catch (e) {
        setError(errorText(e))
      } finally {
        busy.current = false
      }
    },
    [api, nodeId, onTreeChange, source],
  )

  // The visible height of the list: rows are only drawn for this window, so it follows the real size of the panel.
  const [boxEl, setBoxEl] = useState<HTMLDivElement | null>(null)
  const attachBox = useCallback((el: HTMLDivElement | null) => {
    box.current = el
    setBoxEl(el)
  }, [])
  useEffect(() => {
    const el = boxEl
    if (!el) return
    const measure = () => setViewport(el.clientHeight || 420)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [boxEl])
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 6)
  const last = Math.min(shown.length, Math.ceil((scrollTop + viewport) / ROW_H) + 6)

  function scrollToDisplayed(index: number) {
    const el = box.current
    if (!el) return
    const top = index * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight
  }

  async function addRow(before: number | undefined = 0) {
    if (readOnly || !source) return
    const r = addEntry(source.text, '', '', before)
    if (!r) return
    setNeedle('')
    await apply(r.text)
    setSelected(r.index)
    setMarked(new Set([r.index]))
    setEditing({ file: r.index, col: 'name' })
    window.setTimeout(() => {
      const at = (sort ? [...rows.map((x) => x), { file: r.index, module, name: '', value: '' }].sort((a, b) => sort.dir * a[sort.col].localeCompare(b[sort.col]) || a.file - b.file).findIndex((x) => x.file === r.index) : r.index)
      scrollToDisplayed(at)
    }, 0)
  }

  const markedFiles = () => [...marked].sort((a, b) => a - b)

  async function removeRows() {
    if (readOnly || !source || marked.size === 0) return
    const files = markedFiles()
    const first = parsed?.entries[files[0]]
    const what = files.length === 1 ? `the entry "${first?.name || '(empty key)'}"` : `${files.length} entries`
    if (!(await confirmDialog(`Remove ${what}?`, { title: 'Remove rows', okLabel: 'Remove' }))) return
    let text: string | null = source.text
    for (const f of [...files].reverse()) text = text === null ? null : deleteEntry(text, f)
    setSelected(null)
    setMarked(new Set())
    await apply(text)
  }

  function languageNodes() {
    return (index?.namesOf?.('language') ?? []).map((n) => index?.findObject('language', n)).filter((n): n is NonNullable<typeof n> => !!n && n.id !== nodeId && !/node_modules/.test(n.id))
  }

  async function removeFromAllLanguages() {
    if (readOnly || !source || marked.size === 0) return
    const keys = new Set(markedFiles().map((f) => parsed?.entries[f]?.name ?? ''))
    const plans: { node: { id: string; label: string }; text: string; removed: number }[] = []
    for (const node of [{ id: nodeId, label: name }, ...languageNodes()]) {
      const text = node.id === nodeId ? source.text : (await api.getObjectSource(node.id).catch(() => null))?.text
      if (!text) continue
      const plan = removeKeysPlan(text, keys)
      if (plan.removed > 0) plans.push({ node, text: plan.text, removed: plan.removed })
    }
    if (plans.length === 0) return
    const lines = plans.map((p) => `${p.node.label}: ${p.removed}`).join('\n')
    if (!(await confirmDialog(`Remove ${keys.size} key${keys.size === 1 ? '' : 's'} from ${plans.length} language file${plans.length === 1 ? '' : 's'}?\n\n${lines}\n\nLanguage files of modules are not changed.`, { title: 'Remove rows form all languages', okLabel: 'Remove' }))) return
    for (const p of plans) {
      if (p.node.id === nodeId) await apply(p.text)
      else await api.setObjectSource(p.node.id, p.text).catch((e) => setError(errorText(e)))
    }
    setMarked(new Set())
    setSelected(null)
  }

  async function copyValues() {
    if (readOnly || !source) return
    const others = languageNodes()
    if (others.length === 0) {
      setError('There is no other language file in the open projects to copy from.')
      return
    }
    const names = others.map((n) => n.label)
    const answer = await promptDialog(`Language file to copy missing keys and empty values from:\n\n${names.join(', ')}`, {
      title: 'Copy Values from another Language File',
      label: 'Language file',
      validate: (v) => (names.includes(v.trim()) ? null : 'Enter the name of one of the listed language files'),
    })
    if (answer === null) return
    const from = others.find((n) => n.label === answer.trim())
    const fromText = from ? (await api.getObjectSource(from.id).catch(() => null))?.text : null
    if (!from || !fromText) {
      setError('The language file could not be read.')
      return
    }
    const plan = copyValuesPlan(source.text, fromText)
    if (plan.added === 0 && plan.filled === 0) {
      setError(`Nothing to copy: ${from.label} has no key that is missing or empty here.`)
      return
    }
    if (!(await confirmDialog(`Copy from ${from.label}: ${plan.added} missing key${plan.added === 1 ? '' : 's'} and ${plan.filled} empty value${plan.filled === 1 ? '' : 's'}?`, { title: 'Copy Values from another Language File', okLabel: 'Copy' }))) return
    await apply(plan.text)
  }

  function commit(file: number, col: 'name' | 'value', text: string) {
    cancelled.current = false
    setEditing(null)
    if (readOnly || !source) return
    void apply(setEntry(source.text, file, col === 'name' ? { name: text } : { value: text }))
  }

  function move(delta: number) {
    if (shown.length === 0) return
    const at = selected === null ? -1 : shown.findIndex((r) => r.file === selected)
    const next = Math.min(shown.length - 1, Math.max(0, at + delta))
    setSelected(shown[next].file)
    scrollToDisplayed(next)
  }

  function selectRow(file: number, display: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
    setSelected(file)
    if (e.shiftKey && anchor.current !== null) {
      const a = shown.findIndex((r) => r.file === anchor.current)
      const [lo, hi] = a < display ? [a, display] : [display, a]
      setMarked(new Set(shown.slice(Math.max(0, lo), hi + 1).map((r) => r.file)))
      return
    }
    anchor.current = file
    if (e.ctrlKey || e.metaKey) setMarked((m) => (m.has(file) ? new Set([...m].filter((x) => x !== file)) : new Set([...m, file])))
    else setMarked(new Set([file]))
  }

  function onGridKey(e: React.KeyboardEvent) {
    if (editing) return
    if (e.key === 'ArrowDown') (e.preventDefault(), move(1))
    else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1))
    else if (e.key === 'PageDown') (e.preventDefault(), move(15))
    else if (e.key === 'PageUp') (e.preventDefault(), move(-15))
    else if (e.key === 'Insert') (e.preventDefault(), void addRow())
    else if (e.key === 'Delete' && marked.size > 0) (e.preventDefault(), void removeRows())
    else if ((e.key === 'Enter' || e.key === 'F2') && selected !== null && !readOnly) (e.preventDefault(), setEditing({ file: selected, col: 'value' }))
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && selected !== null && !readOnly) {
      e.preventDefault()
      setEditing({ file: selected, col: 'value', seed: e.key })
    }
  }

  function headerSort(col: Column) {
    setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }))
  }

  async function commitScalar(path: string, next: string) {
    onTreeChange(await api.setProperty(nodeId, path, textValue(next)))
  }

  if (!hasMap) {
    return (
      <div className="language-editor">
        <h2>{name}</h2>
        <p>
          This language object has no <code>keyValueMap</code> - not a static translation table, e.g. the <code>_____LANGUAGE_EXTRA</code> shape, which harvests translatable strings from the database via{' '}
          <code>sqlModels</code> instead. No key/value pairs to show here.
        </p>
      </div>
    )
  }

  const menuEntries = (): MenuEntry[] => [
    { id: 'translate', label: 'Translate...', enabled: false, hint: 'Automatic translation is not built' },
    { id: 'copy', label: 'Copy Values from another Language File...', enabled: !readOnly, hint: 'Module objects are read-only' },
    { id: 'add', label: 'Add row', enabled: !readOnly, hint: 'Module objects are read-only' },
    { id: 'remove', label: 'Remove rows', enabled: !readOnly && marked.size > 0, hint: readOnly ? 'Module objects are read-only' : 'No row selected' },
    { id: 'removeAll', label: 'Remove rows form all languages', enabled: !readOnly && marked.size > 0, hint: readOnly ? 'Module objects are read-only' : 'No row selected' },
    { id: 'override', label: 'Override Keys', enabled: false, hint: 'The meaning of Override Keys is not documented (needs the manual chapter or a description)' },
  ]

  function pickMenu(id: string) {
    if (id === 'add') void addRow()
    else if (id === 'remove') void removeRows()
    else if (id === 'removeAll') void removeFromAllLanguages()
    else if (id === 'copy') void copyValues()
  }

  const arrow = (col: Column) => (sort?.col === col ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')

  return (
    <div className="language-editor language-grid" aria-label="Language entries">
      <div className="lang-toolbar" role="toolbar" aria-label="Language toolbar">
        {ORIGINAL_ICONS.map((ic, k) => (
          <button key={k} type="button" aria-label={ic.label} title={ic.working ? ic.hint : `${ic.hint} (meaning in the original not documented)`} disabled={!ic.working} onClick={ic.label === 'Refresh' ? reload : undefined}>
            {ic.glyph}
          </button>
        ))}
        <span className="lang-sep" aria-hidden="true" />
        <button type="button" title="Add row (Insert)" aria-label="Add row" disabled={readOnly} onClick={() => void addRow()}>
          +
        </button>
        <button type="button" title="Remove rows (Delete)" aria-label="Remove rows" disabled={readOnly || marked.size === 0} onClick={() => void removeRows()}>
          {'\u2212'}
        </button>
        <input type="search" aria-label="Search entries" placeholder="Search" value={needle} onChange={(e) => setNeedle(e.target.value)} />
        <select aria-label="Search in" value={scope} onChange={(e) => setScope(e.target.value as 'all' | Column)}>
          <option value="all">All</option>
          <option value="module">Module</option>
          <option value="name">Key</option>
          <option value="value">Value</option>
        </select>
        <span className="lang-count" role="status">
          {shown.length === rows.length ? `${rows.length} entries` : `${shown.length} of ${rows.length} entries`}
          {duplicateKeys > 0 ? `, ${duplicateKeys} duplicate key${duplicateKeys === 1 ? '' : 's'}` : ''}
        </span>
        {readOnly ? <span className="app-readonly">Read only: this object belongs to a module.</span> : null}
      </div>
      <div className="lang-fields">
        <label>
          Language <EditableText value={textField(tree, 'language') ?? ''} ariaLabel="Language code" onCommit={(n) => commitScalar('language', n)} />
        </label>
        <label>
          Country <EditableText value={textField(tree, 'country') ?? ''} ariaLabel="Country code" onCommit={(n) => commitScalar('country', n)} />
        </label>
        <label>
          Variant <EditableText value={textField(tree, 'variant') ?? ''} ariaLabel="Variant" onCommit={(n) => commitScalar('variant', n)} />
        </label>
      </div>
      {error ? (
        <p className="forge-field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="lang-head" role="row">
        {(['module', 'name', 'value'] as Column[]).map((c) => (
          <button key={c} type="button" role="columnheader" aria-sort={sort?.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={`lang-col lang-col-${c}`} onClick={() => headerSort(c)}>
            {c === 'module' ? 'Module' : c === 'name' ? 'Key' : 'Value'}
            {arrow(c)}
          </button>
        ))}
      </div>
      {source === null && !error ? (
        <p className="forge-field-hint lang-empty" role="status">
          <span className="forge-spinner" aria-hidden="true" /> Loading the language entries...
        </p>
      ) : shown.length === 0 ? (
        <p className="forge-field-hint lang-empty">{rows.length === 0 ? 'This language file has no entries yet. Use + to add one.' : 'No entries match the search.'}</p>
      ) : null}
      <div
        className="lang-body"
        role="grid"
        aria-label="Translation entries"
        aria-rowcount={shown.length}
        tabIndex={0}
        ref={attachBox}
        onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
        onKeyDown={onGridKey}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, file: selected })
        }}
      >
        <div style={{ height: shown.length * ROW_H, position: 'relative' }}>
          {shown.slice(first, last).map((r, k) => {
            const display = first + k
            const dup = (duplicates.get(r.name) ?? 0) > 1
            const isSel = marked.has(r.file)
            return (
              <div
                key={r.file}
                role="row"
                aria-rowindex={display + 1}
                aria-selected={isSel}
                className={`lang-row${isSel ? ' is-selected' : ''}${dup ? ' is-dup' : ''}`}
                style={{ position: 'absolute', top: display * ROW_H, height: ROW_H, left: 0, right: 0 }}
                title={dup ? 'Duplicate key' : undefined}
                onClick={(e) => selectRow(r.file, display, e)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!marked.has(r.file)) selectRow(r.file, display, { ctrlKey: false, metaKey: false, shiftKey: false })
                  setMenu({ x: e.clientX, y: e.clientY, file: r.file })
                }}
              >
                <div role="gridcell" className="lang-col lang-col-module">
                  {r.module}
                </div>
                {(['name', 'value'] as const).map((col) => (
                  <div key={col} role="gridcell" className={`lang-col lang-col-${col}`} onDoubleClick={() => !readOnly && setEditing({ file: r.file, col })}>
                    {editing && editing.file === r.file && editing.col === col ? (
                      <input
                        autoFocus
                        aria-label={col === 'name' ? 'Edit key' : 'Edit value'}
                        defaultValue={editing.seed ?? r[col]}
                        onFocus={(e) => (editing.seed ? e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length) : e.currentTarget.select())}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') commit(r.file, col, e.currentTarget.value)
                          else if (e.key === 'Escape') {
                            cancelled.current = true
                            setEditing(null)
                          }
                          else if (e.key === 'Tab') {
                            e.preventDefault()
                            const value = e.currentTarget.value
                            commit(r.file, col, value)
                            if (col === 'name') setEditing({ file: r.file, col: 'value' })
                          }
                        }}
                        onBlur={(e) => {
                          if (cancelled.current) cancelled.current = false
                          else if (editing) commit(r.file, col, e.currentTarget.value)
                        }}
                      />
                    ) : (
                      r[col]
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      {menu ? <TreeContextMenu entries={menuEntries()} x={menu.x} y={menu.y} onPick={pickMenu} onClose={() => setMenu(null)} /> : null}
    </div>
  )
}
