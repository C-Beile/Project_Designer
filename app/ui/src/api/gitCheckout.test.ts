import { afterEach, describe, expect, it, vi } from 'vitest'
import { isCheckoutConflict, setCheckoutConflictHandler, withCheckoutChoice } from './gitCheckout'

let off: (() => void) | null = null
afterEach(() => off?.())
const refused = { ok: false, text: 'error: The following untracked working tree files would be overwritten by checkout:\n\tx.txt' }

describe('withCheckoutChoice', () => {
  it('recognises both refusals of Git', () => {
    expect(isCheckoutConflict(refused.text)).toBe(true)
    expect(isCheckoutConflict('error: Your local changes to the following files would be overwritten by checkout:')).toBe(true)
    expect(isCheckoutConflict('error: Your local changes to the following files would be overwritten by merge:')).toBe(true)
    expect(isCheckoutConflict('fatal: cannot pull with rebase: You have unstaged changes.')).toBe(true)
    expect(isCheckoutConflict('error: pathspec did not match')).toBe(false)
  })

  it('runs again with the chosen mode', async () => {
    off = setCheckoutConflictHandler(vi.fn().mockResolvedValue('stash'))
    const call = vi.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce({ ok: true, text: 'ok' })
    expect(await withCheckoutChoice('dev', call)).toEqual({ ok: true, text: 'ok' })
    expect(call.mock.calls).toEqual([[], ['stash']])
  })

  it('returns Git\'s answer when the user aborts, without a handler, and for other failures', async () => {
    off = setCheckoutConflictHandler(vi.fn().mockResolvedValue(null))
    const call = vi.fn().mockResolvedValue(refused)
    expect(await withCheckoutChoice('dev', call)).toBe(refused)
    expect(call).toHaveBeenCalledTimes(1)
    const other = { ok: false, text: 'fatal: bad' }
    expect(await withCheckoutChoice('dev', async () => other)).toBe(other)
    off()
    expect(await withCheckoutChoice('dev', async () => refused)).toBe(refused)
  })
})
