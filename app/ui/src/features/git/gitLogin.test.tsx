import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { withGitAuth } from '../../api/gitAuth'
import { _resetPluginRegistryForTests } from '../../core/plugins/registry'
import { _resetUiDialogsForTests, UiDialogHost } from '../../core/ui/uiDialogs'
import { registerGitPlugin } from './gitPlugin'

let off: () => void
beforeEach(() => {
  _resetPluginRegistryForTests()
  off = registerGitPlugin()
})
afterEach(() => {
  off()
  _resetUiDialogsForTests()
})

describe('Git sign-in popup', () => {
  it('opens when Git reports a failed sign-in, signs in and repeats the call', async () => {
    const user = userEvent.setup()
    render(<UiDialogHost />)
    const login = vi.fn().mockResolvedValue(undefined)
    const call = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, text: "warning: missing OAuth configuration\nfatal: Cannot prompt because user interactivity has been disabled.\nfatal: could not read Username for 'https://gitlab.adito.de': terminal prompts disabled" })
      .mockResolvedValueOnce({ ok: true, text: 'Already up to date.' })
    let result: unknown
    await act(async () => {
      void withGitAuth(call, async () => ({ root: 'C:/p', url: 'https://gitlab.adito.de/x.git', login })).then((r) => (result = r))
    })
    await user.type(await screen.findByRole('textbox', { name: 'User Name' }), 'lion')
    await user.type(screen.getByLabelText('Password or Access Token'), 'tok')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await vi.waitFor(() => expect(result).toEqual({ ok: true, text: 'Already up to date.' }))
    expect(login).toHaveBeenCalledWith('lion', 'tok')
  })
})
