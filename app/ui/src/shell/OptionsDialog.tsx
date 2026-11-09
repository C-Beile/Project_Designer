import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ForgeApi } from '../api/ForgeApi'
import { Modal } from '../core/Modal'
import { getOptions, saveOptions, type DesignerOptions } from '../settings/options'
import { ENGINE_LABELS, type TranspilerEngineId } from '../settings/transpilerEngine'
import { getEditorPrefs, setEditorPref, type EditorPrefs } from '../theme/editorPrefs'
import type { ThemeName } from '../theme/useTheme'
import { formatShortcut, isMacPlatform } from '../core/shortcuts'
import { OptionIcon } from './optionIcons'
import { customThemes, removeCustomTheme, saveCustomTheme, subscribeCustomThemes } from '../theme/customThemes'
import { parseThemePack } from '../theme/vscodeTheme'
import { errorText } from '../core/errorText'
import { useOptionsPages } from '../core/plugins/registry'

// Tools > Options (manual 4.8.3, screenshots 037/038): an icon bar with the categories General,
// Editor, Fonts & Colors, Keymap, Team, Appearance, Miscellaneous, ADITO and iReport; categories
// with several pages show them as tabs below. Dito-specific settings (Designer installation,
// transpiler) live on ADITO > General. Pages whose feature does not exist yet keep their
// controls visible but dimmed, with the reason.

// 'team' kommt aus dem Plugin-Register (Git), siehe das Git-Plugin.
type Category = 'general' | 'editor' | 'fonts' | 'keymap' | 'appearance' | 'misc' | 'adito' | 'ireport'

const CATEGORIES: { id: string; label: string; order: number }[] = [
  { id: 'general', label: 'General', order: 10 },
  { id: 'editor', label: 'Editor', order: 20 },
  { id: 'fonts', label: 'Fonts & Colors', order: 30 },
  { id: 'keymap', label: 'Keymap', order: 40 },
  { id: 'appearance', label: 'Appearance', order: 50 },
  { id: 'misc', label: 'Miscellaneous', order: 60 },
  { id: 'adito', label: 'ADITO', order: 70 },
  { id: 'ireport', label: 'iReport', order: 80 },
]

