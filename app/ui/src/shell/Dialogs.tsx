import appIcon256 from '../assets/brand/app-icon-256.png'
import wordmarkWhite from '../assets/brand/wordmark-white.png'
import { useEffect, useState } from 'react'
import { isTauriRuntime } from '../chrome/tauriWindow'
import type { ForgeApi } from '../api/ForgeApi'
import type { LocalDataInfo } from '../wire/types'
import { Modal } from '../core/Modal'

export function AboutDialog({ api, onClose }: { api?: ForgeApi; onClose: () => void }) {
  const [version, setVersion] = useState<string | null>(null)
  const [tab, setTab] = useState<'version' | 'licence' | 'system'>('version')
  const [info, setInfo] = useState<LocalDataInfo | null>(null)
  useEffect(() => {
    if (!isTauriRuntime()) return
    import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then(setVersion)
      .catch(() => {})
  }, [])
  useEffect(() => {
    api?.localDataInfo(30).then(setInfo).catch(() => {})
  }, [api])
  const shownVersion = version ?? info?.app_version ?? null
  const systemRows: [string, string][] = [
    ['dito.designer.version', shownVersion ?? 'development build'],
    ['dito.designer.home', info?.exe_dir ?? ''],
    ['dito.designer.data', info?.forge_data_dir ?? ''],
    ['dito.designer.settings', info?.forge_settings_file ?? ''],
    ['adito.designer.install', info?.designer_install ?? 'not found'],
    ['adito.designer.roaming', info?.designer_roaming_dir ?? ''],
    ['os.name', info?.os ?? ''],
    ['os.arch', info?.arch ?? ''],
    ['webview.user.agent', typeof navigator === 'undefined' ? '' : navigator.userAgent],
  ]
  return (
    <Modal
      title="About Dito Designer"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="forge-opt-pages" role="tablist" aria-label="About">
        {(['version', 'licence', 'system'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`forge-opt-page${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
            {t === 'version' ? 'Version' : t === 'licence' ? 'Licence' : 'System'}
          </button>
        ))}
      </div>
      {tab === 'version' ? (
        <div className="forge-about">
          <img className="forge-about-icon" src={appIcon256} alt="Dito Designer logo" />
          <img className="forge-about-wordmark" src={wordmarkWhite} alt="Dito Designer" />
          <p className="forge-about-title">Dito Designer</p>
          <p className="forge-about-by">by C.Beile</p>
          <p className="forge-about-version">Version {shownVersion ?? 'development build'}</p>
          <p className="forge-field-hint">A rebuild of the designer for low-code CRM projects.</p>
        </div>
      ) : null}
      {tab === 'licence' ? (
        <div className="forge-about-licence">
          <p>Dito Designer was made by C.Beile. No separate licence file is shipped with this build.</p>
          <p className="forge-field-hint">Third-party parts: the Montserrat font (SIL Open Font License 1.1, from @fontsource/montserrat 5.3.0; the licence text lies next to the font files) and the Monaco editor (MIT).</p>
        </div>
      ) : null}
      {tab === 'system' ? (
        <div className="forge-opt-scroll">
          <table className="forge-opt-table" aria-label="System properties">
            <tbody>
              {systemRows.map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Modal>
  )
}
