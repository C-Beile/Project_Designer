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
import { TextAndSizePage } from './TextAndSizePage'
import { AppearanceGeneralPage } from './AppearanceGeneralPage'
import { CodeFormattingPage } from './CodeFormattingPage'
import { GeneralOptions } from './GeneralOptions'
import { configSet } from '../settings/appConfig'
import { isPluginActive } from '../settings/plugins'
import { errorText } from '../core/errorText'
import { SshKeyPassphrase } from './SshKeyPassphrase'
import { LoopbackSetup } from './LoopbackSetup'
import { useOptionsPages } from '../core/plugins/registry'
import { Button, Dropdown, Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '../core/ui/controls'

// Tools > Options (manual 4.8.3, screenshots 037/038): an icon bar with the categories General,
// Editor, Fonts & Colors, Keymap, Team, Appearance, Miscellaneous, ADITO and iReport; categories
// with several pages show them as tabs below. Dito-specific settings (Designer installation,
// transpiler) live on ADITO > General. Pages whose feature does not exist yet keep their
// controls visible but dimmed, with the reason.

type Category = 'general' | 'editor' | 'keymap' | 'appearance' | 'misc' | 'adito' | 'ireport'

const CATEGORIES: { id: string; label: string; order: number }[] = [
  { id: 'general', label: 'General', order: 10 },
  { id: 'editor', label: 'Editor', order: 20 },
  { id: 'keymap', label: 'Keymap', order: 40 },
  { id: 'appearance', label: 'Appearance', order: 30 },
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
  appearance: [
    { id: 'general', label: 'General' },
    { id: 'text', label: 'Text & size' },
    { id: 'code', label: 'Code formatting' },
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
        <Input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
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
  const [page, setPage] = useState<Record<string, string>>({ misc: 'csv', adito: 'general', ireport: 'general', editor: 'general', appearance: 'general' })
  const [opts, setOpts] = useState<DesignerOptions>(() => getOptions())
  const [prefs, setPrefs] = useState<EditorPrefs>(() => getEditorPrefs())
  const [engineChoice, setEngineChoice] = useState<TranspilerEngineId>(engine)
  const [themeChoice, setThemeChoice] = useState<ThemeName>(theme)
  const [installDir, setInstallDir] = useState('')
  const [sshKey, setSshKey] = useState('')
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
      : await api.pickFile('Install a VS Code colour theme', 'Theme (.json, .tmTheme, .vsix, .zip)', ['json', 'jsonc', 'tmtheme', 'plist', 'vsix', 'zip']).catch(() => null)
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
    api.getSettings().then((s) => { setInstallDir(s.designer_install_dir ?? ''); setSshKey(s.ssh_key_path ?? '') }).catch(() => {})
    api.detectDesignerInstall().then(setDetected).catch(() => setDetected(null))
  }, [api])

  const patch = <K extends keyof DesignerOptions>(group: K, values: Partial<DesignerOptions[K]>) => setOpts((o) => ({ ...o, [group]: { ...o[group], ...values } }))
  const subPage = page[category]

  async function browse() {
    const picked = await api.pickProjectFolder('Choose the ADITO Designer installation').catch(() => null)
    if (picked) setInstallDir(picked)
  }

  // Stores and applies every choice. The other windows see it through the shared storage (see useDialogWindows).
  async function commit(): Promise<boolean> {
    const value = installDir.trim() || null
    try {
      await api.setSettings({ ...(await api.getSettings()), designer_install_dir: value, ssh_key_path: sshKey.trim() || null })
      saveOptions(opts)
      for (const key of Object.keys(prefs) as (keyof EditorPrefs)[]) if (prefs[key] !== getEditorPrefs()[key]) setEditorPref(key, prefs[key])
      if (engineChoice !== engine) onEngineChange(engineChoice)
      if (themeChoice !== theme) onThemeChange(themeChoice)
      configSet(['appearance', 'theme'], themeChoice === 'lion' ? undefined : themeChoice)
      onSaved(value)
      setError(null)
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }

  async function save() {
    if (await commit()) onClose()
  }

  // Apply keeps the window open, so the result can be looked at and changed again.
  const [applied, setApplied] = useState(false)
  async function apply() {
    setApplied(await commit())
  }

  let body: ReactNode = null
  if (category === 'general') {
    body = <GeneralOptions api={api} opts={opts.general} onChange={(values) => patch('general', values)} />
  } else if (category === 'editor') {
    const ed = opts.editor
    const sub = page.editor
    const pick = (key: keyof DesignerOptions['editor']) => (v: string) => patch('editor', { [key]: v } as Partial<DesignerOptions['editor']>)
    const tog = (key: keyof DesignerOptions['editor']) => (v: boolean) => patch('editor', { [key]: v } as Partial<DesignerOptions['editor']>)
    body =
      sub === 'cursor' ? (
        <>
          <h3>Cursor &amp; Scrolling</h3>
          <Row label="Cursor blinking" hint="Smooth fades the cursor in and out instead of switching it on and off.">
            <Dropdown aria-label="Cursor blinking" value={ed.cursorBlinking} onChange={pick('cursorBlinking')} options={[{ id: 'smooth', label: 'Smooth' }, { id: 'blink', label: 'Blink' }, { id: 'phase', label: 'Phase' }, { id: 'expand', label: 'Expand' }, { id: 'solid', label: 'Solid (no blinking)' }]} />
          </Row>
          <Row label="Cursor style">
            <Dropdown aria-label="Cursor style" value={ed.cursorStyle} onChange={pick('cursorStyle')} options={[{ id: 'line', label: 'Line' }, { id: 'line-thin', label: 'Thin line' }, { id: 'block', label: 'Block' }, { id: 'block-outline', label: 'Block outline' }, { id: 'underline', label: 'Underline' }, { id: 'underline-thin', label: 'Thin underline' }]} />
          </Row>
          <Check label="Move the cursor smoothly (animated caret)" checked={ed.smoothCaret} onChange={tog('smoothCaret')} />
          <Check label="Scroll smoothly" checked={ed.smoothScrolling} onChange={tog('smoothScrolling')} />
          <Check label="Allow scrolling past the last line" checked={ed.scrollBeyondLastLine} onChange={tog('scrollBeyondLastLine')} />
          <Row label="Highlight the current line">
            <Dropdown aria-label="Line highlight" value={ed.lineHighlight} onChange={pick('lineHighlight')} options={[{ id: 'line', label: 'Line' }, { id: 'gutter', label: 'Line numbers' }, { id: 'all', label: 'Line and line numbers' }, { id: 'none', label: 'Off' }]} />
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
            <Input type="number" min={1} max={8} value={ed.tabSize} aria-label="Tab size" onChange={(e) => patch('editor', { tabSize: Math.max(1, Math.min(8, Number(e.target.value) || 2)) })} />
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
  } else if (category === 'keymap') {
    const needle = keyFilter.trim().toLowerCase()
    const rows = keymap.filter((k) => !needle || `${k.group} ${k.label} ${k.shortcut}`.toLowerCase().includes(needle))
    body = (
      <>
        <h3>Keymap</h3>
        <Input type="text" placeholder="Search…" aria-label="Search shortcuts" value={keyFilter} onChange={(e) => setKeyFilter(e.target.value)} />
        <div className="forge-opt-scroll">
          <Table className="forge-opt-table" aria-label="Shortcuts">
            <TableHeader>

                <TableColumn isRowHeader>Menu</TableColumn>
                <TableColumn>Action</TableColumn>
                <TableColumn>Shortcut</TableColumn>

            </TableHeader>
            <TableBody>
              {rows.map((k, i) => (
                <TableRow key={i}>
                  <TableCell>{k.group}</TableCell>
                  <TableCell>{k.label}</TableCell>
                  <TableCell>{formatShortcut(k.shortcut)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="forge-field-hint">The shortcuts follow the original Designer and cannot be reassigned yet.</p>
      </>
    )
  } else if (category === 'appearance') {
    const importOn = isPluginActive('vscode-themes')
    const activeCustom = importOn && themes.some((t) => t.id === opts.editor.colorTheme) ? opts.editor.colorTheme : ''
    const choose = (builtin: ThemeName | null, customId: string) => {
      if (builtin) setThemeChoice(builtin)
      patch('editor', { colorTheme: customId })
    }
    const sub = page.appearance
    body =
      sub === 'text' ? (
        <TextAndSizePage />
      ) : sub === 'code' ? (
        <CodeFormattingPage editor={opts.editor} onChange={(values) => patch('editor', values)} />
      ) : (
        <AppearanceGeneralPage
          selected={activeCustom || themeChoice}
          themes={importOn ? themes : []}
          canImport={importOn}
          onSelect={(id) => (themes.some((x) => x.id === id) ? choose(null, id) : choose(id as ThemeName, ''))}
          onRemove={(id) => {
            removeCustomTheme(id)
            if (id === opts.editor.colorTheme) patch('editor', { colorTheme: '' })
          }}
          onInstallFile={() => void importTheme()}
          onInstallFolder={() => void importTheme(true)}
          message={themeMessage}
        />
      )
  } else if (category === 'misc') {
    if (subPage === 'csv') {
      body = (
        <>
          <h3>CSV Editor</h3>
          <Row label="Separator of CSV exports">
            <Dropdown value={opts.misc.csvSeparator} aria-label="CSV separator" options={[{ id: ";", label: "Semicolon ( ; )" }, { id: ",", label: "Comma ( , )" }, { id: '\t', label: "Tab" }]} onChange={(v) => patch('misc', { csvSeparator: v as DesignerOptions['misc']['csvSeparator'] })} />
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
            <Input type="number" min={1} max={3650} value={opts.misc.janitorDays} aria-label="Removal threshold" onChange={(e) => patch('misc', { janitorDays: Math.max(1, Number(e.target.value) || 30) })} />
          </Row>
          <p className="forge-field-hint">The old Designer version folders and their disk usage are listed under Help &gt; Local Data.</p>
        </>
      )
    } else if (subPage === 'output') {
      body = (
        <>
          <h3>Output</h3>
          <Row label="Lines kept per output tab">
            <Input type="number" min={200} max={100000} step={100} value={opts.misc.outputMaxLines} aria-label="Lines kept" onChange={(e) => patch('misc', { outputMaxLines: Math.max(200, Number(e.target.value) || 5000) })} />
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
            <span>SSH key for tunnels</span>
            <span className="forge-field-row">
              <Input type="text" value={sshKey} aria-label="SSH key path" placeholder="No key chosen" onChange={(e) => setSshKey(e.target.value)} />
              <Button variant="bare"

                onClick={async () => {
                  const picked = await api.pickFile('Choose the SSH key', isMacPlatform() ? 'OpenSSH key' : 'PuTTY key', isMacPlatform() ? [] : ['ppk']).catch(() => null)
                  if (picked) setSshKey(picked)
                }}
              >
                Browse…
              </Button>
            </span>
          </label>
          <p className="forge-field-hint">Only the path is stored in the settings. PuTTY (.ppk) and OpenSSH keys work. Leave it empty to use the keys of Pageant or the ssh-agent.</p>
          <SshKeyPassphrase api={api} keyPath={sshKey} />
          <LoopbackSetup api={api} />
          <label className="forge-field">
            <span>ADITO Designer installation</span>
            <span className="forge-field-row">
              <Input type="text" value={installDir} placeholder={detected ? `Automatic: ${detected}` : 'Automatic detection'} onChange={(e) => setInstallDir(e.target.value)} />
              <Button variant="bare" onClick={browse}>
                Browse…
              </Button>
            </span>
          </label>
          <p className="forge-field-hint" data-testid="detected-install">
            {detected === undefined ? 'Searching for an installed ADITO Designer…' : detected ? `Found automatically: ${detected}` : 'No ADITO Designer installation found automatically.'}
          </p>
          {detected && installDir.trim() !== detected ? (
            <Button variant="bare" className="forge-link-btn" onClick={() => setInstallDir(detected)}>
              Use detected folder
            </Button>
          ) : null}
          <p className="forge-field-hint">Leave empty to use the automatically detected installation for each transpile.</p>
          <fieldset className="forge-opt-group">
            <legend>Transpiler</legend>
            {(['official', 'experimental'] as const).map((id) => (
              <label key={id} className="forge-check">
                <Input type="radio" name="engine" checked={engineChoice === id} onChange={() => setEngineChoice(id)} />
                <span>{ENGINE_LABELS[id]}</span>
              </label>
            ))}
            <p className="forge-field-hint">The ADITO transpiler is the default and uses the installed ADITO Designer. The Dito_Transpiler works without it. The choice applies to this session only; every start begins with the ADITO transpiler.</p>
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
            <Input type="text" aria-label="NodeJS path" value={opts.nodejs.path} onChange={(e) => patch('nodejs', { path: e.target.value })} />
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
            <Dropdown value={opts.translators.provider} aria-label="Translation service" options={[{ id: "none", label: "None" }, { id: "deepl", label: "DeepL" }, { id: "google", label: "Google" }, { id: "yandex", label: "Yandex" }]} onChange={(v) => patch('translators', { provider: v as DesignerOptions['translators']['provider'] })} />
          </Row>
          <Row label="API key">
            <Input type="password" disabled aria-label="API key" placeholder="not stored" />
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
            <Input type="number" min={1} value={opts.cloud.bufferSize} aria-label="Log buffer size" onChange={(e) => patch('cloud', { bufferSize: Math.max(1, Number(e.target.value) || 128) })} />
          </Row>
        </>
      )
    } else if (subPage === 'encoding') {
      body = (
        <>
          <h3>Encoding</h3>
          <Row label="Encoding" hint="Existing files keep their own encoding; new files are written as UTF-8.">
            <Dropdown value={opts.encoding.defaultEncoding} aria-label="Encoding" options={[{ id: "UTF-8", label: "UTF-8" }]} onChange={(v) => patch('encoding', { defaultEncoding: v })} />
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
          <Button variant="bare" className="is-primary" onClick={save}>
            OK
          </Button>
          <Button variant="bare" onClick={() => void apply()} title="Applies the changes and keeps this window open">
            Apply
          </Button>
          <Button variant="bare" onClick={onClose}>
            Cancel
          </Button>
          {applied ? <span className="forge-field-hint" role="status">Applied.</span> : null}
          <Button variant="bare" isDisabled title="No help pages yet">
            Help
          </Button>
        </>
      }
    >
      <div className="forge-options">
        <div className="forge-opt-cats" role="tablist" aria-label="Option categories">
          {categories.map((c) => (
            <Button variant="bare" key={c.id} role="tab" aria-selected={category === c.id} className={`forge-opt-cat${category === c.id ? ' is-active' : ''}`} onClick={() => setCategory(c.id)}>
              <span className="forge-opt-glyph" aria-hidden="true">
                <OptionIcon id={c.id} />
              </span>
              <span>{c.label}</span>
            </Button>
          ))}
        </div>
        {pages ? (
          <div className="forge-opt-pages" role="tablist" aria-label={`${categories.find((c) => c.id === category)!.label} pages`}>
            {pages.map((p) => (
              <Button variant="bare" key={p.id} role="tab" aria-selected={subPage === p.id} className={`forge-opt-page${subPage === p.id ? ' is-active' : ''}`} onClick={() => setPage((s) => ({ ...s, [category]: p.id }))}>
                {p.label}
              </Button>
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

