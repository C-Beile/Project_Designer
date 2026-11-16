import { Suspense, useEffect, useRef, useState } from 'react'
import { revealApp } from '../core/revealApp'
import { markPerf } from '../core/perf/marks'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { KeymapEntry } from '../shell/OptionsDialog'
import type { DeployOptionsPayload } from '../shell/DeployOptionsDialog'
import { lazyNamed } from '../core/lazyNamed'
import { getDialog } from '../core/plugins/registry'
import type { ThemeName } from '../theme/useTheme'
import type { TranspilerEngineId } from '../settings/transpilerEngine'
import { DialogHost } from '../core/dialogService'
import { OsWindowContext } from './osWindowContext'
import { getWindowBackend } from './windowService'
import { useAbortableEffect } from '../core/hooks/useAbortableEffect'

// Jeder Dialog lädt erst, wenn sein Fenster ihn zeigt: ein Popup holt nur den Code, den es braucht.
const NewObjectDialog = lazyNamed(() => import('../shell/NewObjectDialog'), 'NewObjectDialog')
const OptionsDialog = lazyNamed(() => import('../shell/OptionsDialog'), 'OptionsDialog')
const DeployOptionsDialog = lazyNamed(() => import('../shell/DeployOptionsDialog'), 'DeployOptionsDialog')
const AboutDialog = lazyNamed(() => import('../shell/Dialogs'), 'AboutDialog')
const DeployDialog = lazyNamed(() => import('../shell/DeployDialog'), 'DeployDialog')
const LocalDataDialog = lazyNamed(() => import('../shell/LocalDataDialog'), 'LocalDataDialog')
const PluginsDialog = lazyNamed(() => import('../shell/PluginsDialog'), 'PluginsDialog')
const ProjectZipDialog = lazyNamed(() => import('../shell/ProjectZipDialog'), 'ProjectZipDialog')
const UpdatesDialog = lazyNamed(() => import('../shell/UpdatesDialog'), 'UpdatesDialog')
const ThemeStudio = lazyNamed(() => import('../studio/ThemeStudio'), 'ThemeStudio')
const RenameDialog = lazyNamed(() => import('../tree/TreeDialogs'), 'RenameDialog')

// Content of a dialog window: the payload the opener handed over decides what is drawn, the result
// goes back to the main window and the window closes. Escape or the window's own close button
// report "cancelled".

type Done = (result: unknown) => void

interface DialogSpec {
  render(api: ForgeApi, payload: Record<string, unknown>, done: Done): ReactNode
}

export interface OptionsWindowResult {
  installDir: string | null
  engine: TranspilerEngineId
  theme: ThemeName
}

// The Options window saves the options, editor switches and settings itself; the main window only
// has to read them again and take over the three values that live in its own state.
function OptionsWindow({ api, payload, done }: { api: ForgeApi; payload: Record<string, unknown>; done: Done }) {
  const result = useRef<OptionsWindowResult>({ installDir: null, engine: payload.engine as TranspilerEngineId, theme: payload.theme as ThemeName })
  const saved = useRef(false)
  return (
    <OptionsDialog
      api={api}
      engine={result.current.engine}
      theme={result.current.theme}
      keymap={(payload.keymap as KeymapEntry[]) ?? []}
      onSaved={(installDir) => {
        saved.current = true
        result.current.installDir = installDir
      }}
      onEngineChange={(engine) => {
        result.current.engine = engine
      }}
      onThemeChange={(theme) => {
        result.current.theme = theme
      }}
      onClose={() => done(saved.current ? result.current : null)}
    />
  )
}

// The Deploy plan reports the message of a finished deploy; closing it without deploying is a cancel.
function DeployPlanWindow({ api, payload, done }: { api: ForgeApi; payload: Record<string, unknown>; done: Done }) {
  const message = useRef<string | null>(null)
  return (
    <DeployDialog
      api={api}
      projectRoot={String(payload.project ?? '')}
      systemName={typeof payload.system === 'string' ? payload.system : undefined}
      initialForce={payload.force === true}
      initialCheckScan={typeof payload.checkScan === 'boolean' ? payload.checkScan : undefined}
      warning={typeof payload.warning === 'string' ? payload.warning : null}
      onDeployed={(m) => {
        message.current = m
      }}
      onClose={() => done(message.current === null ? null : { message: message.current })}
    />
  )
}

function ZipWindow({ api, payload, done }: { api: ForgeApi; payload: Record<string, unknown>; done: Done }) {
  return (
    <ProjectZipDialog
      api={api}
      projectRoot={String(payload.projectRoot ?? '')}
      mode={payload.mode === 'import' ? 'import' : 'export'}
      onClose={() => done(null)}
      onDone={(message) => done({ message })}
    />
  )
}

function pluginDialog(id: string, props: Record<string, unknown>): ReactNode {
  const Dialog = getDialog(id)?.component
  return Dialog ? <Dialog {...props} /> : null
}

