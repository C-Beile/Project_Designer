import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { currentForgeTheme, ensureMonacoThemesDefined, monacoThemeFor, watchForgeThemeForMonaco } from '../theme/monacoTheme'

export function DeployDiffEditor({ remote, local, ignoreWhitespace, label }: { remote: string; local: string; ignoreWhitespace: boolean; label: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    ensureMonacoThemesDefined()
    const editor = monaco.editor.createDiffEditor(host, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      renderIndicators: true,
      renderOverviewRuler: true,
      ignoreTrimWhitespace: ignoreWhitespace,
      theme: monacoThemeFor(currentForgeTheme()),
      ariaLabel: label,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
    })
    const original = monaco.editor.createModel(remote, 'xml')
    const modified = monaco.editor.createModel(local, 'xml')
    editor.setModel({ original, modified })
    const stopTheme = watchForgeThemeForMonaco((theme) => monaco.editor.setTheme(theme))
    return () => {
      stopTheme()
      editor.dispose()
      original.dispose()
      modified.dispose()
    }
  }, [remote, local, ignoreWhitespace, label])

  return <div ref={hostRef} className="forge-ddiff-monaco" data-testid="deploy-diff-host" />
}
