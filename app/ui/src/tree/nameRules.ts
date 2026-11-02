// Name rules of the original name dialog (DESIGNER_BEHAVIOR_SPEC.md 4.1), the stages that need no file access.
// The backend repeats them and adds the stages that look at the project (reserved names, existing names).

export const MSG_EMPTY = 'String is empty.'
export const MSG_SYSTEM_NAME = 'Name is part of systemname.'
export const MSG_EXISTS = 'Name already exists in this project or model.'
export const SYSTEM_PREFIX = '_____'
export const ROLE_PREFIX = 'PROJECT_'

export const msgOnlyValidFor = (type: string) => `Name is only valid for type ${type}.`
export const msgMustStartWith = (prefix: string) => `Must start with ${prefix}`

/** Stage 5: the syntax of a component name. */
export function syntaxError(name: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || name.length > 100) return "The name may only contain letters, digits, '_' and '-'."
  if (/^[0-9]/.test(name)) return 'The name must not start with a digit.'
  return null
}

/**
 * Stages 1, 2, 5 and 6 in the order of the original: empty, system name, syntax, rule of the type.
 * Stages 3 and 4 (reserved for another type, already existing) are answered by the backend.
 */
export function localNameError(name: string, folder: string | null): string | null {
  if (name.trim() === '') return MSG_EMPTY
  if (name.startsWith(SYSTEM_PREFIX) || name.includes('#')) return MSG_SYSTEM_NAME
  const syntax = syntaxError(name)
  if (syntax) return syntax
  if (folder === 'role' && !name.startsWith(ROLE_PREFIX)) return msgMustStartWith(ROLE_PREFIX)
  return null
}
