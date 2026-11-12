import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { withCheckoutChoice } from '../../api/gitCheckout'
import { _resetDialogsForTests, DialogHost } from '../../core/dialogService'
import { _resetPluginRegistryForTests } from '../../core/plugins/registry'
import { registerGitPlugin } from './gitPlugin'

let off: () => void
beforeEach(() => {
  _resetPluginRegistryForTests()
  off = registerGitPlugin()
})
afterEach(() => {
  off()
  _resetDialogsForTests()
})

const refused = { ok: false, text: 'error: The following untracked working tree files would be overwritten by checkout:\n\tx.txt\n\ty.txt\nAborting' }

describe('Switch Branch with local changes in the way', () => {
  it('lists the files and switches with the stash option', async () => {
    const user = userEvent.setup()
    render(<DialogHost />)
    const call = vi.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce({ ok: true, text: 'Switched' })
    const done = withCheckoutChoice('dev', call)
    expect(await screen.findByText(/in the way of switching to dev/)).toBeInTheDocument()
    expect(screen.getByText(/x\.txt/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stash and bring along' }))
    expect(await done).toEqual({ ok: true, text: 'Switched' })
    expect(call.mock.calls).toEqual([[], ['stash']])
  })

  it('discard switches with discard, cancel keeps Git\'s refusal', async () => {
    const user = userEvent.setup()
    render(<DialogHost />)
    const call = vi.fn().mockResolvedValueOnce(refused).mockResolvedValueOnce({ ok: true, text: 'Switched' })
    const done = withCheckoutChoice('dev', call)
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    await done
    expect(call.mock.calls[1]).toEqual(['discard'])

    const refusedCall = vi.fn().mockResolvedValue(refused)
    const cancelled = withCheckoutChoice('dev', refusedCall)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await cancelled).toBe(refused)
    expect(refusedCall).toHaveBeenCalledTimes(1)
  })

  it('a pull offers only Stash and Cancel, and stash repeats the pull with that mode', async () => {
    const user = userEvent.setup()
    render(<DialogHost />)
    const text = ['error: Your local changes to the following files would be overwritten by merge:', '\tone.txt', 'Please commit your changes or stash them before you merge.'].join(String.fromCharCode(10))
    const call = vi.fn().mockResolvedValueOnce({ ok: false, text }).mockResolvedValueOnce({ ok: true, text: 'Updating' })
    const done = withCheckoutChoice('', call, 'pull')
    expect(await screen.findByText(/in the way of the pull/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Stash and bring along' }))
    expect(await done).toEqual({ ok: true, text: 'Updating' })
    expect(call.mock.calls).toEqual([[], ['stash']])
  })
})
