import { Suspense, lazy } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { EditorComponent } from '../editors/registry'
import type { Problem } from '../problems/problemStore'
import type { DbStatus, UndoRedoOutcome, WireValue } from '../wire/types'
import { HistoryView } from './HistoryView'
import { ErrorBoundary } from '../shell/errorHandling'
import { UsersTab } from '../services/UsersTable'
import { useTunnelState } from '../services/tunnelState'
import { SUB_TAB_LABELS, isFileNode, isServiceNode, isTunnelNode, isAliasConfigNode, subTabsFor, type EditorTab, type SubTab } from './tabModel'

// Content of the active editor tab: the sub-tab row (Editor | Source | History, plus Users for
// system and alias; LAYOUT_SPEC §6) and the selected view. Monaco is only loaded once a
// Source view or a plain file is actually opened.

const SourceEditor = lazy(() => import('./SourceEditor').then((m) => ({ default: m.SourceEditor })))
const SqlEditor = lazy(() => import('../services/SqlEditor').then((m) => ({ default: m.SqlEditor })))
const DbBrowserTab = lazy(() => import('./DbBrowserTab').then((m) => ({ default: m.DbBrowserTab })))
const AliasConfigTab = lazy(() => import('./AliasConfigTab').then((m) => ({ default: m.AliasConfigTab })))
const TunnelConfigEditor = lazy(() => import('./TunnelConfigEditor').then((m) => ({ default: m.TunnelConfigEditor })))
const DiffView = lazy(() => import('../scm/DiffView').then((m) => ({ default: m.DiffView })))
const TextFileEditor = lazy(() => import('./TextFileEditor').then((m) => ({ default: m.TextFileEditor })))

function Hint({ children }: { children: string }) {
  return (
    <div className="forge-editor-empty">
      <p className="forge-field-hint">{children}</p>
    </div>
  )
}

const Loading = <Hint>Please Wait…</Hint>

export function ObjectEditorArea({
  tab,
  api,
  value,
  Editor,
  projectRoot,
  version,
  drafts,
  onSubTab,
  onTreeChange,
  onApplied,
  registerFlush,
  onFileDirty,
  db,
  sqlTexts,
  onDbChange,
  problems,
  reveal,
  onOpenFileAt,
}: {
  tab: EditorTab
  api: ForgeApi
  /** Property tree of the object, null for plain files or while loading. */
  value: WireValue | null
  Editor: EditorComponent | undefined
  projectRoot: string
  version: number
  /** Text not yet accepted by the backend (Source) or not yet written to disk (plain files). */
  drafts: Map<string, string>
  onSubTab: (sub: SubTab) => void
  onTreeChange: (next: WireValue) => void
  onApplied: (nodeId: string, outcome: UndoRedoOutcome) => void
  registerFlush: (nodeId: string, flush: (() => Promise<void>) | null) => void
  onFileDirty: (path: string, dirty: boolean) => void
  /** Services tab: connection state and the text of each SQL editor tab. */
  db: DbStatus
  sqlTexts: Map<string, string>
  onDbChange: (next: DbStatus) => void
  /** Problems with a line of this object (squiggles in the Source tab). */
  problems?: Problem[]
  reveal?: { line: number; column?: number; token: number } | null
  /** Ctrl+click on an import of a script: open the file where it is exported, at that line. */
  onOpenFileAt?: (path: string, line: number) => void
}) {
  const { node } = tab
  const tunnelShared = useTunnelState()
  const subTabs = subTabsFor(node)
  const sub = subTabs.includes(tab.sub) ? tab.sub : 'editor'

  let body
  if (isAliasConfigNode(node)) {
    body = (
      <Suspense fallback={Loading}>
        {node.id.startsWith('dbbrowser:') ? <DbBrowserTab api={api} path={node.path} /> : <AliasConfigTab api={api} path={node.path} />}
      </Suspense>
    )
  } else if (isTunnelNode(node)) {
    body = (
      <Suspense fallback={Loading}>
        <TunnelConfigEditor api={api} projectRoot={projectRoot} reference={node.path ?? ''} db={db} onDbChange={onDbChange} />
      </Suspense>
    )
  } else if (node.diff) {
    body = (
      <Suspense fallback={Loading}>
        <DiffView api={api} target={node.diff} />
      </Suspense>
    )
  } else if (isServiceNode(node)) {
    body = (
      <Suspense fallback={Loading}>
        <SqlEditor api={api} db={db} label={node.label} initial={sqlTexts.get(node.id) ?? ''} onTextChange={(text) => sqlTexts.set(node.id, text)} />
      </Suspense>
    )
  } else if (sub === 'history') {
    body = <HistoryView api={api} path={node.id} />
  } else if (isFileNode(node)) {
    body = (
      <Suspense fallback={Loading}>
        <TextFileEditor
          api={api}
          path={node.id}
          label={node.label}
          projectRoot={projectRoot}
          readOnly={!node.code && (!!node.read_only || /[\\/]node_modules[\\/]/i.test(node.id))}
          isNew={node.code?.isNew}
          drafts={drafts}
          onDirty={onFileDirty}
          reveal={reveal}
          onOpenFileAt={onOpenFileAt}
        />
      </Suspense>
    )
  } else if (sub === 'source') {
    body = (
      <Suspense fallback={Loading}>
        <SourceEditor api={api} nodeId={node.id} version={version} drafts={drafts} onApplied={onApplied} registerFlush={registerFlush} problems={problems} reveal={reveal ?? undefined} />
      </Suspense>
    )
  } else if (sub === 'users') {
    body = <UsersTab api={api} db={tunnelShared.db.connected ? tunnelShared.db : db} reload={tunnelShared.reload} />
  } else if (Editor && value) {
    body = (
      <div className="forge-editor-host">
        <Editor nodeId={node.id} projectRoot={projectRoot} tree={value} api={api} onTreeChange={onTreeChange} />
      </div>
    )
  } else if (Editor) {
    body = Loading
  } else {
    body = <Hint>{`${node.label}: edit via Properties. This object has no editor of its own yet; the Source tab shows the raw file.`}</Hint>
  }

  return (
    <div className="forge-object-editor">
      <div className="forge-subtabs" role="tablist" aria-label="Editor views">
        {subTabs.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={s === sub}
            className={`forge-subtab${s === sub ? ' is-active' : ''}`}
            onClick={() => onSubTab(s)}
          >
            {SUB_TAB_LABELS[s]}
          </button>
        ))}
        <span className="forge-subtabs-fill" />
      </div>
      <div className="forge-object-editor-body">
        <ErrorBoundary key={`${node.id}|${sub}`} api={api} label={`Editor of ${node.label}`}>
          {body}
        </ErrorBoundary>
      </div>
    </div>
  )
}
