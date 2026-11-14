import type { AriaRole, CSSProperties, MouseEvent } from 'react'
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components'

/** `bare`: keine Control-Optik, nur die eigene `className` (für Knöpfe mit eigenem Stil, z. B. in Tabellen und Leisten). */
export type ButtonVariant = 'default' | 'primary' | 'quiet' | 'bare'

/** Diese Attribute reicht React Aria nicht selbst an das Element weiter; `render` setzt sie. */
interface PassThrough {
  title?: string
  role?: AriaRole
  tabIndex?: number
  'aria-selected'?: boolean | 'true' | 'false'
  'aria-checked'?: boolean | 'true' | 'false' | 'mixed'
  'aria-busy'?: boolean | 'true' | 'false'
  'aria-sort'?: 'none' | 'ascending' | 'descending' | 'other'
}

export interface ButtonProps extends Omit<AriaButtonProps, 'className' | 'style' | 'render' | 'onClick' | keyof PassThrough>, PassThrough {
  variant?: ButtonVariant
  className?: string
  style?: CSSProperties
  onClick?: (e: MouseEvent<HTMLElement>) => void
}

/**
 * Der Knopf. Klicks laufen wie bei `<button>` weiter nach oben (React Aria stoppt sie sonst),
 * `onClick` bekommt das Maus-Ereignis.
 */
export function Button({ variant = 'default', className, onClick, title, role, tabIndex, 'aria-selected': selected, 'aria-checked': checked, 'aria-busy': busy, 'aria-sort': sort, onPress, onPressStart, onPressEnd, onPressUp, ...props }: ButtonProps) {
  const base = variant === 'bare' ? '' : `ui-Button ui-Button--${variant}`
  const extra = { title, role, tabIndex, 'aria-selected': selected, 'aria-checked': checked, 'aria-busy': busy, 'aria-sort': sort }
  const defined = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined))
  return (
    <AriaButton
      {...props}
      onClick={onClick as AriaButtonProps['onClick']}
      className={[base, className].filter(Boolean).join(' ')}
      onPress={(e) => { e.continuePropagation(); onPress?.(e) }}
      onPressStart={(e) => { e.continuePropagation(); onPressStart?.(e) }}
      onPressEnd={(e) => { e.continuePropagation(); onPressEnd?.(e) }}
      onPressUp={(e) => { e.continuePropagation(); onPressUp?.(e) }}
      render={(dom) => <button {...dom} {...defined} />}
    />
  )
}
