import type { ForgeApi } from './api/ForgeApi'
import { tauriForgeApi } from './api/tauriApi'
import { withSqlLog } from './api/sqlLog'
import { Shell } from './shell/Shell'
import { NativeMenuGuard } from './shell/nativeGuard'
import { CrashListener, ErrorBoundary } from './core/errorHandling'
import './editors/registerViewContextDashboardBuiltins'
import './editors/registerAliasDbBuiltins'
import './editors/registerLanguageBuiltins'
import './editors/registerSystemBuiltins'
import './editors/registerPreferencesBuiltins'
import './editors/registerApplicationBuiltins'
import './editors/registerWebserviceBuiltins'
import './editors/registerReportBuiltins'
import { useEffect, useState } from 'react'
import { registerFeaturePlugins } from './features/registerFeatures'

// Entry component: registers every editor family with the editor registry and hosts the main
// window shell (menu bar, toolbar, docking layout, status bar - see shell/Shell.tsx).
const loggedTauriApi = withSqlLog(tauriForgeApi)

/** Meldet die UI-Beiträge der Plugins an, die das Backend wirklich hat (Cargo-Features). */
function usePluginsReady(api: ForgeApi): boolean {
  const [ready, setReady] = useState(!api.pluginList)
  useEffect(() => {
    if (!api.pluginList) return
    let alive = true
    void registerFeaturePlugins(api).finally(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [api])
  return ready
}

export function App({ api = loggedTauriApi, projectRoot }: { api?: ForgeApi; projectRoot: string }) {
  const ready = usePluginsReady(api)
  if (!ready) return null
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
