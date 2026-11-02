import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { Modal } from './Dialogs'
import { getOptions, saveOptions, type DesignerOptions } from '../settings/options'
import { ENGINE_LABELS, EXPERIMENTAL_WARNING, type TranspilerEngineId } from '../settings/transpilerEngine'
import { getEditorPrefs, setEditorPref, type EditorPrefs } from '../theme/editorPrefs'
import type { ThemeName } from '../theme/useTheme'
import { formatShortcut, isMacPlatform } from './shortcuts'

// Tools > Options (manual 4.8.3, screenshots 037/038): an icon bar with the categories General,
// Editor, Fonts & Colors, Keymap, Team, Appearance, Miscellaneous, ADITO and iReport; categories
// with several pages show them as tabs below. Vendira-specific settings (Designer installation,
// transpiler) live on ADITO > General. Pages whose feature does not exist yet keep their
// controls visible but dimmed, with the reason.

type Category = 'general' | 'editor' | 'fonts' | 'keymap' | 'team' | 'appearance' | 'misc' | 'adito' | 'ireport'

const CATEGORIES: { id: Category; label: string; glyph: string }[] = [
  { id: 'general', label: 'General', glyph: '🔧' },
  { id: 'editor', label: 'Editor', glyph: '✎' },
  { id: 'fonts', label: 'Fonts & Colors', glyph: '🖌' },
  { id: 'keymap', label: 'Keymap', glyph: '⌨' },
  { id: 'team', label: 'Team', glyph: '👥' },
  { id: 'appearance', label: 'Appearance', glyph: '▭' },
  { id: 'misc', label: 'Miscellaneous', glyph: '🗂' },
  { id: 'adito', label: 'ADITO', glyph: 'A' },
  { id: 'ireport', label: 'iReport', glyph: 'R' },
]

const PAGES: Partial<Record<Category, { id: string; label: string }[]>> = {
  misc: [
    { id: 'csv', label: 'CSV Editor' },
    { id: 'diff', label: 'Diff' },
    { id: 'files', label: 'Files' },
    { id: 'janitor', label: 'Janitor' },
    { id: 'output', label: 'Output' },
    { id: 'terminal', label: 'Terminal' },
  ],
  adito: [
    { id: 'general', label: 'General' },
    { id: 'nodejs', label: 'NodeJS' },
    { id: 'eslint', label: 'ESLint' },
    { id: 'translators', label: 'Translators' },
    { id: 'debugger', label: 'Debugger' },
    { id: 'cloud', label: 'Cloud' },
    { id: 'encoding', label: 'Encoding' },
    { id: 'sharing', label: 'Data Sharing' },
  ],
  ireport: [
    { id: 'general', label: 'General' },
    { id: 'classpath', label: 'Classpath' },
    { id: 'fonts', label: 'Fonts' },
    { id: 'viewers', label: 'Viewers' },
    { id: 'wizard', label: 'Wizard Templates' },
    { id: 'compile', label: 'Compilation and execution' },
    { id: 'query', label: 'Query Executers' },
    { id: 'export', label: 'Export options' },
    { id: 'props', label: 'JasperReports Properties' },
  ],
}

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="forge-opt-row">
      <span className="forge-opt-label">{label}</span>
      <span className="forge-opt-control">{children}</span>
      {hint ? <span className="forge-field-hint forge-opt-hint">{hint}</span> : null}
    </label>
  )
}

function Check({ label, checked, onChange, disabled, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <div className="forge-opt-check">
      <label className="forge-check">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint ? <span className="forge-field-hint">{hint}</span> : null}
    </div>
  )
}

const LATER = 'Stored for later: the feature itself is not available in Vendira Designer yet.'

export interface KeymapEntry {
  group: string
  label: string
  shortcut: string
}

