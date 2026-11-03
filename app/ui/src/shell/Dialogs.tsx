import appIcon256 from '../assets/brand/app-icon-256.png'
import wordmarkWhite from '../assets/brand/wordmark-white.png'
import { useContext, useEffect, useRef, useState } from 'react'
import { OsWindowContext } from '../windows/osWindowContext'
import type { ReactNode } from 'react'
import { isTauriRuntime } from '../chrome/tauriWindow'
import type { ForgeApi } from '../api/ForgeApi'
import type { LocalDataInfo } from '../wire/types'

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled])'

// The one dialog frame of the app. Escape closes only the top dialog, Tab stays inside it, Enter
// runs the default action (`onEnter`, never inside multi-line fields or on other buttons) and the
// focus returns to where it was when the dialog closes.
export function Modal({ title, onClose, children, footer, onEnter }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; onEnter?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const inWindow = useContext(OsWindowContext)
  // The confirming button of every dialog (OK, Save, Deploy ...) is drawn as the primary one.
  useEffect(() => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.forge-modal-footer button') ?? [])]
    if (buttons.some((b) => b.classList.contains('is-primary'))) return
    buttons.find((b) => /^(OK|Save|Deploy|Update|Apply|Open|Finish|Create|Commit|Yes|Delete|Install and restart|Export|Import|Add|Connect)\b/i.test(b.textContent?.trim() ?? ''))?.classList.add('is-primary')
  })
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector<HTMLElement>('input, button, select')?.focus()
    return () => previous?.focus?.()
  }, [])
  return (
    <div className={inWindow ? 'forge-os-dialog-frame' : 'forge-modal-backdrop'}>
      <div
        className={inWindow ? 'forge-os-dialog' : 'forge-modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
            return
          }
          if (e.key === 'Enter' && onEnter && !e.defaultPrevented) {
            const tag = (e.target as HTMLElement).tagName
            if (tag !== 'TEXTAREA' && tag !== 'BUTTON' && tag !== 'SELECT') {
              e.preventDefault()
              e.stopPropagation()
              onEnter()
            }
            return
          }
          if (e.key === 'Tab' && ref.current) {
            const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
            if (items.length === 0) return
            if (e.shiftKey && document.activeElement === items[0]) {
              e.preventDefault()
              items[items.length - 1].focus()
            } else if (!e.shiftKey && document.activeElement === items[items.length - 1]) {
              e.preventDefault()
              items[0].focus()
            }
          }
        }}
      >
        {inWindow ? null : <header className="forge-modal-title">{title}</header>}
        <div className="forge-modal-body">{children}</div>
        <footer className="forge-modal-footer">{footer}</footer>
      </div>
    </div>
  )
}

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
    ['vendira.designer.version', shownVersion ?? 'development build'],
    ['vendira.designer.home', info?.exe_dir ?? ''],
    ['vendira.designer.data', info?.forge_data_dir ?? ''],
    ['vendira.designer.settings', info?.forge_settings_file ?? ''],
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
          <p className="forge-about-by">by 3HillsIT</p>
          <p className="forge-about-version">Version {shownVersion ?? 'development build'}</p>
          <p className="forge-field-hint">A rebuild of the designer for low-code CRM projects.</p>
        </div>
      ) : null}
      {tab === 'licence' ? (
        <div className="forge-about-licence">
          <p>Dito Designer is a product of 3HillsIT. No separate licence file is shipped with this build.</p>
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
