import { Button, Label, ListBox, ListBoxItem, Popover, Select as AriaSelect, SelectValue, type SelectProps as AriaSelectProps } from 'react-aria-components'

export interface SelectOption {
  id: string
  label: string
}

export interface SelectProps extends Omit<AriaSelectProps<SelectOption>, 'className' | 'children' | 'items'> {
  label: string
  options: SelectOption[]
}

export function Select({ label, options, ...props }: SelectProps) {
  return (
    <AriaSelect {...props} className="ui-Select">
      <Label>{label}</Label>
      <Button className="ui-Select-trigger">
        <SelectValue />
        <span aria-hidden="true">▾</span>
      </Button>
      <Popover className="ui-Popover">
        <ListBox className="ui-ListBox">
          {options.map((o) => (
            <ListBoxItem key={o.id} id={o.id} textValue={o.label} className="ui-ListBoxItem">
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  )
}
