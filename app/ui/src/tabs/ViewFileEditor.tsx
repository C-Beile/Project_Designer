import { useRef, useState } from 'react'
import { viewFileText } from '../core/viewFiles'
import { Button } from '../core/ui/controls'
import { CsvPreview } from './CsvPreview'
import { MarkdownPreview } from './MarkdownPreview'
import { MonacoText, type MonacoTextHandle } from './MonacoText'
import { MARKDOWN_VIEWS, languageForFile, previewKindForFile, type MarkdownView } from './TextFileEditor'

export function ViewFileEditor({ id, label }: { id: string; label: string }) {
  const handleRef = useRef<MonacoTextHandle | null>(null)
  const [view, setView] = useState<MarkdownView>('preview')
  const text = viewFileText(id)
  if (text === null) {
    return (
      <div className="forge-editor-empty">
        <p className="forge-field-hint">{`${label}: the content is no longer available. Drop the file again.`}</p>
      </div>
    )
  }
  const previewKind = previewKindForFile(label)
  return (
    <div className="forge-source">
      <div className="forge-source-note" role="note">
        Read-only view: this file is not part of a project and is never saved.
      </div>
      {previewKind ? (
        <div className="forge-md-switch" role="tablist" aria-label={previewKind === 'csv' ? 'CSV view' : 'Markdown view'}>
          {MARKDOWN_VIEWS.map(([key, name]) => (
            <Button variant="bare" key={key} role="tab" aria-selected={view === key} className={`forge-md-tab${view === key ? ' is-active' : ''}`} onClick={() => setView(key)}>
              {name}
            </Button>
          ))}
        </div>
      ) : null}
      <div className={`forge-md-body${previewKind ? ` is-${view}` : ''}`}>
        <div className="forge-md-source">
          <MonacoText initial={text} language={languageForFile(label)} readOnly label={label} onChange={() => {}} handleRef={handleRef} />
        </div>
        {previewKind === 'markdown' && view !== 'source' ? <MarkdownPreview text={text} /> : null}
        {previewKind === 'csv' && view !== 'source' ? <CsvPreview text={text} /> : null}
      </div>
    </div>
  )
}
