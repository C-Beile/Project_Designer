import type { Ref } from 'react'
import { Input as AriaInput, type InputProps as AriaInputProps } from 'react-aria-components'

/** Ein Eingabefeld ohne Label (für Tabellenzellen, Zeilen, Filter). Mit Label und Hinweis: `TextField`. */
export interface InputProps extends AriaInputProps {
  ref?: Ref<HTMLInputElement>
}

export function Input({ className, ...props }: InputProps) {
  return <AriaInput {...props} className={className as string | undefined} />
}
