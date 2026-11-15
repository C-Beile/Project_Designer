import { Icon, type IconSize } from '../core/icons/Icon'
import type { IconName } from '../core/icons/icons'

// Icons of the alias config list (original Designer: gear for the instance configuration, disc stack
// for databases, server rack for mail/cluster/workflow, envelope for repositories, calendar for
// Exchange, key for authentication, globe for index search, document otherwise).

const NAMES: Record<string, IconName> = {
  gear: 'gear-six',
  database: 'database',
  server: 'hard-drives',
  mail: 'envelope',
  calendar: 'calendar-blank',
  key: 'key',
  globe: 'globe',
  file: 'file-text',
}

export function AliasIcon({ icon, size = 'lg' }: { icon: string; size?: IconSize }) {
  return <Icon name={NAMES[icon] ?? 'file-text'} size={size} className={`alias-icon alias-icon-${icon}`} />
}
