import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { DesignerOptions } from '../settings/options'
import { clampZoom, loadUiZoom, setUiZoom, UI_ZOOM_MAX, UI_ZOOM_MIN } from '../settings/zoom'
import { getWorkspaceFolders, removeWorkspaceFolder, setWorkspaceFolder, subscribeWorkspaceFolders } from '../settings/workspaceFolder'
import { baseName } from './shellHelpers'

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="gen-section">
      <header>
        <h4>{title}</h4>
        <p>{description}</p>
      </header>
      <div className="gen-section-body">{children}</div>
    </section>
  )
}

function Switch({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`gen-switch${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="gen-switch-text">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  )
}

export function GeneralOptions({ api, opts, onChange }: { api: ForgeApi; opts: DesignerOptions['general']; onChange: (values: Partial<DesignerOptions['general']>) => void }) {
  const [zoom, setZoom] = useState(() => loadUiZoom())
  const [folders, setFolders] = useState(() => getWorkspaceFolders())
  useEffect(() => subscribeWorkspaceFolders(() => setFolders(getWorkspaceFolders())), [])

  async function addFolder() {
    const picked = await api.pickProjectFolder('Folder with all your ADITO projects').catch(() => null)
    if (picked) setWorkspaceFolder(picked)
  }

  return (
    <div className="gen-page">
      <h3>General</h3>

      <Section title="Start" description="What the Designer does when it opens.">
        <Switch label="Reopen the projects of the last session" hint="The projects that were open when you closed the Designer come back with their tree." checked={opts.restoreProjects} onChange={(v) => onChange({ restoreProjects: v })} />
      </Section>

      <Section title="Interface size" description="Scales the whole window. Applies at once. Ctrl+Shift+Plus, Minus and 0 do the same.">
        <div className="gen-zoom">
          <input
            type="range"
            aria-label="Interface size"
            min={UI_ZOOM_MIN * 100}
            max={UI_ZOOM_MAX * 100}
            step={10}
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(setUiZoom(clampZoom(Number(e.target.value) / 100)))}
          />
          <output>{Math.round(zoom * 100)} %</output>
          <button type="button" disabled={zoom === 1} onClick={() => setZoom(setUiZoom(1))}>
            Reset
          </button>
        </div>
      </Section>

      <Section title="Project folders" description="Folders that hold all your ADITO projects. They show up under File > Open Recent Project and in the context menu of the Projects panel.">
        {folders.length === 0 ? <p className="gen-empty">No folder yet.</p> : null}
        <ul className="gen-folders">
          {folders.map((f) => (
            <li key={f}>
              <span className="gen-folder-name">{baseName(f)}</span>
              <span className="gen-folder-path" title={f}>
                {f}
              </span>
              <button type="button" aria-label={`Remove folder ${baseName(f)}`} onClick={() => removeWorkspaceFolder(f)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div>
          <button type="button" onClick={() => void addFolder()}>
            Add folder...
          </button>
        </div>
      </Section>

      <Section title="Scan Services" description="Checks of the project while you work and before you deploy.">
        <Switch label="Run the scan again after a file changed" checked={opts.refreshScanOnChange} onChange={(v) => onChange({ refreshScanOnChange: v })} />
        <Switch label="Tick Check Scan Services in the Deploy dialog from the start" checked={opts.checkScanOnDeploy} onChange={(v) => onChange({ checkScanOnDeploy: v })} />
      </Section>

      <Section title="Safety" description="Dito Designer asks before it changes something that cannot be taken back.">
        <Switch label="Confirm deleting, deploying and write statements" hint="Always on. This cannot be switched off." checked disabled onChange={() => undefined} />
      </Section>

      <Section title="Files" description="How the Designer reads and writes files.">
        <p className="gen-info">New files are written as UTF-8. Files of ADITO projects keep the line endings and the encoding they have.</p>
      </Section>
    </div>
  )
}
