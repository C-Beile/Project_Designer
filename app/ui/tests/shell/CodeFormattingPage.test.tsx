import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, type DesignerOptions } from '../../src/settings/options'
import { CodeFormattingPage } from '../../src/shell/CodeFormattingPage'

function Harness() {
  const [editor, setEditor] = useState<DesignerOptions['editor']>(DEFAULT_OPTIONS.editor)
  return <CodeFormattingPage editor={editor} onChange={(v) => setEditor((e) => ({ ...e, ...v }))} />
}

describe('Options > Appearance > Code formatting', () => {
  it('shows the preview in the chosen font and size at once', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Family'), { target: { value: 'Fira Code' } })
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '18' } })
    const preview = screen.getByLabelText('Code preview')
    expect(preview.style.fontFamily).toContain('Fira Code')
    expect(preview.style.fontSize).toBe('18px')
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
