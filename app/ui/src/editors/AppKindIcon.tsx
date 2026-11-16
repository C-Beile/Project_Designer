import { Icon } from '../core/icons/Icon'
import type { IconName } from '../core/icons/icons'

// Type icons of the application editor, in the colours of the Navigator filter: context yellow,
// dashboard violet, role tan (check circle), process green, report brown, entity pink. A broken
// entry is shown in the error colour.

export type AppIconKind = 'context' | 'dashboard' | 'role' | 'process' | 'report' | 'entity' | 'group' | 'test'

const COLOR: Record<AppIconKind, string> = {
  context: 'var(--folder-context, #e0b84a)',
  dashboard: 'var(--folder-dashboard, #8f7cf0)',
  role: 'var(--folder-role, #b8956a)',
  process: 'var(--folder-process, #7cc06b)',
  report: 'var(--folder-report, #a07858)',
  entity: 'var(--folder-entity, #e0679f)',
  group: 'var(--fg-muted, #8a8f98)',
  test: '#f2f2f2',
}

const NAME: Record<AppIconKind, IconName> = {
  context: 'stack',
  dashboard: 'squares-four',
  role: 'check-circle',
  process: 'file-code',
  report: 'chart-bar',
  entity: 'hexagon',
  group: 'folder',
  test: 'check-circle',
}

export function AppKindIcon({ kind, invalid = false }: { kind: AppIconKind; invalid?: boolean }) {
  return (
    <span className={`app-kind-icon app-kind-${kind}`} aria-hidden="true" data-kind={kind} style={{ display: 'inline-flex' }}>
      <Icon name={NAME[kind]} weight={kind === 'process' || kind === 'report' ? 'regular' : 'fill'} size="sm" color={invalid ? 'var(--error, #e5534b)' : COLOR[kind]} />
    </span>
  )
}
