import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { tauriForgeApi } from './api/tauriApi'
import { withSqlLog } from './api/sqlLog'
import { installZoomControls } from './settings/zoom'
import './styles.css'

// Dev-only convenience: a "project" URL parameter can still pre-select a project folder for a
// quick dev-mode reload, but the primary, supported way to open a project is now the native
// folder dialog inside the app itself (App.tsx's "Open project…" button, P7
// project-open-dialog) - this is just the initial value App.tsx's own state starts from.
const projectRoot = new URLSearchParams(window.location.search).get('project') ?? ''

// Floating panels and dialogs are opened as windows of their own with `?window=<kind>&name=<name>`.
const windowKind = new URLSearchParams(window.location.search).get('window')
const windowName = new URLSearchParams(window.location.search).get('name') ?? ''

const root = createRoot(document.getElementById('root')!)

// A dialog window only loads what the dialog needs: the whole application (editors, Monaco, the
// project tree) is fetched by the main window alone, so Commit, Options and the other dialog
// windows open quickly.
if (windowKind) {
  void import('./windows/WindowRoot').then(({ WindowRoot }) => {
    root.render(
      <StrictMode>
        <WindowRoot api={withSqlLog(tauriForgeApi)} kind={windowKind} name={windowName} />
      </StrictMode>,
    )
  })
} else {
  void import('./App').then(({ App }) => {
    root.render(
      <StrictMode>
        <App projectRoot={projectRoot} />
      </StrictMode>,
    )
    // Monaco's workers (syntax errors of JDito code) are prepared in the background, before the first editor opens.
    void import('./theme/monacoWorkers').then((m) => m.ensureMonacoWorkers())
  })
}

installZoomControls()
