import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CsvPreview, detectDelimiter, parseCsv } from '../../src/tabs/CsvPreview'
import { previewKindForFile } from '../../src/tabs/TextFileEditor'

describe('CSV preview', () => {
  it('detects the delimiter', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a,b\n1,2')).toBe(',')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
  })

  it('reads quoted fields with delimiters, line breaks and doubled quotes', () => {
    const rows = parseCsv('name,note\n"Meier, Anna","said ""hi""\nthen left"\nBob,\n', ',')
    expect(rows).toEqual([
      ['name', 'note'],
      ['Meier, Anna', 'said "hi"\nthen left'],
      ['Bob', ''],
    ])
  })

  it('shows a table with a header row and numbered rows', () => {
    render(<CsvPreview text={'id;title\n1;First\n2;Second'} />)
    expect(screen.getByRole('columnheader', { name: 'title' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: '2' })).toBeInTheDocument()
  })

  it('offers the preview for csv, tsv and markdown files only', () => {
    expect(previewKindForFile('data/export.CSV')).toBe('csv')
    expect(previewKindForFile('a.tsv')).toBe('csv')
    expect(previewKindForFile('README.md')).toBe('markdown')
    expect(previewKindForFile('index.js')).toBeNull()
  })
})

describe('tunnel view scrolls', () => {
  const css = readFileSync('src/styles/shell/tunnel-table.css', 'utf8')

  it('lets the editor scroll and never clips the ports card', () => {
    expect(css).toMatch(/\.tunnel-editor\s*\{[^}]*overflow-y:\s*auto/)
    const card = /\.tunnel-editor \.tpx\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(card).not.toMatch(/overflow:\s*hidden/)
    expect(css).toMatch(/\.tunnel-editor > \*\s*\{[^}]*flex-shrink:\s*0/)
  })
})
