import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../support/mockApi'
import { IconPicker } from '../../src/properties/IconPicker'

describe('IconPicker', () => {
  it('shows every icon, narrows them by a wildcard search and hands back the full id', async () => {
    const user = userEvent.setup({ delay: null })
    const onPick = vi.fn()
    render(<IconPicker api={createMockForgeApi({ projectTree: [], documents: {} })} current="" onPick={onPick} onClose={() => {}} />)
    expect(await screen.findAllByRole('option')).toHaveLength(3)

    await user.type(screen.getByLabelText('Search icons'), '*port')
    expect(screen.getAllByRole('option')).toHaveLength(1)

    await user.click(screen.getByRole('option'))
    expect(onPick).toHaveBeenCalledWith('NEON:IMPORT')
  })

  it('offers to clear the current icon', async () => {
    const user = userEvent.setup({ delay: null })
    const onPick = vi.fn()
    render(<IconPicker api={createMockForgeApi({ projectTree: [], documents: {} })} current="VAADIN:HOME" onPick={onPick} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onPick).toHaveBeenCalledWith('')
  })
})
