import { TunnelGlyph } from '../tree/TunnelGlyph'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { WildcardPicker } from './WildcardPicker'
import { IconPicker } from './IconPicker'
import { IconCombo } from './IconCombo'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'
import { PATH_VARIABLE_PROPERTIES, resolvePathVariables } from './pathVariables'
import { layoutSheet } from './sheetLayout'
import { useSheetSplit } from './useSheetSplit'
import { confirmDialog } from '../shell/dialogService'
import { notify } from '../shell/notifications'
import type { CodeTarget, ModificationOutcome, PropertySheet, SheetRow, UndoRedoOutcome, WireValue } from '../wire/types'

// Properties panel (LAYOUT_SPEC §5): the central place where object properties are edited, as in
// the Designer. All properties the installed Designer knows for the object are listed in its own
// groups and order; unset ones italic and dimmed. Below the grid: name and description of the
// selected property, or the object's name and type when nothing is selected.

export interface SheetTarget {
  nodeId: string
  /** Element path inside the object, `$` for the object itself. */
  path: string
}

export function PropertySheetPanel({
  api,
  target,
  linkedRoot,
  projectRoot,
  version,
  referenceOptions,
  onGoTo,
  onEdited,
  onStatus,
  onEditConfig,
  onOpenCode,
  onOpenFile,
  onModificationChanged,
}: {
  api: ForgeApi
  target: SheetTarget
  /** `%aditoprj%` folder of the object, for linked process files. */
  linkedRoot: string
  /** Project the edits of module objects are written to (as modifications). */
  projectRoot?: string
  /** Bumped whenever the object changed elsewhere (undo/redo, editors). */
  version: number
  referenceOptions: (modelType: string) => string[]
  onGoTo: (modelType: string, name: string) => void
  onEdited: (nodeId: string, outcome: UndoRedoOutcome) => void
  onStatus: (message: string) => void
  /** System objects: the pencil next to serverConfigPath / tunnelConfigPath opens its editor. */
  onEditConfig?: (name: string, reference: string) => void
  /** Double click or ... on a code property: the code opens as an editor tab of its own. */
  onOpenCode?: (target: CodeTarget, readOnly: boolean) => void
  /** Opens a project file (the modification file named in a notification) as an editor tab. */
  onOpenFile?: (path: string) => void
  /** A modification was created, extended or removed: the shell refreshes tree and Navigator. */
  onModificationChanged?: () => void
}) {
  const [sheet, setSheet] = useState<PropertySheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [listRow, setListRow] = useState<SheetRow | null>(null)
  const [pickerRow, setPickerRow] = useState<SheetRow | null>(null)
  const [iconRow, setIconRow] = useState<SheetRow | null>(null)
  const [reload, setReload] = useState(0)
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [descriptions, setDescriptions] = useState<Record<string, string> | undefined>(undefined)
  const [rowMenu, setRowMenu] = useState<{ row: SheetRow; x: number; y: number } | null>(null)
  // Callbacks from the shell are not guaranteed stable; refetching on their identity would loop.
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus

  useEffect(() => {
    let cancelled = false
    api
      .getPropertySheet(target.nodeId, target.path)
      .then((s) => {
        if (cancelled) return
        setSheet(s)
        setError(null)
        if (s.catalog_missing) statusRef.current('Property catalog not available (Designer installation not found): showing stored values only.')
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [api, target.nodeId, target.path, version, reload])

  useEffect(() => setSelected(null), [target.nodeId, target.path])
  useEffect(() => setActiveTab(null), [target.nodeId, target.path])

  // The description texts of the specification are loaded on first use; the backend's own texts win.
  useEffect(() => {
    let cancelled = false
    void import('./propertyDescriptions.generated').then((m) => {
      if (!cancelled) setDescriptions(m.PROPERTY_DESCRIPTIONS)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const layout = useMemo(() => (sheet ? layoutSheet(sheet, 'en', descriptions) : null), [sheet, descriptions])
  const tab = layout ? (layout.tabs.find((t) => t.id === activeTab) ?? layout.tabs[0]) : undefined

  // A change back to the original value makes the modification redundant; it is only deleted after the user agreed.
  // Creating or extending a modification never asks: a non-blocking notification names the file
  // and offers Open and, for a new modification, Undo.
  const reportModification = useCallback(
    async (outcome: ModificationOutcome) => {
      if (outcome.action === 'removal_suggested' && outcome.dir) {
        const ok = projectRoot && (await confirmDialog(`The modification "${outcome.dir}" no longer differs from the original. Delete it?`, { title: 'Modification', okLabel: 'Delete' }))
        if (ok && projectRoot) {
          await api.discardModification(projectRoot, outcome.dir)
          onStatus(`Modification ${outcome.dir} deleted.`)
          onModificationChanged?.()
        } else {
          onStatus(`Modification ${outcome.dir} equals the original again and was kept.`)
        }
      } else if ((outcome.action === 'created' || outcome.action === 'updated') && outcome.dir) {
        const dir = outcome.dir
        const file = `${(projectRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '')}/modification/${dir}/${dir}.aod`
        const actions = []
        if (onOpenFile && projectRoot) actions.push({ label: 'Open', run: () => onOpenFile(file) })
        if (outcome.action === 'created' && projectRoot) {
          actions.push({
            label: 'Undo',
            run: async () => {
              await api.discardModification(projectRoot, dir)
              onStatus(`Modification ${dir} deleted.`)
              onModificationChanged?.()
              setReload((r) => r + 1)
            },
          })
        }
        notify(outcome.action === 'created' ? `Modification created: modification/${dir}` : `Modification extended: modification/${dir}`, { kind: 'success', actions })
        onStatus(`Modification ${outcome.action}: modification/${dir}`)
        onModificationChanged?.()
      }
    },
    [api, projectRoot, onStatus, onOpenFile, onModificationChanged],
  )

  // Module objects (node_modules) are never changed themselves: the first edit creates a
  // modification in the open project automatically, which then receives only the changed property.
  const writeMode = useCallback(async (): Promise<'normal' | 'modification' | null> => {
    if (!sheet) return null
    if (sheet.modification) return 'modification'
    if (!sheet.read_only) return 'normal'
    if (!projectRoot || !projectRoot.trim()) {
      onStatus('Open a project first: edits of module objects are written as a modification of that project.')
      return null
    }
    await api.enableModification(target.nodeId, projectRoot)
    return 'modification'
  }, [api, sheet, projectRoot, target.nodeId, onStatus])

  // Takes a config file chosen in the file explorer over into the project and writes its path.
  const browseConfigRef = useRef<(row: SheetRow) => Promise<void>>(async () => {})
  const browseConfig = (row: SheetRow) => browseConfigRef.current(row)

  const commit = useCallback(
    async (row: SheetRow, value: WireValue) => {
      try {
        const mode = await writeMode()
        if (!mode) {
          setReload((r) => r + 1)
          return
        }
        const clearing = value.kind === 'text' && value.value === '' && row.kind !== 'bool'
        if (clearing && !row.set) return
        if (mode === 'modification') {
          if (clearing) throw new Error('Clearing a value is not available for modifications yet.')
          const outcome = await api.setModificationProperty(target.nodeId, target.path, row.name, value, row.typed, row.kind)
          await reportModification(outcome)
        } else if (clearing) {
          onEdited(target.nodeId, await api.removeSheetProperty(target.nodeId, target.path, row.name))
        } else {
          const outcome = await api.setSheetProperty(target.nodeId, target.path, row.name, value, row.typed)
          onEdited(target.nodeId, outcome)
        }
        setReload((r) => r + 1)
      } catch (e) {
        onStatus(e instanceof Error ? e.message : String(e))
        setReload((r) => r + 1)
      }
    },
    [api, target.nodeId, target.path, onEdited, onStatus, reportModification, writeMode],
  )

  browseConfigRef.current = async (row: SheetRow) => {
    if (!projectRoot) return
    const picked = await api.pickFile(`Choose ${row.name}`, 'XML', ['xml']).catch(() => null)
    if (!picked) return
    try {
      const ref = await api.importConfigFile(projectRoot, picked)
      await commit(row, { kind: 'text', value: ref })
      onStatus(`${row.name}: ${ref} (copied into the project)`)
    } catch (e) {
      onStatus(e instanceof Error ? e.message : String(e))
    }
  }

  // An image property holds a plain file path: the file explorer picks it, nobody has to type it.
  const browseImage = async (row: SheetRow) => {
    const picked = await api.pickFile(`Choose ${row.name}`, 'Images', ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'bmp']).catch(() => null)
    if (picked) await commit(row, { kind: 'text', value: picked })
  }

  // Set to Default: the property leaves the file again; for a module object the project's modification of it is deleted.
  const resetRow = useCallback(
    async (row: SheetRow) => {
      try {
        if (sheet?.read_only && !sheet.modification) {
          if (!projectRoot || !projectRoot.trim()) {
            onStatus('Open a project first: a module object is set to default by deleting the modification of that project.')
            return
          }
          if (!(await confirmDialog(`Delete the modification of ${row.name} in the project and use the value of the module again?`, { title: 'Set to Default', okLabel: 'Delete' }))) return
          await api.enableModification(target.nodeId, projectRoot)
        }
        const out = await api.resetSheetProperty(target.nodeId, target.path, row.name)
        onEdited(target.nodeId, out.tree)
        if (out.modification?.dir) {
          onStatus(`Modification ${out.modification.dir} deleted.`)
          onModificationChanged?.()
        }
        setReload((r) => r + 1)
      } catch (e) {
        onStatus(e instanceof Error ? e.message : String(e))
      }
    },
    [api, sheet, projectRoot, target.nodeId, target.path, onEdited, onStatus, onModificationChanged],
  )

  const rowsRef = useRef<HTMLDivElement>(null)
  const sheetSplit = useSheetSplit('objects', rowsRef, 40)

  const openLinked = (row: SheetRow) => {
    if (!sheet) return
    const reference = row.set ? (textOf(row.value) ?? '') : (row.new_reference ?? '')
    if (reference) onOpenCode?.({ ownerNodeId: target.nodeId, ownerName: sheet.name, path: target.path, prop: row.name, reference, linkedRoot, isNew: !row.set }, false)
  }

  if (error) return <div className="forge-panel-empty">{error}</div>
  if (!sheet) return <div className="forge-panel-empty">Please Wait…</div>

  const tabGroups = tab?.groups ?? sheet.groups
  const selectedRow = (layout?.tabs.flatMap((t) => t.groups) ?? sheet.groups).flatMap((g) => g.rows).find((r) => r.name === selected) ?? null

  return (
    <div className="psheet">
      {sheet.read_only ? (
        <div className="psheet-readonly" role="note">
          Read-only: {sheet.read_only}
        </div>
      ) : null}
      {layout && layout.tabs.length > 1 ? (
        <div className="psheet-tabs" role="tablist" aria-label="Property tabs">
          {layout.tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === tab?.id} className={`psheet-tab${t.id === tab?.id ? ' is-active' : ''}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="psheet-grid" role="grid" aria-label={`${sheet.name} properties`} style={{ '--sheet-split': `${sheetSplit.split}%` } as CSSProperties}>
        <div className="psheet-rows" ref={rowsRef}>
        {tabGroups.map((group) => {
          const isCollapsed = collapsed.has(group.key)
          return (
            <div key={group.key} role="rowgroup" className="psheet-group">
              <div role="row" className="psheet-group-head">
                <button
                  type="button"
                  className="psheet-toggle"
                  aria-expanded={!isCollapsed}
                  aria-label={group.label ? `${isCollapsed ? 'Expand' : 'Collapse'} ${group.label}` : isCollapsed ? 'Expand' : 'Collapse'}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev)
                      if (next.has(group.key)) next.delete(group.key)
                      else next.add(group.key)
                      return next
                    })
                  }
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <span className="psheet-group-label">{group.label}</span>
              </div>
              {isCollapsed
                ? null
                : group.rows.map((row) => (
                    <div
                      key={row.name}
                      role="row"
                      className={`psheet-row${isDefaultRow(row) ? ' is-unset' : ''}${selected === row.name ? ' is-selected' : ''}`}
                      onMouseDown={() => setSelected(row.name)}
                      onFocusCapture={() => setSelected(row.name)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setSelected(row.name)
                        setRowMenu({ row, x: e.clientX, y: e.clientY })
                      }}
                    >
                      <span role="rowheader" className="psheet-label" title={row.reason ?? row.name}>
                        {row.name}
                      </span>
                      <span role="gridcell" className="psheet-value">
                        {isIconRow(row) ? (
                          <IconCombo
                            api={api}
                            value={row.display}
                            disabled={!(row.editable || (!!sheet.read_only && !sheet.modification && !!row.would_edit))}
                            onCommit={(id) => void commit(row, { kind: 'text', value: id })}
                          />
                        ) : (
                        <ValueEditor
                          row={row}
                          canEdit={row.editable || (!!sheet.read_only && !sheet.modification && !!row.would_edit)}
                          options={row.reference ? referenceOptions(row.reference) : []}
                          onCommit={(v) => commit(row, v)}
                          onOpenLinked={() => openLinked(row)}
                          onOpenList={() => setListRow(row)}
                          onGoTo={() => row.reference && onGoTo(row.reference, row.display)}
                          onSearch={() => setPickerRow(row)}
                        />
                        )}
                        {isImageRow(row) ? (
                          <button
                            type="button"
                            className="psheet-btn"
                            aria-label={`Choose ${row.name}`}
                            title="Choose the image file in the file explorer"
                            disabled={!(row.editable || (!!sheet.read_only && !sheet.modification && !!row.would_edit))}
                            onClick={() => void browseImage(row)}
                          >
                            {'…'}
                          </button>
                        ) : null}
                        {isIconRow(row) ? (
                          <button
                            type="button"
                            className="psheet-btn"
                            aria-label={`Choose ${row.name}`}
                            title="Choose the icon from the icon chooser"
                            disabled={!(row.editable || (!!sheet.read_only && !sheet.modification && !!row.would_edit))}
                            onClick={() => setIconRow(row)}
                          >
                            {'…'}
                          </button>
                        ) : null}
                        {onEditConfig && target.path === '$' && CONFIG_PATH_ROWS.includes(row.name) ? (
                          <>
                            <button
                              type="button"
                              className="psheet-btn"
                              aria-label={`Choose ${row.name}`}
                              title="Choose the file in the file explorer; it is copied into the project (others/cloud) and replaces an older copy"
                              disabled={!projectRoot}
                              onClick={() => void browseConfig(row)}
                            >
                              {'…'}
                            </button>
                            <button
                              type="button"
                              className="psheet-btn psheet-pencil"
                              aria-label={`Edit ${row.name}`}
                              title={row.name === 'tunnelConfigPath' ? 'Open the tunnel manager' : 'Open the server config file'}
                              disabled={!row.display}
                              onClick={() => onEditConfig(row.name, row.display)}
                            >
                              {row.name === 'tunnelConfigPath' ? <TunnelGlyph /> : '✎'}
                            </button>
                          </>
                        ) : null}
                      </span>
                    </div>
                  ))}
            </div>
          )
        })}
        <div
          className="sheet-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="Column divider"
          aria-valuemin={15}
          aria-valuemax={85}
          aria-valuenow={Math.round(sheetSplit.split)}
          tabIndex={0}
          title="Drag to resize the columns, double-click to reset"
          onPointerDown={sheetSplit.onPointerDown}
          onKeyDown={sheetSplit.onKeyDown}
          onDoubleClick={sheetSplit.reset}
        />
        </div>
      </div>
      <div className="psheet-desc" aria-live="polite">
        <strong>{selectedRow ? selectedRow.name : sheet.name}</strong>
        <p>{selectedRow ? (selectedRow.description ?? '') : `${sheet.name} (${sheet.type_label})`}</p>
        {selectedRow && (PATH_VARIABLE_PROPERTIES as readonly string[]).includes(selectedRow.name) && selectedRow.display
          ? (() => {
              const r = resolvePathVariables(selectedRow.name, selectedRow.display, { projectHome: projectRoot })
              return (
                <>
                  <p className="forge-field-hint" data-testid="resolved-path">
                    Resolved: {r.resolved}
                    {r.unresolved.length > 0 ? ` (${r.unresolved.join(', ')} not known here)` : ''}
                  </p>
                  {r.problems.map((m) => (
                    <p key={m} className="forge-field-error" role="alert">
                      {m}
                    </p>
                  ))}
                </>
              )
            })()
          : null}
      </div>
      {rowMenu ? (
        <TreeContextMenu
          entries={rowMenuEntries(rowMenu.row, !!sheet.read_only && !sheet.modification && !projectRoot)}
          x={rowMenu.x}
          y={rowMenu.y}
          onPick={(id) => {
            const row = rowMenu.row
            if (id === 'reset') void resetRow(row)
            else if (id === 'open') openLinked(row)
            else if (id === 'copy') void navigator.clipboard?.writeText(row.display)
          }}
          onClose={() => setRowMenu(null)}
        />
      ) : null}
      {pickerRow ? (
        <div className="psheet-overlay">
          <WildcardPicker
            label={pickerRow.name}
            options={pickerRow.kind === 'enum' ? (pickerRow.enum_values ?? []) : referenceOptions(pickerRow.reference ?? '')}
            current={pickerRow.display}
            onClose={() => setPickerRow(null)}
            onPick={(v) => {
              const row = pickerRow
              setPickerRow(null)
              void commit(row, { kind: 'text', value: v })
            }}
          />
        </div>
      ) : null}
      {iconRow ? (
        <div className="psheet-overlay">
          <IconPicker
            api={api}
            current={iconRow.display}
            onClose={() => setIconRow(null)}
            onPick={(id) => {
              const row = iconRow
              setIconRow(null)
              void commit(row, { kind: 'text', value: id })
            }}
          />
        </div>
      ) : null}
      {listRow ? (
        <div className="psheet-overlay" role="dialog" aria-label={listRow.name}>
          <div className="psheet-list">
            <strong>{listRow.name}</strong>
            <ul>
              {listItems(listRow.value).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setListRow(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Context menu of a property row. The Manual does not describe it; Set to Default was asked for, the other
// entries are Dito Designer's own choice. Entries without a function stay visible, dimmed, with the reason.
export function rowMenuEntries(row: SheetRow, moduleWithoutProject: boolean): MenuEntry[] {
  let hint = ''
  if (!row.set) hint = 'Already at its default: the property is not set.'
  else if (row.kind === 'list' || row.kind === 'object') hint = 'Lists cannot be set to default here yet.'
  else if (row.name === 'name' || row.name === 'type') hint = 'This property cannot be set to default.'
  else if (moduleWithoutProject) hint = 'Open a project first: modules are never changed themselves.'
  const entries: MenuEntry[] = [{ id: 'reset', label: 'Set to Default', enabled: hint === '', hint }]
  if (row.kind === 'linked') entries.push({ id: 'open', label: 'Open in Editor', enabled: row.set || !!row.new_reference, hint: 'No code file is known for this property.' })
  entries.push({ id: 'sep', label: '', enabled: false, separator: true }, { id: 'copy', label: 'Copy Value', enabled: row.display !== '', hint: 'The value is empty.' })
  return entries
}

// Properties holding an icon id (`iconId`, and `icon` of alias definitions; `VAADIN:HOME`): they get the icon chooser instead of a typed id.
function isIconRow(row: SheetRow): boolean {
  return (row.name === 'iconId' || row.name === 'icon') && row.kind !== 'bool' && row.kind !== 'enum' && row.kind !== 'reference' && row.kind !== 'linked'
}

// The `image` property is a plain path to an image file.
function isImageRow(row: SheetRow): boolean {
  return row.name === 'image' && (row.kind === 'text' || row.kind === undefined)
}

const CONFIG_PATH_ROWS = ['serverConfigPath', 'tunnelConfigPath']

// Empty and unset values are shown grey italic, as in the original (shot 56). A checked box is a
// real value; an unchecked one is the default.
export function isDefaultRow(row: SheetRow): boolean {
  if (!row.set) return true
  if (row.kind === 'bool') return !(row.value?.kind === 'bool' ? row.value.value : textOf(row.value) === 'true')
  return row.display === ''
}

function textOf(v: WireValue | undefined): string | undefined {
  if (!v) return undefined
  if (v.kind === 'text') return v.value
  if (v.kind === 'bool' || v.kind === 'int') return String(v.value)
  return undefined
}

function listItems(v: WireValue | undefined): string[] {
  if (!v) return []
  if (v.kind === 'array') return v.items.flatMap(listItems)
  if (v.kind === 'object') {
    const name = v.fields.find((f) => f.key === 'name')
    if (name) return [textOf(name.value) ?? '']
    return v.fields.flatMap((f) => listItems(f.value))
  }
  return [textOf(v) ?? '']
}

function ValueEditor({
  row,
  canEdit,
  options,
  onCommit,
  onOpenLinked,
  onOpenList,
  onGoTo,
  onSearch,
}: {
  row: SheetRow
  canEdit: boolean
  options: string[]
  onCommit: (value: WireValue) => void
  onOpenLinked: () => void
  onOpenList: () => void
  onGoTo: () => void
  onSearch: () => void
}) {
  const disabled = !canEdit
  const title = canEdit ? undefined : row.reason

  if (row.kind === 'bool') {
    const checked = row.value?.kind === 'bool' ? row.value.value : textOf(row.value) === 'true'
    return (
      <input
        type="checkbox"
        aria-label={row.name}
        checked={checked}
        disabled={disabled}
        title={title}
        onChange={(e) => onCommit({ kind: 'bool', value: e.target.checked })}
      />
    )
  }

  if (row.kind === 'enum') {
    return (
      <span className="psheet-ref">
      <select
        aria-label={row.name}
        value={row.display}
        disabled={disabled}
        title={title}
        onChange={(e) => onCommit({ kind: 'text', value: e.target.value })}
      >
        <option value="" />
        {(row.enum_values ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
        {(row.enum_values?.length ?? 0) > 8 && !disabled ? (
          <button type="button" className="psheet-btn" aria-label={`Search ${row.name}`} title="Search the list (* is a wildcard)" onClick={onSearch}>
            ⌕
          </button>
        ) : null}
      </span>
    )
  }

  if (row.kind === 'reference') {
    const values = row.display && !options.includes(row.display) ? [row.display, ...options] : options
    return (
      <span className="psheet-ref">
        <select
          aria-label={row.name}
          value={row.display}
          disabled={disabled}
          title={title}
          onChange={(e) => onCommit({ kind: 'text', value: e.target.value })}
        >
          <option value="" />
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        {options.length > 8 && !disabled ? (
          <button type="button" className="psheet-btn" aria-label={`Search ${row.name}`} title="Search the list (* is a wildcard)" onClick={onSearch}>
            ⌕
          </button>
        ) : null}
        <button type="button" className="psheet-btn" aria-label={`Go to ${row.display || row.name}`} title="Go to object" disabled={!row.display} onClick={onGoTo}>
          ➜
        </button>
      </span>
    )
  }

  if (row.kind === 'linked') {
    const canOpen = row.set || !!row.new_reference
    return (
      <span className="psheet-linked" onDoubleClick={() => canOpen && onOpenLinked()}>
        <span className="psheet-text" title={row.set ? row.display : 'Not set - double-click or use "..." to write the code'}>
          {row.display}
        </span>
        <button type="button" className="psheet-btn" aria-label={`Open ${row.name}`} title={row.set ? 'Open the code in an editor tab' : 'Create and edit the code of this property'} disabled={!canOpen} onClick={onOpenLinked}>
          …
        </button>
      </span>
    )
  }

  if (row.kind === 'list' || row.kind === 'object') {
    return (
      <span className="psheet-linked">
        <span className="psheet-text" title={title}>
          {row.display}
        </span>
        <button type="button" className="psheet-btn" aria-label={`Show ${row.name}`} title={title} disabled={!row.set} onClick={onOpenList}>
          …
        </button>
      </span>
    )
  }

  return <TextValue row={row} canEdit={canEdit} onCommit={onCommit} />
}

function TextValue({ row, canEdit, onCommit }: { row: SheetRow; canEdit: boolean; onCommit: (value: WireValue) => void }) {
  const [draft, setDraft] = useState(row.display)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => setDraft(row.display), [row.display])

  const commit = () => {
    if (draft === row.display) return
    if (row.kind === 'int') {
      const n = Number(draft)
      if (!Number.isInteger(n)) {
        setDraft(row.display)
        return
      }
      onCommit({ kind: 'int', value: n })
      return
    }
    onCommit({ kind: 'text', value: draft })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      setDraft(row.display)
    }
  }

  return (
    <input
      ref={ref}
      type="text"
      className="psheet-input"
      aria-label={row.name}
      value={draft}
      readOnly={!canEdit}
      title={canEdit ? undefined : row.reason}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}

/** Properties of a project root or an External Libraries module (LAYOUT_SPEC §10a). */
export function ProjectPropertiesPanel({ api, name, path }: { api: ForgeApi; name: string; path: string }) {
  const [version, setVersion] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .readLinkedFile(path, '.aditoprj/project.version')
      .then((v) => {
        if (!cancelled) setVersion(v.trim())
      })
      .catch(() => setVersion(''))
    return () => {
      cancelled = true
    }
  }, [api, path])
  const rows: [string, string][] = [
    ['Name', name],
    ['All Files', ''],
    ['Path', path],
    ['Project version', version],
    ['Documentation', ''],
  ]
  return (
    <div className="psheet">
      <div className="psheet-grid" role="grid" aria-label="Project properties">
        <div role="rowgroup" className="psheet-group">
          <div role="row" className="psheet-group-head">
            <span className="psheet-toggle" aria-hidden="true">
              ▾
            </span>
            <span className="psheet-group-label">Properties</span>
          </div>
          {rows.map(([label, value]) => (
            <div key={label} role="row" className={`psheet-row${value ? '' : ' is-unset'}${selected === label ? ' is-selected' : ''}`} onMouseDown={() => setSelected(label)}>
              <span role="rowheader" className="psheet-label">
                {label}
              </span>
              <span role="gridcell" className="psheet-value">
                <input type="text" className="psheet-input" aria-label={label} value={value} readOnly title="Read-only" />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="psheet-desc">
        <strong>{selected ?? name}</strong>
        <p>{selected ? '' : path}</p>
      </div>
    </div>
  )
}
