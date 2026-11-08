import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DataTable, type DataColumn } from './DataTable'
import { ProgressBar } from './ProgressBar'

interface Row {
  name: string
  size: number
}
const ROWS: Row[] = [
  { name: 'b', size: 10 },
  { name: 'a', size: 2 },
  { name: 'c', size: 30 },
]
const COLUMNS: DataColumn<Row>[] = [
  { id: 'name', header: 'Name', value: (r) => r.name, sortable: true },
  { id: 'size', header: 'Size', value: (r) => r.size, sortable: true, render: (r) => `${r.size} KB` },
]
const names = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => r.textContent)

describe('DataTable', () => {
  it('renders the rows and the custom cell content', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.name} ariaLabel="Files" />)
    expect(screen.getByRole('table', { name: 'Files' })).toBeInTheDocument()
    expect(screen.getByText('30 KB')).toBeInTheDocument()
  })

  it('sorts ascending, descending and back to the given order by clicking a header', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.name} ariaLabel="Files" />)
    await user.click(screen.getByRole('button', { name: /Size/ }))
    expect(names()).toEqual(['a2 KB', 'b10 KB', 'c30 KB'])
    await user.click(screen.getByRole('button', { name: /Size/ }))
    expect(names()).toEqual(['c30 KB', 'b10 KB', 'a2 KB'])
    await user.click(screen.getByRole('button', { name: /Size/ }))
    expect(names()).toEqual(['b10 KB', 'a2 KB', 'c30 KB'])
  })

  it('single selection marks one row and reports it', async () => {
    const user = userEvent.setup()
    const seen: string[][] = []
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.name} ariaLabel="Files" selection="single" onSelectedChange={(k) => seen.push(k)} />)
    await user.click(screen.getByText('a'))
    await user.click(screen.getByText('c'))
    expect(seen).toEqual([['a'], ['c']])
    expect(screen.getByText('c').closest('tr')).toHaveClass('is-selected')
    expect(screen.getByText('a').closest('tr')).not.toHaveClass('is-selected')
  })

  it('multiple selection uses check boxes and a select-all box', async () => {
    const user = userEvent.setup()
    function Host() {
      const [sel, setSel] = useState<string[]>(['a'])
      return (
        <>
          <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.name} ariaLabel="Files" selection="multiple" selected={sel} onSelectedChange={setSel} />
          <output>{sel.join(',')}</output>
        </>
      )
    }
    render(<Host />)
    await user.click(screen.getByRole('checkbox', { name: 'b' }))
    expect(screen.getByRole('status')).toHaveTextContent('a,b')
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByRole('status')).toHaveTextContent('b,a,c')
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('shows the empty text without rows', () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.name} ariaLabel="Files" emptyText="No files." />)
    expect(screen.getByText('No files.')).toBeInTheDocument()
  })
})

describe('ProgressBar', () => {
  it('shows the value, or a running stripe without one', () => {
    const { rerender } = render(<ProgressBar percent={42.4} label="Build" />)
    expect(screen.getByRole('progressbar', { name: 'Build' })).toHaveAttribute('aria-valuenow', '42')
    rerender(<ProgressBar label="Build" />)
    expect(screen.getByRole('progressbar', { name: 'Build' })).toHaveAttribute('aria-busy', 'true')
  })
})
