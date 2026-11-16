import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { confirmDialog } from '../core/dialogService'
import { Button, Tabs } from '../core/ui/controls'
import { ColorsTab } from '../core/ui/gallery/ColorsTab'
import { ControlsTab } from '../core/ui/gallery/ControlsTab'
import { ElementsTab } from '../core/ui/gallery/ElementsTab'
import { IconsTab } from '../core/ui/gallery/IconsTab'
import { ScalesTab } from '../core/ui/gallery/ScalesTab'
import { previewTomlTheme, restoreTheme, snapshotTheme, type ThemeSnapshot } from '../core/ui/gallery/themePreview'
import { BUILTIN_THEME_TEXTS } from '../theme/builtinThemes'
import { customThemes, subscribeCustomThemes } from '../theme/customThemes'
import { getUserThemes, subscribeThemes } from '../theme/themeStore'
import { IMPORTED_PREFIX, importedThemeToToml } from './importedTheme'
import { parseTheme, type ParsedTheme } from '../theme/themeToml'
import { THEME_LABELS } from '../theme/useTheme'
import { ColorEditor } from './ColorEditor'
import { StudioDiagnostics } from './StudioDiagnostics'
import { StudioToolbar } from './StudioToolbar'
import { fieldsFor, type FieldKind } from './studioFields'
import { setKeyInText } from './themeText'
import { createThemeActions, currentSourceId, TEMPLATE_ID, USER_PREFIX, type StudioApi, type StudioSource } from './useThemeActions'

// Monaco ist schwer: erst laden, wenn der Tab Code gebraucht wird.
const CodePreview = lazy(() => import('./CodePreview').then((m) => ({ default: m.CodePreview })))

function useSources(): StudioSource[] {
  const users = useSyncExternalStore(subscribeThemes, getUserThemes)
  const imported = useSyncExternalStore(subscribeCustomThemes, customThemes)
  return useMemo(
    () => [
      ...Object.entries(BUILTIN_THEME_TEXTS).map(([id, text]) => ({ id, label: THEME_LABELS[id as 'lion'] ?? id, kind: 'builtin' as const, text })),
      ...users.map((u) => ({ id: USER_PREFIX + u.file, label: `${u.parsed?.meta.name ?? u.file} (yours)`, kind: 'user' as const, text: u.text })),
      ...imported.map((t) => ({ id: IMPORTED_PREFIX + t.id, label: `${t.name} (VS Code)`, kind: 'imported' as const, text: importedThemeToToml(t) })),
    ],
    [users, imported],
  )
}

function tryParse(text: string): { parsed: ParsedTheme | null; error: string | null } {
  try {
    return { parsed: parseTheme(text), error: null }
  } catch (e) {
    return { parsed: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface ThemeStudioProps {
  api: StudioApi
  onClose: () => void
  inWindow?: boolean
}

export function ThemeStudio({ api, onClose, inWindow = false }: ThemeStudioProps) {
  const sources = useSources()
  const [selectedId, setSelectedId] = useState(() => (sources.some((s) => s.id === currentSourceId()) ? currentSourceId() : TEMPLATE_ID))
  const source = sources.find((s) => s.id === selectedId) ?? sources[0]
  const [text, setText] = useState(source.text)
  const [saved, setSaved] = useState(source.text)
  const [version, setVersion] = useState(0)
  const [fieldKind, setFieldKind] = useState<FieldKind>('interface')
  const [previewTab, setPreviewTab] = useState('colors')
  const snapshot = useRef<ThemeSnapshot | null>(null)
  if (snapshot.current === null) snapshot.current = snapshotTheme()
  useEffect(() => () => restoreTheme(snapshot.current!), [])

  const { parsed, error } = useMemo(() => tryParse(text), [text])
  const fields = fieldsFor(fieldKind, parsed)
  const dirty = text !== saved

  useEffect(() => {
    if (parsed) previewTomlTheme(parsed)
    setVersion((v) => v + 1)
  }, [parsed])

  const load = (id: string, next: string) => {
    setSelectedId(id)
    setText(next)
    setSaved(next)
  }
  const actions = createThemeActions({ api, source, text, parsed, dirty, load, markSaved: setSaved, refresh: () => setVersion((v) => v + 1) })

  function chooseKind(kind: FieldKind) {
    setFieldKind(kind)
    setPreviewTab(kind === 'code' ? 'code' : 'colors')
  }

  async function select(id: string) {
    if (id === selectedId) return
    if (dirty && !(await confirmDialog('Discard the changes of this theme?', { okLabel: 'Discard', title: 'Theme Studio' }))) return
    const next = sources.find((s) => s.id === id)
    if (next) load(id, next.text)
  }

  return (
    <div className={inWindow ? 'ui-Studio ui-Studio--window' : 'ui-Studio ui-Gallery'} role="dialog" aria-label="Theme Studio">
      <StudioToolbar sources={sources} source={source} dirty={dirty} hasError={!!error} actions={actions} onSelect={(id) => void select(id)} onClose={onClose} />
      <div className="ui-Studio-body">
        <section className="ui-Studio-editor" aria-label="Editor">
          <div className="ui-Studio-switch" role="group" aria-label="Editor view">
            <Button variant={fieldKind === 'interface' ? 'primary' : 'quiet'} onPress={() => chooseKind('interface')}>
              Interface
            </Button>
            <Button variant={fieldKind === 'code' ? 'primary' : 'quiet'} onPress={() => chooseKind('code')}>
              Code
            </Button>
          </div>
          <StudioDiagnostics parsed={parsed} error={error} />
          <ColorEditor fields={fields} readOnly={!!error} onChange={(key, value) => setText((t) => setKeyInText(t, key, value))} />
        </section>
        <section className="ui-Studio-preview" aria-label="Preview">
          <PreviewTabs version={version} selected={previewTab} onSelect={setPreviewTab} />
        </section>
      </div>
    </div>
  )
}

function PreviewTabs({ version, selected, onSelect }: { version: number; selected: string; onSelect: (id: string) => void }) {
  return (
    <Tabs
      ariaLabel="Element groups"
      selectedKey={selected}
      onSelectionChange={(key) => onSelect(String(key))}
      tabs={[
        { id: 'colors', label: 'Colours', content: <ColorsTab version={version} /> },
        { id: 'scales', label: 'Scales', content: <ScalesTab version={version} /> },
        { id: 'controls', label: 'Controls', content: <ControlsTab /> },
        { id: 'elements', label: 'Elements', content: <ElementsTab /> },
        { id: 'icons', label: 'Icons', content: <IconsTab /> },
        { id: 'code', label: 'Code', content: (
            <Suspense fallback={<p className="ui-Gallery-empty">Loading the code editors…</p>}>
              <CodePreview />
            </Suspense>
          ),
        },
      ]}
    />
  )
}
