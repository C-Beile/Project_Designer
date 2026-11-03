import type { ForgeApi } from './api/ForgeApi'
import { tauriForgeApi } from './api/tauriApi'
import { withSqlLog } from './api/sqlLog'
import { Shell } from './shell/Shell'
import { NativeMenuGuard } from './shell/nativeGuard'
import { CrashListener, ErrorBoundary } from './shell/errorHandling'
import './editors/registerViewContextDashboardBuiltins'
import './editors/registerAliasDbBuiltins'
import './editors/registerLanguageBuiltins'
import './editors/registerSystemBuiltins'
import './editors/registerPreferencesBuiltins'
import './editors/registerApplicationBuiltins'
import './editors/registerWebserviceBuiltins'
import './editors/registerReportBuiltins'

// Entry component: registers every editor family with the editor registry and hosts the main
// window shell (menu bar, toolbar, docking layout, status bar - see shell/Shell.tsx).
const loggedTauriApi = withSqlLog(tauriForgeApi)

export function App({ api = loggedTauriApi, projectRoot }: { api?: ForgeApi; projectRoot: string }) {
  return (
    <>
      <NativeMenuGuard />
      <CrashListener api={api} />
      <ErrorBoundary api={api} label="Dito Designer">
        <Shell api={api} projectRoot={projectRoot} />
      </ErrorBoundary>
    </>
  )
}
