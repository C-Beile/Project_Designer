import type { ForgeApi } from '../api/ForgeApi'
import { CrashListener } from '../core/errorHandling'
import { useTheme } from '../theme/useTheme'
import { DialogWindowApp } from './DialogWindowApp'
import { EditorWindowApp } from './EditorWindowApp'
import { FloatApp } from './FloatApp'
import { isFloatView } from './protocol'
import '../editors/registerViewContextDashboardBuiltins'
import '../editors/registerAliasDbBuiltins'
import '../editors/registerLanguageBuiltins'
import '../editors/registerSystemBuiltins'
import '../editors/registerPreferencesBuiltins'
import '../editors/registerApplicationBuiltins'
import '../editors/registerWebserviceBuiltins'
import '../editors/registerReportBuiltins'

// Entry of every window that is not the main window: `?window=float&name=scm`,
// `?window=dialog&name=new` or `?window=editor&name=ed-1a2b3c4d`. The theme is read from the same
// storage as the main window's.

export function WindowRoot({ api, kind, name }: { api: ForgeApi; kind: string; name: string }) {
  useTheme()
  return (
    <>
      <CrashListener api={api} />
      {kind === 'float' && isFloatView(name) ? <FloatApp view={name} api={api} /> : null}
      {kind === 'dialog' ? <DialogWindowApp name={name} api={api} /> : null}
      {kind === 'editor' ? <EditorWindowApp name={name} api={api} /> : null}
      {kind !== 'float' && kind !== 'dialog' && kind !== 'editor' ? <p>Unknown window.</p> : null}
    </>
  )
}
