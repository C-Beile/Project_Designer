import { useEffect, useState } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import type { LocalDataInfo } from '../wire/types'
import { Modal } from '../core/Modal'
import { getOptions } from '../settings/options'

// Help > Local Data (manual chapter 12, screenshot 185): where the Designer keeps its local files.
// Shows Dito Designer's own data folder and, read-only, the version folders of the original Designer
// under %APPDATA%\.aditodesigner with their disk usage; "Run Janitor Now" marks the folders that
// were not used longer than the threshold. Nothing is deleted here - remove folders in Explorer.

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function when(unix: number | null): string {
  return unix ? new Date(unix * 1000).toLocaleString() : '-'
}

export function LocalDataDialog({ api, onClose }: { api: ForgeApi; onClose: () => void }) {
  const [info, setInfo] = useState<LocalDataInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [janitor, setJanitor] = useState(false)
  const threshold = getOptions().misc.janitorDays

  useEffect(() => {
    api.localDataInfo(threshold).then(setInfo).catch((e) => setError(String(e)))
  }, [api, threshold])

  const outdated = info?.designer_versions.filter((v) => v.outdated) ?? []
  const outdatedSize = outdated.reduce((sum, v) => sum + v.size_bytes, 0)

  return (
    <Modal
      title="Local Data"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="forge-localdata">
        {error ? (
          <p className="forge-field-error" role="alert">
            {error}
          </p>
        ) : null}
        {!info && !error ? <p className="forge-field-hint">Please Wait…</p> : null}
        {info ? (
          <>
            <h3>Dito Designer</h3>
            <p>
              Data folder: <code data-testid="forge-data-dir">{info.forge_data_dir}</code>
              <br />
              Settings file: <code>{info.forge_settings_file}</code>
            </p>
            <p className="forge-field-hint">Colors, layout and the last project are kept here and in the browser storage of the application. Renaming the folder starts with fresh settings.</p>
            <table aria-label="Files of the data folder" className="forge-opt-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Date modified</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {info.forge_entries.length === 0 ? (
                  <tr>
                    <td colSpan={3}>The folder is empty.</td>
                  </tr>
                ) : (
                  info.forge_entries.map((e) => (
                    <tr key={e.name}>
                      <td>
                        {e.is_dir ? '📁 ' : ''}
                        {e.name}
                      </td>
                      <td>{when(e.modified_unix)}</td>
                      <td>{formatBytes(e.size_bytes)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <h3>Original ADITO Designer</h3>
            {info.designer_roaming_dir ? (
              <p>
                Version folders: <code>{info.designer_roaming_dir}</code>
                {info.designer_roaming_exists ? '' : ' (does not exist on this computer)'}
              </p>
            ) : (
              <p className="forge-field-hint">The roaming folder of the original Designer could not be determined.</p>
            )}
            {info.designer_versions.length > 0 ? (
              <table aria-label="Version folders" className="forge-opt-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Last use</th>
                    <th>Unused for</th>
                    <th>Size</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {info.designer_versions.map((v) => (
                    <tr key={v.name} className={janitor && v.outdated ? 'is-outdated' : undefined}>
                      <td>{v.name}</td>
                      <td>{when(v.modified_unix)}</td>
                      <td>{v.days_unused === null ? '-' : `${v.days_unused} days`}</td>
                      <td>{formatBytes(v.size_bytes)}</td>
                      <td>{janitor ? (v.outdated ? 'outdated' : 'in use') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p>
              <button type="button" onClick={() => setJanitor(true)} disabled={info.designer_versions.length === 0}>
                Run Janitor Now
              </button>{' '}
              <span className="forge-field-hint">Threshold: {threshold} days (Tools &gt; Options &gt; Miscellaneous &gt; Janitor)</span>
            </p>
            {janitor ? (
              <p role="status">
                {outdated.length === 0
                  ? 'No outdated version folder found.'
                  : `${outdated.length} version folder(s) were not used for more than ${threshold} days and could free ${formatBytes(outdatedSize)}. Dito Designer does not delete them; remove them in Windows Explorer if you no longer need them.`}
              </p>
            ) : null}
            <h3>Designer configuration</h3>
            <p className="forge-field-hint">
              Dito Designer has no ADITOdesigner.conf: memory, DB timeout and start project are not configurable, and the application folder is {info.exe_dir}.
            </p>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
