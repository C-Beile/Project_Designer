import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { NewObjectDialog } from '../shell/NewObjectDialog'
import { OpenModelDialog, type ModelEntry } from '../shell/OpenModelDialog'
import { OptionsDialog, type KeymapEntry } from '../shell/OptionsDialog'
import { DeployOptionsDialog, type DeployOptionsPayload } from '../shell/DeployOptionsDialog'
import { AboutDialog } from '../shell/Dialogs'
import { DeployDialog } from '../shell/DeployDialog'
import { LocalDataDialog } from '../shell/LocalDataDialog'
import { PluginsDialog } from '../shell/PluginsDialog'
import { ProjectZipDialog } from '../shell/ProjectZipDialog'
import { UpdatesDialog } from '../shell/UpdatesDialog'
import { getDialog } from '../core/plugins/registry'
import { RenameDialog } from '../tree/TreeDialogs'
import type { ThemeName } from '../theme/useTheme'
import type { TranspilerEngineId } from '../settings/transpilerEngine'
import { DialogHost } from '../core/dialogService'
import { OsWindowContext } from './osWindowContext'
import { getWindowBackend } from './windowService'

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
  open: {
    render: (_api, p, done) => <OpenModelDialog models={(p.models as ModelEntry[]) ?? []} onClose={() => done(null)} onPick={(m) => done(m)} />,
  },
}

export function DialogWindowApp({ name, api }: { name: string; api: ForgeApi }) {
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getWindowBackend()
      .payload('dialog', name)
      .then((text) => {
        if (cancelled) return
        try {
          setPayload(text ? (JSON.parse(text) as Record<string, unknown>) : {})
        } catch {
          setFailed('The dialog could not read its input.')
        }
      })
      .catch((e) => !cancelled && setFailed(String(e)))
    return () => {
      cancelled = true
    }
  }, [name])

  const done: Done = (result) => void getWindowBackend().result('dialog', name, result === null ? null : JSON.stringify(result))
  const spec = DIALOG_WINDOWS[name]

  let body: ReactNode
  if (!spec) body = <p className="forge-field-error">Unknown dialog {name}.</p>
  else if (failed) body = <p className="forge-field-error">{failed}</p>
  else if (!payload) body = <p className="forge-field-hint">Please Wait…</p>
  else body = spec.render(api, payload, done)

  return (
    <OsWindowContext.Provider value={true}>
      {body}
      <DialogHost />
    </OsWindowContext.Provider>
  )
}
