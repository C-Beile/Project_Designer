import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readViewFile } from '../../src/core/viewFiles'
import { ViewFileEditor } from '../../src/tabs/ViewFileEditor'

describe('ViewFileEditor (abgelegte Datei)', () => {
  it('zeigt eine CSV-Datei als Tabelle und weist auf die reine Ansicht hin', async () => {
    const result = await readViewFile(new File(['Name;Ort\nAnna;Wien\nBen;Graz'], 'liste.csv'))
    if (!result.ok) throw new Error(result.reason)
    const { container } = render(<ViewFileEditor id={result.node.id} label={result.node.label} />)
    expect(screen.getByRole('note').textContent).toContain('never saved')
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull())
    expect(container.textContent).toContain('Anna')
    expect(container.textContent).toContain('Graz')
    expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true')
  })

  it('zeigt bei unbekanntem Inhalt einen Hinweis statt eines Fehlers', () => {
    render(<ViewFileEditor id="view:999:weg.txt" label="weg.txt" />)
    expect(screen.getByText(/no longer available/)).toBeTruthy()
  })
})