export const DIALOG_WINDOWS: Record<string, DialogSpec> = {
  new: {
    render: (api, p, done) => (
      <NewObjectDialog
        api={api}
        projectRoot={String(p.projectRoot ?? '')}
        projects={Array.isArray(p.projects) ? p.projects.map(String) : undefined}
        initialFolder={typeof p.folder === 'string' ? p.folder : null}
        onClose={() => done(null)}
        onCreated={(aod, folder, name) => done({ aod, folder, name })}
      />
    ),
  },
  options: {
    render: (api, p, done) => <OptionsWindow api={api} payload={p} done={done} />,
  },
  deploy: {
    render: (api, p, done) => <DeployOptionsDialog api={api} payload={p as unknown as DeployOptionsPayload} onOk={(r) => done(r)} onCancel={() => done(null)} />,
  },
  rename: {
    render: (_api, p, done) => (
      <RenameDialog folder={String(p.folder ?? '')} initial={String(p.initial ?? '')} onClose={() => done(null)} onConfirm={(name) => done({ name })} />
    ),
  },
  plugins: {
    render: (_api, _p, done) => <PluginsDialog onClose={() => done({ changed: true })} />,
  },
  updates: {
    render: (api, _p, done) => <UpdatesDialog api={api} onClose={() => done(null)} onOpenTableCenter={() => done({ tableCenter: true })} />,
  },
  // Git-Fenster: Inhalt kommt aus dem Register (Plugin git); ohne Plugin bleibt das Fenster leer.
  git: {
    render: (api, p, done) => pluginDialog('git.window', { api, payload: p, done }),
  },
  sync: {
    render: (api, p, done) => pluginDialog('git.syncWindow', { api, payload: p, done }),
  },
  gitlogin: {
    render: (api, p, done) => pluginDialog('git.loginWindow', { api, payload: p, done }),
  },
  commitdiff: {
    render: (api, p, done) => pluginDialog('git.commitDiff', { api, root: String(p.root ?? ''), path: String(p.path ?? ''), onClose: () => done(null) }),
  },
  localdata: {
    render: (api, _p, done) => <LocalDataDialog api={api} onClose={() => done(null)} />,
  },
  zip: {
    render: (api, p, done) => <ZipWindow api={api} payload={p} done={done} />,
  },
  about: {
    render: (api, _p, done) => <AboutDialog api={api} onClose={() => done(null)} />,
  },
  deployplan: {
    render: (api, p, done) => <DeployPlanWindow api={api} payload={p} done={done} />,
  },
  themestudio: {
    render: (api, _p, done) => <ThemeStudio api={api} inWindow onClose={() => done(null)} />,
  },
}

// Sitzt neben dem Inhalt: läuft erst, wenn der ganze Inhalt gezeichnet werden kann, und zeigt dann das Fenster.
function RevealOnMount() {
  useEffect(() => {
    markPerf('content-ready')
    revealApp(true)
  }, [])
  return null
}

// Der Code jedes Dialogs je Fenstername: das Fenster wartet darauf, bevor es zeichnet (kein Suspense, kein Ersatzbild).
const DIALOG_CODE: Record<string, { preload: () => Promise<unknown> }> = {
  new: NewObjectDialog,
  options: OptionsDialog,
  deploy: DeployOptionsDialog,
  rename: RenameDialog,
  plugins: PluginsDialog,
  updates: UpdatesDialog,
  localdata: LocalDataDialog,
  zip: ProjectZipDialog,
  about: AboutDialog,
  deployplan: DeployDialog,
  themestudio: ThemeStudio,
}

export function DialogWindowApp({ name, api }: { name: string; api: ForgeApi }) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [codeReady, setCodeReady] = useState(false)

  useEffect(() => {
    let alive = true
    void (DIALOG_CODE[name]?.preload() ?? Promise.resolve()).catch(() => {}).then(() => alive && setCodeReady(true))
    return () => {
      alive = false
    }
  }, [name])

  useAbortableEffect((signal) => {
    getWindowBackend()
      .payload('dialog', name)
      .then((text) => {
        if (signal.aborted) return
        markPerf('payload')
        try {
          setPayload(text ? (JSON.parse(text) as Record<string, unknown>) : {})
        } catch {
          setFailed('The dialog could not read its input.')
        }
      })
      .catch((e) => !signal.aborted && setFailed(String(e)))
  }, [name])

  const done: Done = (result) => void getWindowBackend().result('dialog', name, result === null ? null : JSON.stringify(result))
  const spec = DIALOG_WINDOWS[name]

  // Das Fenster bleibt unsichtbar, bis der Inhalt wirklich da ist (Nutzlast und Code geladen): kein "Please Wait".
  let body: ReactNode = null
  if (!spec) body = <><p className="forge-field-error">Unknown dialog {name}.</p><RevealOnMount /></>
  else if (failed) body = <><p className="forge-field-error">{failed}</p><RevealOnMount /></>
  else if (payload && codeReady) {
    body = (
      <Suspense fallback={null}>
        {spec.render(api, payload, done)}
        <RevealOnMount />
      </Suspense>
    )
  }

  return (
    <OsWindowContext.Provider value={true}>
      {body}
      <DialogHost />
    </OsWindowContext.Provider>
  )
}
