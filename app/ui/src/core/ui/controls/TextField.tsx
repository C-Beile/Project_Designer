import { FieldError, Input, Label, Text, TextField as AriaTextField, type TextFieldProps as AriaTextFieldProps } from 'react-aria-components'

export interface TextFieldProps extends Omit<AriaTextFieldProps, 'className'> {
  label: string
  description?: string
  errorMessage?: string
  placeholder?: string
}

export function TextField({ label, description, errorMessage, placeholder, ...props }: TextFieldProps) {
  return (
    <AriaTextField {...props} className="ui-TextField">
      <Label>{label}</Label>
      <Input className="ui-Input" placeholder={placeholder} />
      {description ? <Text slot="description">{description}</Text> : null}
      <FieldError>{errorMessage}</FieldError>
    </AriaTextField>
  )
}
