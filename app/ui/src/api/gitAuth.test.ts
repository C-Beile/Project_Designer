import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAuthFailure, setGitAuthHandler, withGitAuth } from './gitAuth'

const ctx = async () => ({ root: 'C:/p', url: 'https://h/x.git', login: async () => {} })
let off: (() => void) | null = null
afterEach(() => off?.())

describe('withGitAuth', () => {
  it('recognises sign-in failures but not other errors', () => {
    expect(isAuthFailure("fatal: Authentication failed for 'https://h/x.git/'")).toBe(true)
    expect(isAuthFailure('fatal: could not read Username for https://h: terminal prompts disabled')).toBe(true)
    expect(isAuthFailure('error: Your local changes would be overwritten')).toBe(false)
    expect(isAuthFailure('git@h: Permission denied (publickey).')).toBe(false)
  })

  it('asks once and repeats the call after a failed output when the user signs in', async () => {
    const handler = vi.fn().mockResolvedValue(true)
    off = setGitAuthHandler(handler)
    const call = vi.fn().mockResolvedValueOnce({ ok: false, text: 'fatal: Authentication failed' }).mockResolvedValueOnce({ ok: true, text: 'done' })
    expect(await withGitAuth(call, ctx)).toEqual({ ok: true, text: 'done' })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('repeats after a thrown sign-in error and returns the first error when the user cancels', async () => {
    off = setGitAuthHandler(vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false))
    const ok = vi.fn().mockRejectedValueOnce('fatal: could not read Username for x').mockResolvedValueOnce([])
    expect(await withGitAuth(ok, ctx)).toEqual([])
    const never = vi.fn().mockRejectedValue('fatal: Authentication failed')
    await expect(withGitAuth(never, ctx)).rejects.toBe('fatal: Authentication failed')
    expect(never).toHaveBeenCalledTimes(1)
  })

  it('leaves other failures and calls without a handler alone', async () => {
    const handler = vi.fn()
    off = setGitAuthHandler(handler)
    const other = { ok: false, text: 'CONFLICT (content)' }
    expect(await withGitAuth(async () => other, ctx)).toBe(other)
    expect(handler).not.toHaveBeenCalled()
    off()
    const auth = { ok: false, text: 'Authentication failed' }
    expect(await withGitAuth(async () => auth, ctx)).toBe(auth)
  })
})
