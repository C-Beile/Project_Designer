import '@testing-library/jest-dom/vitest'

import { beforeEach, vi } from 'vitest'
import { registerGitPlugin } from '../features/git'
import { registerCoreStatusItems } from '../shell/coreStatusItems'
import { _resetAppConfigForTests } from '../settings/appConfig'

// Wie beim App-Start: das Git-Plugin ist registriert (Tests ohne Plugin leeren das Register selbst).
registerGitPlugin()
registerCoreStatusItems()
// Das Debug-Menü gibt es nur im Dev-Build. Tests sehen den Release-Zustand; debugMenu.test.ts setzt `devBuild` selbst.
vi.stubEnv('DEV', false)

beforeEach(() => {
  // Jeder Test startet mit leerer App-Konfiguration (wie ein frischer Start ohne designer.conf).
  _resetAppConfigForTests()
  try {
    window.localStorage.clear()
  } catch {
    /* storage unavailable in this environment */
  }
})
