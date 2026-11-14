import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAbortableEffect } from './useAbortableEffect'

describe('useAbortableEffect', () => {
  it('bricht das Signal beim Aufräumen ab und ruft die Aufräumfunktion', () => {
    const seen: AbortSignal[] = []
    let cleaned = 0
    function Probe({ n }: { n: number }) {
      useAbortableEffect((signal) => {
        seen.push(signal)
        return () => void cleaned++
      }, [n])
      return null
    }
    const { rerender, unmount } = render(<Probe n={1} />)
    expect(seen[0].aborted).toBe(false)
    rerender(<Probe n={2} />)
    expect(seen[0].aborted).toBe(true)
    expect(seen[1].aborted).toBe(false)
    expect(cleaned).toBe(1)
    unmount()
    expect(seen[1].aborted).toBe(true)
    expect(cleaned).toBe(2)
  })
})