const PAGES: Partial<Record<Category, { id: string; label: string }[]>> = {
  editor: [
    { id: 'general', label: 'General' },
    { id: 'cursor', label: 'Cursor & Scrolling' },
    { id: 'code', label: 'Code' },
    { id: 'save', label: 'On Save' },
  ],
  fonts: [
    { id: 'fonts', label: 'Fonts' },
    { id: 'themes', label: 'Color Themes' },
  ],
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

const LATER = 'Stored for later: the feature itself is not available in Dito Designer yet.'

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
  const registeredPages = useOptionsPages()
  const categories = [...CATEGORIES, ...registeredPages.map((p) => ({ id: p.category, label: p.title, order: p.order }))].sort((a, b) => a.order - b.order)
  const [category, setCategory] = useState<string>('adito')
  const [page, setPage] = useState<Record<string, string>>({ misc: 'csv', adito: 'general', ireport: 'general', editor: 'general', fonts: 'fonts' })
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
  const [themes, setThemes] = useState(() => customThemes())
  const [themeMessage, setThemeMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => subscribeCustomThemes(() => setThemes(customThemes())), [])

  async function importTheme(fromFolder = false) {
    setThemeMessage(null)
    const picked = fromFolder
      ? await api.pickProjectFolder('Choose the folder of a VS Code theme extension').catch(() => null)
      : await api.pickFile('Install a VS Code colour theme', 'Theme (.json, .vsix, .zip)', ['json', 'jsonc', 'vsix', 'zip']).catch(() => null)
    if (!picked) return
    try {
      const imported = parseThemePack(await api.readThemePack(picked))
      imported.forEach(saveCustomTheme)
      patch('editor', { colorTheme: imported[0].id })
      setThemeMessage({
        ok: true,
        text: imported.length === 1 ? `Installed "${imported[0].name}" (${imported[0].data.rules.length} token colours). It is applied when you press OK.` : `Installed ${imported.length} themes (${imported.map((t) => t.name).join(', ')}). "${imported[0].name}" is applied when you press OK.`,
      })
    } catch (e) {
      setThemeMessage({ ok: false, text: errorText(e) })
    }
  }

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
        <Check label="Confirm destructive actions (delete, deploy, write statements)" checked={opts.general.confirmDestructive} onChange={(v) => patch('general', { confirmDestructive: v })} disabled hint="Always on: Dito Designer never deletes or writes without a confirmation." />
        <Check label="Show hints in dialogs" checked={opts.general.showHints} onChange={(v) => patch('general', { showHints: v })} />
        <Row label="Default encoding of new files">
          <input type="text" value="UTF-8" readOnly aria-label="Default encoding" />
        </Row>
      </>
    )
  } else if (category === 'editor') {
    const sub = page.editor
    const ed = opts.editor
    const pick = (key: keyof DesignerOptions['editor']) => (e: { target: { value: string } }) => patch('editor', { [key]: e.target.value } as Partial<DesignerOptions['editor']>)
    const tog = (key: keyof DesignerOptions['editor']) => (v: boolean) => patch('editor', { [key]: v } as Partial<DesignerOptions['editor']>)
    body =
      sub === 'cursor' ? (
        <>
          <h3>Cursor &amp; Scrolling</h3>
          <Row label="Cursor blinking" hint="Smooth fades the cursor in and out instead of switching it on and off.">
            <select aria-label="Cursor blinking" value={ed.cursorBlinking} onChange={pick('cursorBlinking')}>
              <option value="smooth">Smooth</option>
              <option value="blink">Blink</option>
              <option value="phase">Phase</option>
              <option value="expand">Expand</option>
              <option value="solid">Solid (no blinking)</option>
            </select>
          </Row>
          <Row label="Cursor style">
            <select aria-label="Cursor style" value={ed.cursorStyle} onChange={pick('cursorStyle')}>
              <option value="line">Line</option>
              <option value="line-thin">Thin line</option>
              <option value="block">Block</option>
              <option value="block-outline">Block outline</option>
              <option value="underline">Underline</option>
              <option value="underline-thin">Thin underline</option>
            </select>
          </Row>
          <Check label="Move the cursor smoothly (animated caret)" checked={ed.smoothCaret} onChange={tog('smoothCaret')} />
          <Check label="Scroll smoothly" checked={ed.smoothScrolling} onChange={tog('smoothScrolling')} />
          <Check label="Allow scrolling past the last line" checked={ed.scrollBeyondLastLine} onChange={tog('scrollBeyondLastLine')} />
          <Row label="Highlight the current line">
            <select aria-label="Line highlight" value={ed.lineHighlight} onChange={pick('lineHighlight')}>
              <option value="line">Line</option>
              <option value="gutter">Line numbers</option>
              <option value="all">Line and line numbers</option>
              <option value="none">Off</option>
            </select>
          </Row>
        </>
      ) : sub === 'code' ? (
        <>
          <h3>Code</h3>
          <Check label="Sticky header: keep the current function or class visible at the top" checked={ed.stickyScroll} onChange={tog('stickyScroll')} hint="While you scroll through a long function, its first lines stay pinned at the top of the editor." />
          <Check label="Colour matching brackets" checked={ed.bracketColors} onChange={tog('bracketColors')} />
          <Check label="Close brackets and quotes automatically" checked={ed.autoCloseBrackets} onChange={tog('autoCloseBrackets')} />
          <Check label="Allow folding of code blocks" checked={ed.folding} onChange={tog('folding')} />
          <Check label="Show inline hints" checked={prefs.inlineHints} onChange={(v) => setPrefs({ ...prefs, inlineHints: v })} />
        </>
      ) : sub === 'save' ? (
        <>
          <h3>On Save</h3>
          <Check label="Format the file when it is saved" checked={ed.formatOnSave} onChange={tog('formatOnSave')} hint={`Applies to code and text files. Format by hand with ${formatShortcut('Alt+Shift+F')} (Source > Format).`} />
        </>
      ) : (
        <>
          <h3>Editor</h3>
          <Row label="Tab size">
            <input type="number" min={1} max={8} value={ed.tabSize} aria-label="Tab size" onChange={(e) => patch('editor', { tabSize: Math.max(1, Math.min(8, Number(e.target.value) || 2)) })} />
          </Row>
          <Check label="Insert spaces when Tab is pressed" checked={ed.insertSpaces} onChange={tog('insertSpaces')} />
          <Check label="Wrap long lines" checked={ed.wordWrap} onChange={tog('wordWrap')} />
          <Check label="Show minimap" checked={ed.minimap} onChange={tog('minimap')} />
          <h4>Display (View menu)</h4>
          <Check label="Show line numbers" checked={prefs.lineNumbers} onChange={(v) => setPrefs({ ...prefs, lineNumbers: v })} />
          <Check label="Show non-printable characters" checked={prefs.nonPrintable} onChange={(v) => setPrefs({ ...prefs, nonPrintable: v })} />
          <Check label="Show indent guide lines" checked={prefs.indentGuides} onChange={(v) => setPrefs({ ...prefs, indentGuides: v })} />
        </>
      )
  } else if (category === 'fonts') {
    const ed = opts.editor
    body =
      page.fonts === 'themes' ? (
        <>
          <h3>Color Themes</h3>
          <Row label="Editor colours" hint="Colours the code editor only. The rest of the window keeps the application theme.">
            <select aria-label="Editor color theme" value={themes.some((t) => t.id === ed.colorTheme) ? ed.colorTheme : ''} onChange={(e) => patch('editor', { colorTheme: e.target.value })}>
              <option value="">Follow the application theme</option>
              {themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Row>
          <div className="forge-opt-buttons">
            <button type="button" onClick={() => void importTheme()}>
              Install theme (.json, .vsix)...
            </button>
            <button type="button" onClick={() => void importTheme(true)}>
              Install from folder...
            </button>
            <button
              type="button"
              disabled={!themes.some((t) => t.id === ed.colorTheme)}
              onClick={() => {
                removeCustomTheme(ed.colorTheme)
                patch('editor', { colorTheme: '' })
              }}
            >
              Remove selected theme
            </button>
          </div>
          {themeMessage ? (
            <p className={themeMessage.ok ? 'forge-field-hint' : 'forge-field-error'} role={themeMessage.ok ? 'status' : 'alert'}>
              {themeMessage.text}
            </p>
          ) : null}
          <p className="forge-field-hint">Choose a theme file of VS Code (a .json file from a theme extension or from Code's theme folder). The token colours and the editor colours are taken over.</p>
        </>
      ) : (
        <>
          <h3>Fonts</h3>
          <Row label="Editor font" hint="Name of an installed font, for example JetBrains Mono. Empty uses Consolas.">
            <input type="text" value={ed.fontFamily} aria-label="Editor font family" placeholder="Consolas" onChange={(e) => patch('editor', { fontFamily: e.target.value })} />
          </Row>
          <Row label="Editor font size">
            <input type="number" min={9} max={28} value={ed.fontSize} aria-label="Editor font size" onChange={(e) => patch('editor', { fontSize: Math.max(9, Math.min(28, Number(e.target.value) || 13)) })} />
          </Row>
          <Row label="Line height" hint="0 sets it automatically from the font size.">
            <input type="number" min={0} max={60} value={ed.lineHeight} aria-label="Line height" onChange={(e) => patch('editor', { lineHeight: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
          </Row>
          <Check label="Font ligatures (for fonts that have them, such as Fira Code)" checked={ed.fontLigatures} onChange={(v) => patch('editor', { fontLigatures: v })} />
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
          <label className="forge-check">
            <input type="radio" name="theme" checked={themeChoice === 'lion'} onChange={() => setThemeChoice('lion')} />
            <span>Lion in der City</span>
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
          <Check label="Run Janitor on Startup" checked={opts.misc.janitorOnStartup} onChange={(v) => patch('misc', { janitorOnStartup: v })} hint="Only reports outdated version folders; Dito Designer never deletes them itself." />
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
      body = <p className="forge-field-hint">The terminal window is not available in Dito Designer yet.</p>
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
            {(['experimental', 'official'] as const).map((id) => (
              <label key={id} className="forge-check">
                <input type="radio" name="engine" checked={engineChoice === id} onChange={() => setEngineChoice(id)} />
                <span>{ENGINE_LABELS[id]}</span>
              </label>
            ))}
            <p className="forge-field-hint">The Dito_Transpiler works without the ADITO Designer. The choice applies to this session only; every start begins with the Dito_Transpiler.</p>
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
          <p className="forge-field-hint">API keys are never stored by Dito Designer, and automatic translation is not available yet.</p>
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
          <Check label="Share anonymous usage statistics" checked={false} onChange={() => {}} disabled hint="Dito Designer never sends usage statistics." />
        </>
      )
    }
  } else {
    body = (
      <>
        <h3>{PAGES.ireport?.find((p) => p.id === subPage)?.label ?? 'iReport'}</h3>
        <p className="forge-field-hint">The report designer (iReport / JasperReports) is not part of Dito Designer yet, so these settings have no effect.</p>
      </>
    )
  }

  const pages = PAGES[category as Category]
  const RegisteredPage = registeredPages.find((p) => p.category === category)?.component
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
          {categories.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={category === c.id} className={`forge-opt-cat${category === c.id ? ' is-active' : ''}`} onClick={() => setCategory(c.id)}>
              <span className="forge-opt-glyph" aria-hidden="true">
                <OptionIcon id={c.id} />
              </span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        {pages ? (
          <div className="forge-opt-pages" role="tablist" aria-label={`${categories.find((c) => c.id === category)!.label} pages`}>
            {pages.map((p) => (
              <button key={p.id} type="button" role="tab" aria-selected={subPage === p.id} className={`forge-opt-page${subPage === p.id ? ' is-active' : ''}`} onClick={() => setPage((s) => ({ ...s, [category]: p.id }))}>
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="forge-opt-body" role="tabpanel">
          {RegisteredPage ? <RegisteredPage /> : body}
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

