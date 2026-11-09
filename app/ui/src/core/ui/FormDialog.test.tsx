import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormDialog, type FieldDef } from './FormDialog'

const FIELDS: FieldDef[] = [
  { id: 'name', type: 'text', label: 'Name', required: true, validate: (v) => (typeof v === 'string' && v.includes(' ') ? 'No spaces.' : null) },
  { id: 'count', type: 'number', label: 'Count', min: 1, max: 5 },
  { id: 'mode', type: 'select', label: 'Mode', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] },
  { id: 'force', type: 'checkbox', label: 'Force' },
]

describe('FormDialog', () => {
  it('renders all field types with the first select option and keeps OK off until the required field is filled', () => {
    render(<FormDialog title="Make" fields={FIELDS} onSubmit={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Make' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Mode' })).toHaveValue('a')
    expect(screen.getByRole('checkbox', { name: 'Force' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
  })

  it('hands the typed values back with number and checkbox converted', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<FormDialog title="Make" fields={FIELDS} initial={{ mode: 'b' }} onSubmit={onSubmit} onCancel={() => {}} />)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'x1')
    await user.type(screen.getByRole('spinbutton', { name: 'Count' }), '3')
    await user.click(screen.getByRole('checkbox', { name: 'Force' }))
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'x1', count: 3, mode: 'b', force: true })
  })

  it('shows a custom check and a range error and blocks OK', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<FormDialog title="Make" fields={FIELDS} onSubmit={onSubmit} onCancel={() => {}} />)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'a b')
    expect(screen.getByText('No spaces.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    await user.clear(screen.getByRole('textbox', { name: 'Name' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'ab')
    await user.type(screen.getByRole('spinbutton', { name: 'Count' }), '9')
    expect(screen.getByText('Must be at most 5.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits with Enter, and a failing submit keeps the dialog open with the message', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('Disk full'))
    render(<FormDialog title="Make" fields={FIELDS} onSubmit={onSubmit} onCancel={() => {}} />)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'ab{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Disk full')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('cancels with the button and with Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<FormDialog title="Make" fields={FIELDS} onSubmit={() => {}} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
