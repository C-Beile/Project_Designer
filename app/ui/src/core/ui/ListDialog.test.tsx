import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ListDialog, type ListItem } from './ListDialog'

const ITEMS: ListItem[] = [
  { id: '1', label: 'Alpha', hint: 'x' },
  { id: '2', label: 'Beta' },
  { id: '3', label: 'Alphabet' },
]

describe('ListDialog', () => {
  it('filters by the search text and picks the first hit with Enter', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ListDialog title="Pick" items={ITEMS} onPick={onPick} onCancel={() => {}} />)
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'beta')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledWith([ITEMS[1]])
  })

  it('moves with the arrow keys and picks with OK or a double click', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ListDialog title="Pick" items={ITEMS} okLabel="Open" onPick={onPick} onCancel={() => {}} />)
    await user.type(screen.getByRole('textbox', { name: 'Search' }), '{ArrowDown}')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(onPick).toHaveBeenLastCalledWith([ITEMS[1]])
    await user.dblClick(screen.getByText('Alphabet'))
    expect(onPick).toHaveBeenLastCalledWith([ITEMS[2]])
  })

  it('shows the empty text and dims OK when nothing matches', async () => {
    const user = userEvent.setup()
    render(<ListDialog title="Pick" items={ITEMS} emptyText="None here" onPick={() => {}} onCancel={() => {}} />)
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'zzz')
    expect(screen.getByText('None here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled()
  })

  it('multiple selection returns every checked item and runs extra actions with it', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const act = vi.fn()
    render(<ListDialog title="Pick" items={ITEMS} multiple selected={['2']} actions={[{ id: 'a', label: 'Count', onClick: act }]} onPick={onPick} onCancel={() => {}} />)
    await user.click(screen.getByRole('checkbox', { name: 'Alpha' }))
    await user.click(screen.getByRole('button', { name: 'Count' }))
    expect(act).toHaveBeenCalledWith([ITEMS[0], ITEMS[1]])
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onPick).toHaveBeenCalledWith([ITEMS[0], ITEMS[1]])
  })

  it('cancels', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ListDialog title="Pick" items={ITEMS} onPick={() => {}} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