export function OptionsDialog({
  api,
  onClose,
  onSaved,
  engine,
  onEngineChange,
  theme,
  onThemeChange,
  keymap,
}: {
  api: ForgeApi
  onClose: () => void
  onSaved: (installDir: string | null) => void
  engine: TranspilerEngineId
  onEngineChange: (engine: TranspilerEngineId) => void
  theme: ThemeName
  onThemeChange: (theme: ThemeName) => void
  keymap: KeymapEntry[]
}) {
  const [category, setCategory] = useState<Category>('adito')
  const [page, setPage] = useState<Record<string, string>>({ misc: 'csv', adito: 'general', ireport: 'general' })
  const [opts, setOpts] = useState<DesignerOptions>(() => getOptions())
  const [prefs, setPrefs] = useState<EditorPrefs>(() => getEditorPrefs())
  const [engineChoice, setEngineChoice] = useState<TranspilerEngineId>(engine)
  const [themeChoice, setThemeChoice] = useState<ThemeName>(theme)
  const [installDir, setInstallDir] = useState('')
  const [sshKey, setSshKey] = useState('')
  const [acceptNewHostKeys, setAcceptNewHostKeys] = useState(false)
  const keyKind = isMacPlatform() ? 'OpenSSH' : '.ppk'
  const [detected, setDetected] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [keyFilter, setKeyFilter] = useState('')

  useEffect(() => {
    api.getSettings().then((s) => { setInstallDir(s.designer_install_dir ?? ''); setSshKey(s.ssh_key_path ?? ''); setAcceptNewHostKeys(!!s.ssh_accept_new_host_keys) }).catch(() => {})
    api.detectDesignerInstall().then(setDetected).catch(() => setDetected(null))
  }, [api])

  const patch = <K extends keyof DesignerOptions>(group: K, values: Partial<DesignerOptions[K]>) => setOpts((o) => ({ ...o, [group]: { ...o[group], ...values } }))
  const subPage = page[category]

  async function browse() {
    const picked = await api.pickProjectFolder('Choose the ADITO Designer installation').catch(() => null)
    if (picked) setInstallDir(picked)
  }

  async function save() {
    const value = installDir.trim() || null
    try {
      await api.setSettings({ ...(await api.getSettings()), designer_install_dir: value, ssh_key_path: sshKey.trim() || null })
      saveOptions(opts)
      for (const key of Object.keys(prefs) as (keyof EditorPrefs)[]) if (prefs[key] !== getEditorPrefs()[key]) setEditorPref(key, prefs[key])
      if (engineChoice !== engine) onEngineChange(engineChoice)
      if (themeChoice !== theme) onThemeChange(themeChoice)
      onSaved(value)
      onClose()
    } catch (e) {
      setError(String(e))
    }
  }

  let body: ReactNode = null
  if (category === 'general') {
    body = (
      <>
        <h3>General</h3>
        <Check label="Confirm destructive actions (delete, deploy, write statements)" checked={opts.general.confirmDestructive} onChange={(v) => patch('general', { confirmDestructive: v })} disabled hint="Always on: Vendira never deletes or writes without a confirmation." />
        <Check label="Show hints in dialogs" checked={opts.general.showHints} onChange={(v) => patch('general', { showHints: v })} />
        <Row label="Default encoding of new files">
          <input type="text" value="UTF-8" readOnly aria-label="Default encoding" />
        </Row>
      </>
    )
  } else if (category === 'editor') {
    body = (
      <>
        <h3>Editor</h3>
        <Row label="Tab size">
          <input type="number" min={1} max={8} value={opts.editor.tabSize} aria-label="Tab size" onChange={(e) => patch('editor', { tabSize: Math.max(1, Math.min(8, Number(e.target.value) || 2)) })} />
        </Row>
        <Check label="Wrap long lines" checked={opts.editor.wordWrap} onChange={(v) => patch('editor', { wordWrap: v })} />
        <Check label="Show minimap" checked={opts.editor.minimap} onChange={(v) => patch('editor', { minimap: v })} />
        <h4>Display (View menu)</h4>
        <Check label="Show line numbers" checked={prefs.lineNumbers} onChange={(v) => setPrefs({ ...prefs, lineNumbers: v })} />
        <Check label="Show non-printable characters" checked={prefs.nonPrintable} onChange={(v) => setPrefs({ ...prefs, nonPrintable: v })} />
        <Check label="Show indent guide lines" checked={prefs.indentGuides} onChange={(v) => setPrefs({ ...prefs, indentGuides: v })} />
        <Check label="Show inline hints" checked={prefs.inlineHints} onChange={(v) => setPrefs({ ...prefs, inlineHints: v })} />
      </>
    )
  } else if (category === 'fonts') {
    body = (
      <>
        <h3>Fonts &amp; Colors</h3>
        <Row label="Editor font size">
          <input type="number" min={9} max={28} value={opts.editor.fontSize} aria-label="Editor font size" onChange={(e) => patch('editor', { fontSize: Math.max(9, Math.min(28, Number(e.target.value) || 13)) })} />
        </Row>
        <p className="forge-field-hint">The colors follow the Night Owl palette and cannot be changed individually yet.</p>
      </>
    )
  } else if (category === 'keymap') {
    const needle = keyFilter.trim().toLowerCase()
    const rows = keymap.filter((k) => !needle || `${k.group} ${k.label} ${k.shortcut}`.toLowerCase().includes(needle))
    body = (
      <>
        <h3>Keymap</h3>
        <input type="text" placeholder="Search…" aria-label="Search shortcuts" value={keyFilter} onChange={(e) => setKeyFilter(e.target.value)} />
        <div className="forge-opt-scroll">
          <table className="forge-opt-table" aria-label="Shortcuts">
            <thead>
              <tr>
                <th>Menu</th>
                <th>Action</th>
                <th>Shortcut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((k, i) => (
                <tr key={i}>
                  <td>{k.group}</td>
                  <td>{k.label}</td>
                  <td>{formatShortcut(k.shortcut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="forge-field-hint">The shortcuts follow the original Designer and cannot be reassigned yet.</p>
      </>
    )
  } else if (category === 'team') {
    body = (
      <>
        <h3>Team</h3>
        <p>Git actions run from Team &gt; Commit, Pull, Push and Switch Branch. Every action needs its own click; commit messages are a single line without co-author lines, and package-lock.json is deselected by default.</p>
        <p className="forge-field-hint">Git is used through the git installation on this computer.</p>
      </>
    )
  } else if (category === 'appearance') {
    body = (
      <>
        <h3>Appearance</h3>
        <fieldset className="forge-opt-group">
          <legend>Look and feel</legend>
          <label className="forge-check">
            <input type="radio" name="theme" checked={themeChoice === 'dark'} onChange={() => setThemeChoice('dark')} />
            <span>Dark (Night Owl)</span>
          </label>
          <label className="forge-check">
            <input type="radio" name="theme" checked={themeChoice === 'light'} onChange={() => setThemeChoice('light')} />
            <span>Light</span>
          </label>
        </fieldset>
      </>
    )
  } else if (category === 'misc') {
    if (subPage === 'csv') {
      body = (
        <>
          <h3>CSV Editor</h3>
          <Row label="Separator of CSV exports">
            <select aria-label="CSV separator" value={opts.misc.csvSeparator} onChange={(e) => patch('misc', { csvSeparator: e.target.value as DesignerOptions['misc']['csvSeparator'] })}>
              <option value=";">Semicolon ( ; )</option>
              <option value=",">Comma ( , )</option>
              <option value={'\t'}>Tab</option>
            </select>
          </Row>
          <p className="forge-field-hint">Used by the export of the SQL result.</p>
        </>
      )
    } else if (subPage === 'janitor') {
      body = (
        <>
          <h3>Janitor</h3>
          <Check label="Run Janitor on Startup" checked={opts.misc.janitorOnStartup} onChange={(v) => patch('misc', { janitorOnStartup: v })} hint="Only reports outdated version folders; Vendira Designer never deletes them itself." />
          <Row label="Removal threshold (number of days)">
            <input type="number" min={1} max={3650} value={opts.misc.janitorDays} aria-label="Removal threshold" onChange={(e) => patch('misc', { janitorDays: Math.max(1, Number(e.target.value) || 30) })} />
          </Row>
          <p className="forge-field-hint">The old Designer version folders and their disk usage are listed under Help &gt; Local Data.</p>
        </>
      )
    } else if (subPage === 'output') {
      body = (
        <>
          <h3>Output</h3>
          <Row label="Lines kept per output tab">
            <input type="number" min={200} max={100000} step={100} value={opts.misc.outputMaxLines} aria-label="Lines kept" onChange={(e) => patch('misc', { outputMaxLines: Math.max(200, Number(e.target.value) || 5000) })} />
          </Row>
        </>
      )
    } else if (subPage === 'files') {
      body = <p className="forge-field-hint">Files are read and written byte for byte; line endings and encoding of existing files are kept.</p>
    } else if (subPage === 'diff') {
      body = <p className="forge-field-hint">Diff settings are not available yet.</p>
    } else {
      body = <p className="forge-field-hint">The terminal window is not available in Vendira Designer yet.</p>
    }
  } else if (category === 'adito') {
    if (subPage === 'general') {
      body = (
        <>
          <h3>General</h3>
          <label className="forge-field">
            <span>SSH key for tunnels (path only, {keyKind})</span>
            <span className="forge-field-row">
              <input type="text" value={sshKey} aria-label="SSH key path" placeholder="No key chosen" onChange={(e) => setSshKey(e.target.value)} />
              <button
                type="button"
                onClick={async () => {
                  const picked = await api.pickFile('Choose the SSH key', isMacPlatform() ? 'OpenSSH key' : 'PuTTY key', isMacPlatform() ? [] : ['ppk']).catch(() => null)
                  if (picked) setSshKey(picked)
                }}
              >
                Browse…
              </button>
            </span>
          </label>
          <p className="forge-field-hint">Only the path is stored; the key itself and its passphrase never leave the file.{isMacPlatform() ? ' On macOS the tunnel uses OpenSSH: choose an OpenSSH private key (a PuTTY .ppk key must be converted first) or leave it empty to use the keys of the ssh-agent.' : ''}</p>
          {isMacPlatform() ? (
            <label className="forge-field forge-field-check">
              <input
                type="checkbox"
                checked={acceptNewHostKeys}
                aria-label="Trust unknown SSH host keys on first connect"
                onChange={async (e) => {
                  const on = e.target.checked
                  setAcceptNewHostKeys(on)
                  await api.setSettings({ ...(await api.getSettings()), ssh_accept_new_host_keys: on }).catch(() => {})
                }}
              />
              <span>Trust unknown SSH host keys on first connect</span>
            </label>
          ) : null}
          <label className="forge-field">
            <span>ADITO Designer installation</span>
            <span className="forge-field-row">
              <input type="text" value={installDir} placeholder={detected ? `Automatic: ${detected}` : 'Automatic detection'} onChange={(e) => setInstallDir(e.target.value)} />
              <button type="button" onClick={browse}>
                Browse…
              </button>
            </span>
          </label>
          <p className="forge-field-hint" data-testid="detected-install">
            {detected === undefined ? 'Searching for an installed ADITO Designer…' : detected ? `Found automatically: ${detected}` : 'No ADITO Designer installation found automatically.'}
          </p>
          {detected && installDir.trim() !== detected ? (
            <button type="button" className="forge-link-btn" onClick={() => setInstallDir(detected)}>
              Use detected folder
            </button>
          ) : null}
          <p className="forge-field-hint">Leave empty to use the automatically detected installation for each transpile.</p>
          <fieldset className="forge-opt-group">
            <legend>Transpiler</legend>
            {(['official', 'experimental'] as const).map((id) => (
              <label key={id} className="forge-check">
                <input type="radio" name="engine" checked={engineChoice === id} onChange={() => setEngineChoice(id)} />
                <span>{ENGINE_LABELS[id]}</span>
              </label>
            ))}
            {engineChoice === 'experimental' ? (
              <p className="forge-field-error" role="note">
                {EXPERIMENTAL_WARNING}
              </p>
            ) : null}
            <p className="forge-field-hint">The choice applies to this session only; every start begins with the official transpiler.</p>
          </fieldset>
          <fieldset className="forge-opt-group">
            <legend>Dialogs</legend>
            <Check label="Check Scan Services on deploy (Errors, Warnings)" checked={opts.general.checkScanOnDeploy} onChange={(v) => patch('general', { checkScanOnDeploy: v })} />
          </fieldset>
          <fieldset className="forge-opt-group">
            <legend>Scan Services</legend>
            <Check label="Refresh on file change" checked={opts.general.refreshScanOnChange} onChange={(v) => patch('general', { refreshScanOnChange: v })} />
          </fieldset>
        </>
      )
    } else if (subPage === 'nodejs') {
      body = (
        <>
          <h3>NodeJS</h3>
          <Row label="NodeJS installation path" hint={LATER}>
            <input type="text" aria-label="NodeJS path" value={opts.nodejs.path} onChange={(e) => patch('nodejs', { path: e.target.value })} />
          </Row>
        </>
      )
    } else if (subPage === 'eslint') {
      body = (
        <>
          <h3>ESLint</h3>
          <Check label="Analyze code after saving a file" checked={opts.eslint.analyzeOnSave} onChange={(v) => patch('eslint', { analyzeOnSave: v })} hint={LATER} />
        </>
      )
    } else if (subPage === 'translators') {
      body = (
        <>
          <h3>Translators</h3>
          <Row label="Translation service">
            <select aria-label="Translation service" value={opts.translators.provider} onChange={(e) => patch('translators', { provider: e.target.value as DesignerOptions['translators']['provider'] })}>
              <option value="none">None</option>
              <option value="deepl">DeepL</option>
              <option value="google">Google</option>
              <option value="yandex">Yandex</option>
            </select>
          </Row>
          <Row label="API key">
            <input type="password" disabled aria-label="API key" placeholder="not stored" />
          </Row>
          <p className="forge-field-hint">API keys are never stored by Vendira Designer, and automatic translation is not available yet.</p>
        </>
      )
    } else if (subPage === 'debugger') {
      body = (
        <>
          <h3>Debugger</h3>
          <Check label="Enable the debugger" checked={opts.debugger.enabled} onChange={(v) => patch('debugger', { enabled: v })} hint={LATER} />
          <Check label="Show elapsed time at the stopped line" checked={opts.debugger.showElapsed} onChange={(v) => patch('debugger', { showElapsed: v })} />
        </>
      )
    } else if (subPage === 'cloud') {
      body = (
        <>
          <h3>Cloud</h3>
          <Row label="Buffer size of the log (RXJava backpressure)" hint={LATER}>
            <input type="number" min={1} value={opts.cloud.bufferSize} aria-label="Log buffer size" onChange={(e) => patch('cloud', { bufferSize: Math.max(1, Number(e.target.value) || 128) })} />
          </Row>
        </>
      )
    } else if (subPage === 'encoding') {
      body = (
        <>
          <h3>Encoding</h3>
          <Row label="Encoding" hint="Existing files keep their own encoding; new files are written as UTF-8.">
            <select aria-label="Encoding" value={opts.encoding.defaultEncoding} onChange={(e) => patch('encoding', { defaultEncoding: e.target.value })}>
              <option value="UTF-8">UTF-8</option>
            </select>
          </Row>
        </>
      )
    } else {
      body = (
        <>
          <h3>Data Sharing</h3>
          <Check label="Share anonymous usage statistics" checked={false} onChange={() => {}} disabled hint="Vendira Designer never sends usage statistics." />
        </>
      )
    }
  } else {
    body = (
      <>
        <h3>{PAGES.ireport?.find((p) => p.id === subPage)?.label ?? 'iReport'}</h3>
        <p className="forge-field-hint">The report designer (iReport / JasperReports) is not part of Vendira Designer yet, so these settings have no effect.</p>
      </>
    )
  }

  const pages = PAGES[category]
  return (
    <Modal
      title="Options"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={save}>
            OK
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled title="No help pages yet">
            Help
          </button>
        </>
      }
    >
      <div className="forge-options">
        <div className="forge-opt-cats" role="tablist" aria-label="Option categories">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={category === c.id} className={`forge-opt-cat${category === c.id ? ' is-active' : ''}`} onClick={() => setCategory(c.id)}>
              <span className="forge-opt-glyph" aria-hidden="true">
                {c.glyph}
              </span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        {pages ? (
          <div className="forge-opt-pages" role="tablist" aria-label={`${CATEGORIES.find((c) => c.id === category)!.label} pages`}>
            {pages.map((p) => (
              <button key={p.id} type="button" role="tab" aria-selected={subPage === p.id} className={`forge-opt-page${subPage === p.id ? ' is-active' : ''}`} onClick={() => setPage((s) => ({ ...s, [category]: p.id }))}>
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="forge-opt-body" role="tabpanel">
          {body}
          {error ? (
            <p className="forge-field-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

