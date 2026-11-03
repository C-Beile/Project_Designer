import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Rendered view of a Markdown file next to its source. The HTML comes from `marked` and is
// cleaned by DOMPurify before it is shown, so a README cannot run scripts. Links never leave the
// editor (a click only selects them); images with a relative path are not resolved.

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { gfm: true, async: false }) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input'], FORBID_ATTR: ['style'] })
}

export function MarkdownPreview({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text])
  return (
    <div
      className="forge-md"
      aria-label="Markdown preview"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) e.preventDefault()
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
