import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyButton } from './CopyButton'

describe('CopyButton', () => {
  afterEach(() => vi.restoreAllMocks())

  it('kopiert den Text und zeigt kurz den Haken', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const onCopied = vi.fn()
    render(<CopyButton text="hallo" label="Copy line" feedbackMs={50} onCopied={onCopied} />)
    const btn = screen.getByRole('button', { name: 'Copy line' })
    expect(btn).toHaveAttribute('data-state', 'idle')
    await userEvent.click(btn)
    expect(write).toHaveBeenCalledWith('hallo')
    await waitFor(() => expect(btn).toHaveAttribute('data-state', 'done'))
    expect(onCopied).toHaveBeenCalled()
    await waitFor(() => expect(btn).toHaveAttribute('data-state', 'idle'))
  })

  it('holt den Text erst beim Klick, wenn es eine Funktion ist', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const text = vi.fn(() => 'spaet')
    render(<CopyButton text={text} />)
    expect(text).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(write).toHaveBeenCalledWith('spaet')
  })

  it('meldet einen Fehler, wenn nichts kopiert werden kann', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true })
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true })
    render(<CopyButton text="x" feedbackMs={50} />)
    const btn = screen.getByRole('button', { name: 'Copy' })
    await userEvent.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute('data-state', 'failed'))
  })
})
