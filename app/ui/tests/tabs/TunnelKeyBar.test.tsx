import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createMockForgeApi } from '../support/mockApi'
import { TunnelKeyBar, looksLikeKeyProblem } from '../../src/tabs/TunnelKeyBar'

function api(picked: string | null) {
  const base = createMockForgeApi({ projectTree: [], documents: {} })
  return { ...base, pickFile: vi.fn(async () => picked) }
}

describe('TunnelKeyBar', () => {
  it('recognises errors that have to do with the key', () => {
    expect(looksLikeKeyProblem(['Permission denied (publickey)'])).toBe(true)
    expect(looksLikeKeyProblem(['Authentication failed'])).toBe(true)
    expect(looksLikeKeyProblem(['Failed to open channel (ConnectFailed)'])).toBe(false)
  })

  it('offers to choose a key when none is set and hands the picked path on', async () => {
    const onKeyFile = vi.fn()
    render(<TunnelKeyBar api={api('C:/keys/a.ppk')} keyFile="" onKeyFile={onKeyFile} errors={[]} />)
    expect(screen.getByText('none chosen')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose key…' }))
    await waitFor(() => expect(onKeyFile).toHaveBeenCalledWith('C:/keys/a.ppk'))
  })

  it('points to the key when a connection failed because of it, and lets the key be removed', () => {
    const onKeyFile = vi.fn()
    const { rerender } = render(<TunnelKeyBar api={api(null)} keyFile="" onKeyFile={onKeyFile} errors={['Permission denied (publickey)']} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose your SSH key')
    rerender(<TunnelKeyBar api={api(null)} keyFile="C:/keys/a.ppk" onKeyFile={onKeyFile} errors={[]} />)
    expect(screen.getByText('chosen')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove SSH key' }))
    expect(onKeyFile).toHaveBeenCalledWith('')
  })
})
