import type { CSSProperties } from 'react'
import { CaretDown } from '../../icons/Icon'
import { Button, ListBox, ListBoxItem, Popover, Select as AriaSelect, SelectValue } from 'react-aria-components'

export interface DropdownOption {
  id: string
  label: string
}

export interface DropdownProps {
  /** Beschriftung für Screenreader (es gibt kein sichtbares Label; mit Label: `Select`). */
  'aria-label': string
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  isDisabled?: boolean
  title?: string
  className?: string
  style?: CSSProperties
  placeholder?: string
  /** Zustand für das Styling, z. B. `data-engine`. */
  [data: `data-${string}`]: string | undefined
}

// React Aria kennt keinen leeren Schlüssel; der leere Wert (z. B. "keine Auswahl") bekommt einen eigenen.
const EMPTY = '\u0000empty'
const toKey = (v: string) => (v === '' ? EMPTY : v)

/** Einfache Auswahlliste für Zeilen und Leisten (der Ersatz für `<select>`): Wert und Optionen als Text. */
export function Dropdown({ options, value, onChange, isDisabled, title, className, style, placeholder, 'aria-label': ariaLabel, ...data }: DropdownProps) {
  return (
    <AriaSelect
      {...data}
      aria-label={ariaLabel}
      selectedKey={options.some((o) => o.id === value) ? toKey(value) : null}
      onSelectionChange={(k) => onChange(k === EMPTY ? '' : String(k))}
      isDisabled={isDisabled}
      placeholder={placeholder ?? ''}
      className={['ui-Dropdown', className].filter(Boolean).join(' ')}
      style={style}
    >
      <Button className="ui-Select-trigger ui-Dropdown-trigger" render={(dom) => <button {...dom} title={title} data-value={value} data-label={ariaLabel} />}>
        <SelectValue />
        <CaretDown />
      </Button>
      <Popover className="ui-Popover">
        <ListBox className="ui-ListBox">
          {options.map((o) => (
            <ListBoxItem key={o.id} id={toKey(o.id)} data-value={o.id} textValue={o.label || ' '} className="ui-ListBoxItem">
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  )
}
