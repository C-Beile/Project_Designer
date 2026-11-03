import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('monaco-editor', () => import('../test/monacoMock'))

import { languageForFile } from './TextFileEditor'
import { MarkdownPreview, renderMarkdown } from './MarkdownPreview'

describe('language of a project file', () => {
  it('recognises dot files by their whole name', () => {
    expect(languageForFile('.gitignore')).toBe('forge-ignore')
    expect(languageForFile('.transpilerignore')).toBe('forge-ignore')
    expect(languageForFile('.gitattributes')).toBe('forge-gitattributes')
    expect(languageForFile('.npmrc')).toBe('ini')
    expect(languageForFile(String.raw`C:\work\proj\.gitignore`)).toBe('forge-ignore')
    expect(languageForFile('/work/proj/.GitAttributes')).toBe('forge-gitattributes')
  })

  it('keeps the extension rules', () => {
    expect(languageForFile('CHANGELOG.md')).toBe('markdown')
    expect(languageForFile('package.json')).toBe('json')
    expect(languageForFile('notes.unknown')).toBe('plaintext')
    expect(languageForFile('.hidden')).toBe('plaintext')
  })
})

describe('Markdown preview', () => {
  it('renders headings, lists, tables and code', () => {
    render(<MarkdownPreview text={'# Title\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`code`'} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('removes scripts and event handlers from the rendered text', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toMatch(/javascript:/i)
  })

  it('does not follow links', () => {
    render(<MarkdownPreview text="[site](https://example.com)" />)
    const link = screen.getByRole('link', { name: 'site' })
    expect(link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))).toBe(false)
  })
})
