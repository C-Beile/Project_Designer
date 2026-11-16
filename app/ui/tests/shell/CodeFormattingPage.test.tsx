import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, type DesignerOptions } from '../../src/settings/options'
import { CodeFormattingPage } from '../../src/shell/CodeFormattingPage'
import { choose, selected } from '../support/dropdown'

function Harness() {
  const [editor, setEditor] = useState<DesignerOptions['editor']>(DEFAULT_OPTIONS.editor)
  return <CodeFormattingPage editor={editor} onChange={(v) => setEditor((e) => ({ ...e, ...v }))} />
}

describe('Options > Appearance > Code formatting', () => {
  it('shows the preview in the chosen font and size at once', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await choose(user, 'Code font family', 'Fira Code')
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '18' } })
    const preview = screen.getByLabelText('Code preview')
    expect(preview.style.fontFamily).toContain('Fira Code')
    expect(preview.style.fontSize).toBe('18px')
  })

  it('starts with the default font of style.toml and lists the bundled fonts', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(selected('Code font family')).toBe('')
    expect(screen.getByLabelText('Code preview').style.fontFamily).toContain('IBM Plex Mono')
    await user.click(screen.getByRole('button', { name: /Default \(IBM Plex Mono\)/ }))
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(names).toEqual(expect.arrayContaining(['IBM Plex Mono', 'JetBrains Mono', 'Source Code Pro', 'Fira Code', 'Consolas']))
  })

  it('takes any installed font through "Other installed font"', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await choose(user, 'Code font family', '__custom__')
    fireEvent.change(screen.getByLabelText('Font name'), { target: { value: 'Cascadia Code' } })
    expect(screen.getByLabelText('Code preview').style.fontFamily).toContain('Cascadia Code')
  })

  it('keeps the line height automatic until it is switched off', () => {
    render(<Harness />)
    expect(screen.getByLabelText('Line height')).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: /Line height from the font size/ }))
    expect(screen.getByLabelText('Line height')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Line height'), { target: { value: '24' } })
    expect(screen.getByLabelText('Code preview').style.lineHeight).toBe('24px')
  })

  it('turns ligatures on and resets everything to the defaults', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('switch', { name: /Font ligatures/ }))
    expect(screen.getByLabelText('Code preview').style.fontVariantLigatures).toBe('normal')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(screen.getByLabelText('Code preview').style.fontVariantLigatures).toBe('none')
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
  })
})
