import '@testing-library/jest-dom/vitest'

import { beforeEach } from 'vitest'

beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {
    /* storage unavailable in this environment */
  }
})
