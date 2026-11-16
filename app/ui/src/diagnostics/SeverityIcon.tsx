import { ConfiguredIcon, Icon, type IconSize } from '../core/icons/Icon'

// Severity as a shape, not only a colour: cross in a circle = error, triangle with an
// exclamation mark = warning, circle with an "i" = information.

export function SeverityIcon({ severity, size = 'md' }: { severity: 'Error' | 'Warning' | 'Info'; size?: IconSize }) {
  if (severity === 'Error') return <Icon name="x-circle" weight="fill" size={size} color="var(--error)" />
  if (severity === 'Warning') return <Icon name="warning" weight="fill" size={size} color="var(--warning)" />
  return <Icon name="info" weight="fill" size={size} color="var(--accent)" />
}

export function Chevron({ open }: { open: boolean }) {
  return <ConfiguredIcon id="chevron" area="control" fallback={open ? 'caret-down' : 'caret-right'} size="sm" className="forge-chevron" />
}
