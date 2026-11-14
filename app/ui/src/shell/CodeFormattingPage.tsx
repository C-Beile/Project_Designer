import type { DesignerOptions } from '../settings/options'
import { Button, Input } from '../core/ui/controls'

type EditorOptions = DesignerOptions['editor']

export interface CodeFormattingPageProps {
  editor: EditorOptions
  onChange: (values: Partial<EditorOptions>) => void
}

const DEFAULTS: Pick<EditorOptions, 'fontFamily' | 'fontSize' | 'lineHeight' | 'fontLigatures'> = { fontFamily: '', fontSize: 13, lineHeight: 0, fontLigatures: false }
const FONT_SUGGESTIONS = ['Consolas', 'Cascadia Code', 'Cascadia Mono', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Courier New']
const SAMPLE = `function total(items) {\n  const sum = items.filter((i) => i.active).length >= 0\n  if (sum != 0 && items[0] !== null) return "ok" // 0123456789\n}`

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Options > Appearance > Code formatting: Schrift und Zeilenabstand der Code-Editoren, mit Vorschau. */
export function CodeFormattingPage({ editor, onChange }: CodeFormattingPageProps) {
  const automaticLine = editor.lineHeight === 0
  const isDefault = (Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]).every((k) => editor[k] === DEFAULTS[k])
  return (
    <>
      <h3>Code formatting</h3>
      <p className="forge-field-hint">How code looks in every code editor. The preview shows your choice at once.</p>
      <pre
        className="forge-font-sample forge-font-code"
        aria-label="Code preview"
        style={{ fontFamily: editor.fontFamily || 'Consolas, monospace', fontSize: editor.fontSize, lineHeight: automaticLine ? undefined : `${editor.lineHeight}px`, fontVariantLigatures: editor.fontLigatures ? 'normal' : 'none' }}
      >
        {SAMPLE}
      </pre>

      <fieldset className="forge-opt-group">
        <legend>Font</legend>
        <div className="gen-zoom">
          <label htmlFor="code-font-family">Family</label>
          <Input id="code-font-family" list="code-font-suggestions" type="text" value={editor.fontFamily} placeholder="Consolas" onChange={(e) => onChange({ fontFamily: e.target.value })} />
          <datalist id="code-font-suggestions">
            {FONT_SUGGESTIONS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        <p className="forge-field-hint">Use the name of a font that is installed on this computer. An unknown name falls back to Consolas.</p>
        <div className="gen-zoom">
          <label htmlFor="code-font-size">Size</label>
          <Input id="code-font-size" type="range" min={9} max={28} step={1} value={editor.fontSize} onChange={(e) => onChange({ fontSize: clamp(Number(e.target.value) || 13, 9, 28) })} />
          <output>{editor.fontSize} px</output>
        </div>
        <label className="gen-switch">
          <Input type="checkbox" role="switch" checked={editor.fontLigatures} onChange={(e) => onChange({ fontLigatures: e.target.checked })} />
          <span className="gen-switch-text">
            <span>Font ligatures</span>
            <small>For fonts that have them, such as Fira Code or Cascadia Code: != becomes ≠.</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="forge-opt-group">
        <legend>Spacing</legend>
        <label className="gen-switch">
          <Input type="checkbox" role="switch" checked={automaticLine} onChange={(e) => onChange({ lineHeight: e.target.checked ? 0 : Math.round(editor.fontSize * 1.5) })} />
          <span className="gen-switch-text">
            <span>Line height from the font size</span>
            <small>Switch off to set the line height in pixels.</small>
          </span>
        </label>
        <div className="gen-zoom">
          <label htmlFor="code-line-height">Line height</label>
          <Input id="code-line-height" type="range" min={12} max={60} step={1} disabled={automaticLine} value={automaticLine ? Math.round(editor.fontSize * 1.5) : editor.lineHeight} onChange={(e) => onChange({ lineHeight: clamp(Number(e.target.value) || 0, 12, 60) })} />
          <output>{automaticLine ? 'auto' : `${editor.lineHeight} px`}</output>
        </div>
      </fieldset>

      <div className="forge-opt-buttons">
        <Button variant="bare" isDisabled={isDefault} onClick={() => onChange(DEFAULTS)}>
          Reset to defaults
        </Button>
      </div>
    </>
  )
}
