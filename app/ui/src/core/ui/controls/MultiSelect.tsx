import type { ReactNode } from 'react'
import { Button, DialogTrigger, ListBox, ListBoxItem, Popover } from 'react-aria-components'
import { CaretDown } from '../../icons/Icon'

export interface MultiSelectOption {
  id: string
  label: string
  /** Symbol vor dem Text, z. B. das Typ-Icon in Typfarbe. */
  icon?: ReactNode
}

export interface MultiSelectProps {
  'aria-label': string
  options: MultiSelectOption[]
  /** Die gewählten Ids. */
  value: string[]
  onChange: (value: string[]) => void
  /** Text im Knopf, z. B. "Alle Typen" oder "3 von 6". */
  summary: string
  /** Knopf hervorheben (Filter aktiv). */
  active?: boolean
  className?: string
}

/** Auswahlliste mit Mehrfachauswahl. Der Knopf hat dieselbe Höhe wie `Input` (`--control-h`). Unten "All" und "None". */
export function MultiSelect({ options, value, onChange, summary, active, className, 'aria-label': ariaLabel }: MultiSelectProps) {
  return (
    <DialogTrigger>
      <Button className={['ui-Select-trigger', 'ui-MultiSelect-trigger', active ? 'is-active' : '', className].filter(Boolean).join(' ')} aria-label={ariaLabel}>
        <span>{summary}</span>
        <CaretDown />
      </Button>
      <Popover className="ui-Popover ui-MultiSelect-popover" placement="bottom end">
        <ListBox
          className="ui-ListBox"
          aria-label={ariaLabel}
          selectionMode="multiple"
          selectedKeys={new Set(value)}
          onSelectionChange={(keys) => onChange(keys === 'all' ? options.map((o) => o.id) : [...keys].map(String))}
        >
          {options.map((o) => (
            <ListBoxItem key={o.id} id={o.id} textValue={o.label} className="ui-ListBoxItem ui-MultiSelect-item">
              <span className="ui-MultiSelect-check" aria-hidden="true" />
              {o.icon}
              <span>{o.label}</span>
            </ListBoxItem>
          ))}
        </ListBox>
        <div className="ui-MultiSelect-actions">
          <Button className="ui-Button ui-Button--quiet" onPress={() => onChange(options.map((o) => o.id))}>
            All
          </Button>
          <Button className="ui-Button ui-Button--quiet" onPress={() => onChange([])}>
            None
          </Button>
        </div>
      </Popover>
    </DialogTrigger>
  )
}
