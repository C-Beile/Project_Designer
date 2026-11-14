import type { ReactNode } from 'react'
import { Checkbox as AriaCheckbox, type CheckboxProps as AriaCheckboxProps } from 'react-aria-components'

export interface CheckboxProps extends Omit<AriaCheckboxProps, 'className' | 'children'> {
  children: ReactNode
}

export function Checkbox({ children, ...props }: CheckboxProps) {
  return (
    <AriaCheckbox {...props} className="ui-Checkbox">
      <span className="ui-Checkbox-box" aria-hidden="true" />
      {children}
    </AriaCheckbox>
  )
}
