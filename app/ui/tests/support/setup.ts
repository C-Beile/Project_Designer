import '@testing-library/jest-dom/vitest'

import { beforeEach, vi } from 'vitest'
import { registerGitPlugin } from '../../src/features/git'
import { registerCoreStatusItems } from '../../src/shell/coreStatusItems'
import { _resetAppConfigForTests } from '../../src/settings/appConfig'
import { registerAppearanceSettings } from '../../src/theme/appearanceSettings'

// Wie beim App-Start: das Git-Plugin ist registriert (Tests ohne Plugin leeren das Register selbst).
registerGitPlugin()
registerAppearanceSettings()
registerCoreStatusItems()
// Das Debug-Menü gibt es nur im Dev-Build. Tests sehen den Release-Zustand; debugMenu.test.ts setzt `devBuild` selbst.
vi.stubEnv('DEV', false)
// Monaco ist riesig und braucht echte Browser-APIs. Alle Tests bekommen den Ersatz (einzelne Tests mocken ihn selbst weiter).
vi.mock('monaco-editor', () => import('./monacoMock'))

beforeEach(() => {
  // Jeder Test startet mit leerer App-Konfiguration (wie ein frischer Start ohne designer.conf).
  _resetAppConfigForTests()
  try {
    window.localStorage.clear()
  } catch {
    /* storage unavailable in this environment */
  }
})

// jsdom hat keinen ResizeObserver (dockview braucht ihn) und misst nichts: der Ersatz meldet nie eine Größe.
if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
