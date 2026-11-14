import { useEffect, useState } from 'react'
import { registerCommand, registerMenuContribution, registerShellExtension, type ShellExtensionContext } from '../core/plugins/registry'
import { errorText } from '../core/errorText'
import { notify } from '../core/notifications'
import { item } from '../shell/menuModel'
import { openDialogWindow, osPopupsAvailable } from '../windows/windowService'
import { ThemeStudio } from './ThemeStudio'

const COMMAND = 'tools.themeStudio'

export const STUDIO_WINDOW = { name: 'themestudio', title: 'Theme Studio', size: { width: 1280, height: 820 } }

/** Öffnet das Studio als Fenster. Gibt `false` zurück, wenn es keine OS-Fenster gibt (dann zeigt der Aufrufer es eingebettet). */
export function openThemeStudioWindow(): boolean {
  if (!osPopupsAvailable(STUDIO_WINDOW.name)) return false
  const { name, title, size } = STUDIO_WINDOW
  openDialogWindow(name, title, size, {}, { modal: false, resizable: true }).catch((e) => notify(errorText(e), { kind: 'error' }))
  return true
}

function ThemeStudioHost({ api }: ShellExtensionContext) {
  const [embedded, setEmbedded] = useState(false)
  useEffect(() => registerCommand(COMMAND, () => (openThemeStudioWindow() ? undefined : setEmbedded(true))), [])
  return embedded ? <ThemeStudio api={api} onClose={() => setEmbedded(false)} /> : null
}

/** Tools > Theme Studio: Themes ansehen, bearbeiten und mit allen Elementen der App vergleichen. */
export function registerThemeStudio(): () => void {
  const offs = [
    registerShellExtension({ id: 'tools.themeStudio', order: 900, component: ThemeStudioHost }),
    registerMenuContribution({ menu: 'tools', order: 90, items: [item(COMMAND, 'Theme Studio', true, { hint: 'Edit themes and preview them on every element of the app' })] }),
  ]
  return () => offs.forEach((off) => off())
}
