import type { Ref } from 'react'
import { TextArea as AriaTextArea, type TextAreaProps as AriaTextAreaProps } from 'react-aria-components'

/** Mehrzeiliges Eingabefeld ohne Label. */
export interface TextAreaProps extends AriaTextAreaProps {
  ref?: Ref<HTMLTextAreaElement>
}

export function TextArea({ className, ...props }: TextAreaProps) {
  return <AriaTextArea {...props} className={className as string | undefined} />
}
