import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { WildcardPicker } from './WildcardPicker'
import { IconPicker } from './IconPicker'
import { PropertyGrid } from '../core/ui/blocks/PropertyGrid'
import { findFieldEditor, getFieldActions, type FieldContext } from '../core/contrib/fieldEditors'
import { registerBuiltinFieldEditors } from './fieldEditors'
import { isDefaultRow, listItems, textOf } from './rowValues'
import { TreeContextMenu } from '../tree/TreeContextMenu'
import type { MenuEntry } from '../tree/contextMenu'
import { PATH_VARIABLE_PROPERTIES, resolvePathVariables } from './pathVariables'
import { layoutSheet } from './sheetLayout'
import { useSheetSplit } from './useSheetSplit'
import { useDescHeight } from './useDescHeight'
import { confirmDialog } from '../core/dialogService'
import { notify } from '../core/notifications'
import type { CodeTarget, ModificationOutcome, PropertySheet, SheetRow, UndoRedoOutcome, WireValue } from '../wire/types'
import { errorText } from '../core/errorText'
import { Button, Input } from '../core/ui/controls'
import { copyText } from '../core/clipboard'
import { useAbortableEffect } from '../core/hooks/useAbortableEffect'

// Properties panel (LAYOUT_SPEC §5): the central place where object properties are edited, as in
// the Designer. All properties the installed Designer knows for the object are listed in its own
// groups and order; unset ones italic and dimmed. Below the grid: name and description of the
// selected property, or the object's name and type when nothing is selected.

registerBuiltinFieldEditors()

export { isDefaultRow }

function FieldValue({ ctx }: { ctx: FieldContext }) {
  const Editor = findFieldEditor(ctx.row)?.component
  return (
    <>
      {Editor ? <Editor ctx={ctx} /> : null}
      {getFieldActions(ctx.row, ctx).map((action) => (
        <action.component key={action.id} ctx={ctx} />
      ))}
    </>
  )
}

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

  useAbortableEffect((signal) => {
    api
      .getPropertySheet(target.nodeId, target.path)
      .then((s) => {
        if (signal.aborted) return
        setSheet(s)
        setError(null)
        if (s.catalog_missing) statusRef.current('Property catalog not available (Designer installation not found): showing stored values only.')
      })
      .catch((e) => {
        if (!signal.aborted) setError(String(e))
      })
  }, [api, target.nodeId, target.path, version, reload])

  useEffect(() => setSelected(null), [target.nodeId, target.path])
  useEffect(() => setActiveTab(null), [target.nodeId, target.path])

  // The description texts of the specification are loaded on first use; the backend's own texts win.
  useAbortableEffect((signal) => {
    void import('./propertyDescriptions.generated').then((m) => {
      if (!signal.aborted) setDescriptions(m.PROPERTY_DESCRIPTIONS)
    })
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
        onStatus(errorText(e))
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
      onStatus(errorText(e))
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
        onStatus(errorText(e))
      }
    },
    [api, sheet, projectRoot, target.nodeId, target.path, onEdited, onStatus, onModificationChanged],
  )

  const rowsRef = useRef<HTMLDivElement>(null)
  const sheetSplit = useSheetSplit('objects', rowsRef, 40)
  const descRef = useRef<HTMLDivElement>(null)
  const descHeight = useDescHeight('objects', descRef)

  const openLinked = (row: SheetRow) => {
    if (!sheet) return
    const reference = row.set ? (textOf(row.value) ?? '') : (row.new_reference ?? '')
    if (reference) onOpenCode?.({ ownerNodeId: target.nodeId, ownerName: sheet.name, path: target.path, prop: row.name, reference, linkedRoot, isNew: !row.set }, false)
  }

  const fieldContext = (row: SheetRow): FieldContext => ({
    api,
    row,
    canEdit: !!sheet && (row.editable || (!!sheet.read_only && !sheet.modification && !!row.would_edit)),
    options: row.reference ? referenceOptions(row.reference) : [],
    commit: (value) => void commit(row, value),
    openLinked: () => openLinked(row),
    openList: () => setListRow(row),
    goTo: () => row.reference && onGoTo(row.reference, row.display),
    search: () => setPickerRow(row),
    pickIcon: () => setIconRow(row),
    browseImage: () => void browseImage(row),
    browseConfig: () => void browseConfig(row),
    editConfig: () => onEditConfig?.(row.name, row.display),
    canEditConfig: !!onEditConfig && target.path === '$',
    hasProject: !!projectRoot,
  })

  if (error) return <div className="forge-panel-empty">{error}</div>
  if (!sheet) return <div className="forge-panel-empty">Please Wait…</div>

  const tabGroups = tab?.groups ?? sheet.groups
  const selectedRow = (layout?.tabs.flatMap((t) => t.groups) ?? sheet.groups).flatMap((g) => g.rows).find((r) => r.name === selected) ?? null

  return (
    <div className="psheet" title={sheet.read_only ? `Read-only: ${sheet.read_only}` : undefined}>
      {layout && layout.tabs.length > 1 ? (
        <div className="psheet-tabs" role="tablist" aria-label="Property tabs">
          {layout.tabs.map((t) => (
            <Button variant="bare" key={t.id} role="tab" aria-selected={t.id === tab?.id} className={`psheet-tab${t.id === tab?.id ? ' is-active' : ''}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </Button>
          ))}
        </div>
      ) : null}
      <PropertyGrid
        ariaLabel={`${sheet.name} properties`}
        groups={tabGroups}
        rowKey={(row) => row.name}
        rowLabel={(row) => row.name}
        rowTitle={(row) => row.reason ?? row.name}
        isUnset={isDefaultRow}
        selected={selected}
        onSelect={setSelected}
        onRowMenu={(row, e) => setRowMenu({ row, x: e.clientX, y: e.clientY })}
        renderValue={(row) => <FieldValue ctx={fieldContext(row)} />}
        split={sheetSplit}
        rowsRef={rowsRef}
      />
      <div className="psheet-desc" ref={descRef} style={descHeight.height ? { height: descHeight.height, maxHeight: 'none' } : undefined}>
        <div
          className="psheet-desc-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Description height"
          tabIndex={0}
          title="Drag to resize the description, double-click to reset"
          onPointerDown={descHeight.onPointerDown}
          onKeyDown={descHeight.onKeyDown}
          onDoubleClick={descHeight.reset}
        />
        <div className="psheet-desc-body" aria-live="polite">
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
            else if (id === 'copy') void copyText(row.display)
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
            <Button variant="bare" onClick={() => setListRow(null)}>
              Close
            </Button>
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

/** Properties of a project root or an External Libraries module (LAYOUT_SPEC §10a). */
export function ProjectPropertiesPanel({ api, name, path }: { api: ForgeApi; name: string; path: string }) {
  const [version, setVersion] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  useAbortableEffect((signal) => {
    api
      .readLinkedFile(path, '.aditoprj/project.version')
      .then((v) => {
        if (!signal.aborted) setVersion(v.trim())
      })
      .catch(() => setVersion(''))
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
      <PropertyGrid
        ariaLabel="Project properties"
        groups={[{ key: 'properties', label: 'Properties', rows }]}
        rowKey={([label]) => label}
        rowLabel={([label]) => label}
        isUnset={([, value]) => !value}
        selected={selected}
        onSelect={setSelected}
        renderValue={([label, value]) => <Input type="text" className="psheet-input" aria-label={label} value={value} readOnly title="Read-only" />}
      />
      <div className="psheet-desc">
        <strong>{selected ?? name}</strong>
        <p>{selected ? '' : path}</p>
      </div>
    </div>
  )
}
