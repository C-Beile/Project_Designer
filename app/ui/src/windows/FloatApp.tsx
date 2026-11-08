import { useEffect, useMemo, useRef, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { NavigatorPanel } from '../navigator/NavigatorPanel'
import { ProjectPropertiesPanel, PropertySheetPanel } from '../properties/PropertySheetPanel'
import { useDialog } from '../core/plugins/registry'
import { refreshScm, useScm } from '../core/scm'
import { ServicesPanel } from '../services/ServicesPanel'
import { DialogHost } from '../core/dialogService'
import { ToastHost } from '../core/notifications'
import type { DbStatus, DiffTarget } from '../wire/types'
import { OutputBody, type OutputLine, type OutputSubTab } from '../shell/OutputPanel'
import { EVENTS, FLOAT_TITLES, type FloatAction, type FloatView, type MainState } from './protocol'
import { getWindowBackend } from './windowService'

// Content of a floating panel window. The window has no state of its own about the project: the
// main window sends the selection and versions (`MainState`) and gets back what the user does here
// (`FloatAction`), so the main window stays the only place where documents are opened and edited.

const NO_DB: DbStatus = { connected: false, tunnel_up: false, database: null, host: null }

export function FloatApp({ view, api }: { view: FloatView; api: ForgeApi }) {
  const [state, setState] = useState<MainState | null>(null)
  const [db, setDb] = useState<DbStatus>(NO_DB)
  const [logs, setLogs] = useState<Record<OutputSubTab, OutputLine[]>>({ database: [], build: [], default: [], nodejs: [] })
  const [sub, setSub] = useState<OutputSubTab>('build')
  const scm = useScm()
  const ScmPanel = useDialog('git.scmPanel')?.component

  const send = (action: FloatAction) => void getWindowBackend().emit(EVENTS.floatAction, action)

  useEffect(() => {
    const backend = getWindowBackend()
    let dead = false
    const unsubs: (() => void)[] = []
    const add = (p: Promise<() => void>) =>
      void p.then((u) => {
        if (dead) u()
        else unsubs.push(u)
      })
    add(backend.listen(EVENTS.mainState, (p) => setState(p as MainState)))
    add(backend.listen(EVENTS.outputLines, (p) => setLogs(p as Record<OutputSubTab, OutputLine[]>)))
    add(
      backend.listen(EVENTS.scmRefresh, () => {
        const root = latestRoot.current
        if (root) void refreshScm(api, root)
      }),
    )
    void backend.emit(EVENTS.floatReady, { view })
    return () => {
      dead = true
      unsubs.forEach((u) => u())
    }
  }, [api, view])

  const latestRoot = useRef('')
  latestRoot.current = state?.root ?? ''

  // The Git status is read here too; a change that the main window does not know yet is reported.
  const lastOverview = useRef('')
  useEffect(() => {
    if (view !== 'scm' || !scm.overview) return
    const text = JSON.stringify(scm.overview)
    if (text === lastOverview.current) return
    const first = lastOverview.current === ''
    lastOverview.current = text
    if (!first) send({ type: 'scmChanged' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scm.overview, view])

  useEffect(() => {
    if (view !== 'services') return
    let cancelled = false
    const poll = () =>
      api
        .dbStatus()
        .then((s) => !cancelled && setDb(s))
        .catch(() => {})
    void poll()
    const timer = window.setInterval(poll, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [api, view])

  const names = useMemo(() => state?.objectsByType ?? {}, [state])

  let body
  if (view === 'output') {
    body = (
      <OutputBody
        active="output"
        sub={sub}
        onSelectSub={setSub}
        logs={logs}
        problems={[]}
        scanning={false}
        onOpenProblem={() => {}}
        onClear={(s) => setLogs((prev) => ({ ...prev, [s]: [] }))}
        onRefreshScan={() => {}}
        refactoring={null}
        onOpenUsage={() => {}}
        onDoRefactoring={() => {}}
        onCloseRefactoring={() => {}}
      />
    )
  } else if (!state) body = <div className="forge-panel-empty">Please Wait…</div>
  else if (view === 'scm') {
    body = ScmPanel ? <ScmPanel api={api} root={state.root} onOpenDiff={(target: DiffTarget) => send({ type: 'openDiff', target })} onChanged={() => send({ type: 'reload' })} /> : null
  } else if (view === 'services') {
    body = <ServicesPanel api={api} db={db} onDbChange={setDb} onOpenSql={(sql) => send({ type: 'openSql', sql })} />
  } else if (view === 'navigator') {
    body = (
      <NavigatorPanel
        api={api}
        nodeId={state.kind === 'object' ? state.objectId : null}
        objectType={state.kind === 'object' ? state.objectType : null}
        origin={state.origin}
        selectedPath={state.selectedPath}
        version={state.version}
        readOnlyHint={state.readOnlyHint}
        onSelect={(path, label) => state.objectId && send({ type: 'navSelect', nodeId: state.objectId, path, label })}
        onReset={(path, label) => send({ type: 'navReset', path, label })}
        onActivate={(path, label) => send({ type: 'navActivate', path, label })}
      />
    )
  } else if (state.kind === 'project' || state.kind === 'module') {
    body = <ProjectPropertiesPanel api={api} name={state.projectName} path={state.projectPath} />
  } else if (state.kind === 'object' && state.objectId) {
    body = (
      <PropertySheetPanel
        api={api}
        target={{ nodeId: state.objectId, path: state.selectedPath ?? '$' }}
        linkedRoot={state.linkedRoot}
        projectRoot={state.root}
        version={state.version}
        referenceOptions={(type) => [...(names[type] ?? [])].sort((a, b) => a.localeCompare(b))}
        onGoTo={(objectType, name) => send({ type: 'goTo', objectType, name })}
        onEdited={(nodeId) => send({ type: 'edited', nodeId })}
        onStatus={(text) => send({ type: 'status', text })}
        onOpenCode={(code) => send({ type: 'openCode', code })}
        onOpenFile={(path) => send({ type: 'openFile', path })}
        onModificationChanged={() => send({ type: 'modificationChanged' })}
      />
    )
  } else {
    body = <div className="forge-panel-empty">&lt;No Properties&gt;</div>
  }

  const title = view === 'navigator' || view === 'properties' ? (state?.title ? `${state.title} - ${FLOAT_TITLES[view]}` : FLOAT_TITLES[view]) : FLOAT_TITLES[view]

  return (
    <div className="forge-float" data-float={view}>
      <div className="forge-float-bar">
        <strong>{title}</strong>
        <button type="button" title="Dock this window back into the Designer" onClick={() => void getWindowBackend().result('float', view, null)}>
          Dock
        </button>
      </div>
      <div className="forge-float-body">{body}</div>
      <DialogHost />
      <ToastHost />
    </div>
  )
}
