// Type icons of the application editor, in the colours of the Navigator filter: context yellow,
// dashboard violet, role tan (check circle), process green, report brown, entity pink. A broken
// entry gets a red outline.

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

export function AppKindIcon({ kind, invalid = false }: { kind: AppIconKind; invalid?: boolean }) {
  const fill = COLOR[kind]
  const stroke = invalid ? 'var(--error, #e5534b)' : 'none'
  return (
    <svg className={`app-kind-icon app-kind-${kind}`} width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" data-kind={kind}>
      {kind === 'role' || kind === 'test' ? (
        <>
          <circle cx="7" cy="7" r="6" fill={fill} stroke={stroke} />
          <path d="M4 7.2l2 2 4-4.4" fill="none" stroke="var(--bg, #1e1f22)" strokeWidth="1.6" />
        </>
      ) : kind === 'process' || kind === 'report' ? (
        <>
          <path d="M3 1h5.5L11 3.5V13H3z" fill="none" stroke={fill} strokeWidth="1.4" />
          <path d="M8 1v3h3" fill="none" stroke={fill} strokeWidth="1.2" />
          {invalid ? <rect x="1.5" y="0.5" width="11" height="13" fill="none" stroke={stroke} /> : null}
        </>
      ) : kind === 'dashboard' ? (
        <>
          <rect x="1" y="1" width="5" height="5" fill={fill} stroke={stroke} />
          <rect x="8" y="1" width="5" height="5" fill={fill} />
          <rect x="1" y="8" width="5" height="5" fill={fill} />
          <rect x="8" y="8" width="5" height="5" fill={fill} />
        </>
      ) : kind === 'entity' ? (
        <path d="M7 1l5.5 3v6L7 13 1.5 10V4z" fill={fill} stroke={stroke} />
      ) : kind === 'group' ? (
        <path d="M1 3.5h4l1 1h7v7.5H1z" fill={fill} stroke={stroke} />
      ) : (
        <rect x="1.5" y="1.5" width="11" height="11" rx="2" fill={fill} stroke={stroke} />
      )}
    </svg>
  )
}
