import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { tauriForgeApi } from './api/tauriApi'
import { withSqlLog } from './api/sqlLog'
import { WindowRoot } from './windows/WindowRoot'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {windowKind ? <WindowRoot api={withSqlLog(tauriForgeApi)} kind={windowKind} name={windowName} /> : <App projectRoot={projectRoot} />}
  </StrictMode>,
)

installZoomControls()

// Monaco's workers (syntax errors of JDito code) are prepared in the background, before the first editor opens.
void import('./theme/monacoWorkers').then((m) => m.ensureMonacoWorkers())
