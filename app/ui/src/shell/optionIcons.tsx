import { Icon } from '../core/icons/Icon'

// Icons of the Options categories (Phosphor, one drawing style). Colour comes from the surrounding text colour.

export function OptionIcon({ id }: { id: string }) {
  switch (id) {
    case 'general':
      return <Icon name="gear-six" size="lg" />
    case 'editor':
      return <Icon name="note-pencil" size="lg" />
    case 'fonts':
      return <Icon name="text-aa" size="lg" />
    case 'keymap':
      return <Icon name="keyboard" size="lg" />
    case 'team':
      return <Icon name="users" size="lg" />
    case 'appearance':
      return <Icon name="paint-brush" size="lg" />
    case 'misc':
      return <Icon name="squares-four" size="lg" />
    case 'adito':
      return <Icon name="mountains" size="lg" />
    case 'ireport':
      return <Icon name="chart-bar" size="lg" />
    default:
      return null
  }
}

export function PluginStateIcon({ state }: { state: 'active' | 'deactivated' | 'missing' }) {
  if (state === 'active') return <Icon name="check-circle" weight="fill" size="md" color="var(--success)" />
  if (state === 'deactivated') return <Icon name="pause-circle" weight="fill" size="md" color="var(--warning)" />
  return <Icon name="circle-dashed" size="md" color="muted" />
}
