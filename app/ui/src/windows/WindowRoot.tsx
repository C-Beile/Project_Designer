import { Suspense, lazy, useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { registerFeaturePlugins } from '../features/registerFeatures'
import { revealApp } from '../core/revealApp'
import { CrashListener, ErrorBoundary } from '../core/errorHandling'
import { useTheme } from '../theme/useTheme'
import { lazyNamed } from '../core/lazyNamed'
import { isFloatView } from './protocol'

// Jede Fensterart lädt erst, wenn sie gebraucht wird: ein Popup holt nicht die ganze Oberfläche.
const DialogWindowApp = lazyNamed(() => import('./DialogWindowApp'), 'DialogWindowApp')
const FloatApp = lazyNamed(() => import('./FloatApp'), 'FloatApp')
const EditorWindowApp = lazy(async () => {
  await import('../editors/registerAllBuiltins')
  return { default: (await import('./EditorWindowApp')).EditorWindowApp }
})

// Entry of every window that is not the main window: `?window=float&name=scm`,
// `?window=dialog&name=new` or `?window=editor&name=ed-1a2b3c4d`. The theme is read from the same
// storage as the main window's.

export function WindowRoot({ api, kind, name }: { api: ForgeApi; kind: string; name: string }) {
  useTheme()
  // Auch dieses Fenster hat sein eigenes Register: Plugins (Git-Dialoge, Panels) erst anmelden, dann zeichnen.
  const [ready, setReady] = useState(!api.pluginList)
  useEffect(() => {
    if (!api.pluginList) return
    let alive = true
    void registerFeaturePlugins(api).finally(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [api])
  useEffect(() => {
    if (ready) revealApp(true)
  }, [ready])
  if (!ready) return null
  return (
    <>
      <CrashListener api={api} />
      <ErrorBoundary api={api} label={`Window ${kind}/${name}`}>
        <Suspense fallback={null}>
          {kind === 'float' && isFloatView(name) ? <FloatApp view={name} api={api} /> : null}
          {kind === 'dialog' ? <DialogWindowApp name={name} api={api} /> : null}
          {kind === 'editor' ? <EditorWindowApp name={name} api={api} /> : null}
        </Suspense>
      </ErrorBoundary>
      {kind !== 'float' && kind !== 'dialog' && kind !== 'editor' ? <p>Unknown window.</p> : null}
    </>
  )
}
