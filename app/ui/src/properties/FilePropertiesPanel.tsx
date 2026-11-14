import { useResource } from '../core/hooks/useResource'
import { useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { Input } from '../core/ui/controls'

// Properties of a plain file in the Projects tree (original Designer, reference shot 94): group
// "Properties" with Name, Extension, File Size, Modification Time and All Files (the full path).

export function formatFileSize(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} B`
}

export function formatModified(ms: number | null): string {
  if (ms === null) return ''
  return new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'medium' })
}

export function FilePropertiesPanel({ api, path }: { api: ForgeApi; path: string }) {
  const [selected, setSelected] = useState<string | null>(null)

  const loaded = useResource(() => api.fileInfo(path), [api, path])
  const info = loaded.data ?? null
  const error = loaded.error ?? null

  if (error) return <div className="forge-panel-empty">{error}</div>
  if (!info) return <div className="forge-panel-empty">Please Wait…</div>
  const rows: [string, string][] = [
    ['Name', info.name],
    ['Extension', info.extension],
    ['File Size', formatFileSize(info.size)],
    ['Modification Time', formatModified(info.modified_ms)],
    ['All Files', info.path],
  ]
  return (
    <div className="psheet">
      <div className="psheet-grid" role="grid" aria-label="File properties">
        <div role="rowgroup" className="psheet-group">
          <div role="row" className="psheet-group-head">
            <span className="psheet-toggle" aria-hidden="true">
              ▾
            </span>
            <span className="psheet-group-label">Properties</span>
          </div>
          {rows.map(([label, value]) => (
            <div key={label} role="row" className={`psheet-row${value ? '' : ' is-unset'}${selected === label ? ' is-selected' : ''}`} onMouseDown={() => setSelected(label)}>
              <span role="rowheader" className="psheet-label">
                {label}
              </span>
              <span role="gridcell" className="psheet-value">
                <Input type="text" className="psheet-input" aria-label={label} value={value} readOnly title={value} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="psheet-desc">
        <strong>{selected ?? info.name}</strong>
        <p>{selected ? '' : info.path}</p>
      </div>
    </div>
  )
}
