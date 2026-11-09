import '@testing-library/jest-dom/vitest'

import { beforeEach } from 'vitest'
import { registerGitPlugin } from '../features/git'

// Wie beim App-Start: das Git-Plugin ist registriert (Tests ohne Plugin leeren das Register selbst).
registerGitPlugin()

beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    /* storage unavailable in this environment */
  }
})
