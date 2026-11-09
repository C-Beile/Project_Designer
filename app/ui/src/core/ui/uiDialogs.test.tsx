import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DialogHost } from '../dialogService'
import { _resetPluginRegistryForTests, registerPlugin } from '../plugins/registry'
import { _resetUiDialogsForTests, defineFormDialog, defineListDialog, openUiDialog, registerUiDialog } from './uiDialogs'

afterEach(() => {
  _resetUiDialogsForTests()
  _resetPluginRegistryForTests()
})

describe('dialogs as data', () => {
  it('opens a form description, hands the values to the plugin and closes after OK', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<DialogHost />)
    act(() => {
      openUiDialog(defineFormDialog({ title: 'Rename', fields: [{ id: 'name', type: 'text', label: 'Name', required: true }], onSubmit }))
    })
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x')
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'x' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays open when the submit fails and closes on Cancel', async () => {
    const user = userEvent.setup()
    render(<DialogHost />)
    act(() => {
      openUiDialog(defineFormDialog({ title: 'T', fields: [], onSubmit: () => Promise.reject(new Error('nope')) }))
    })
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(await screen.findByText('nope')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens a registered list dialog by id, only while its plugin is available', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<DialogHost />)
    registerUiDialog('git.pickBranch', defineListDialog({ title: 'Branch', items: [{ id: 'm', label: 'main' }], onPick }), 'git')
    act(() => {
      openUiDialog('git.pickBranch')
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      registerPlugin({ id: 'git', name: 'Git', category: 'x', version: '1', description: '', switchable: true })
    })
    act(() => {
      openUiDialog('git.pickBranch')
    })
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onPick).toHaveBeenCalledWith([{ id: 'm', label: 'main' }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
