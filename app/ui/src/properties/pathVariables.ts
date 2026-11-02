// Path variables of a system's aditoHomePath / aditoDataPath (manual appendix C):
//   $PROJECTHOME  home directory of the project (usually `$PROJECTHOME/data` for aditoDataPath)
//   $ADITOHOME    the ADITO home directory; the Designer's home when the server runs inside it
//   $ADITODATA    the directory set in aditoDataPath; not allowed inside aditoDataPath itself

export const PATH_VARIABLE_PROPERTIES = ['aditoHomePath', 'aditoDataPath'] as const

export interface PathContext {
  projectHome?: string
  aditoHome?: string
  aditoData?: string
}

const VARIABLE = /\$(PROJECTHOME|ADITOHOME|ADITODATA)\b/g

export interface ResolvedPath {
  /** The value with every known variable replaced; unknown ones stay as written. */
  resolved: string
  /** Variables that could not be replaced because their value is not known here. */
  unresolved: string[]
  /** Problems with the use of the variables (e.g. $ADITODATA in aditoDataPath). */
  problems: string[]
}

function join(base: string, rest: string): string {
  return rest ? `${base.replace(/[\\/]+$/, '')}${rest}` : base
}

export function resolvePathVariables(property: string, value: string, ctx: PathContext): ResolvedPath {
  const unresolved: string[] = []
  const problems: string[] = []
  if (property === 'aditoDataPath' && /\$ADITODATA\b/.test(value)) problems.push('$ADITODATA refers to aditoDataPath itself and cannot be used inside it.')
  const resolved = value.replace(VARIABLE, (match, name: string) => {
    const known = name === 'PROJECTHOME' ? ctx.projectHome : name === 'ADITOHOME' ? ctx.aditoHome : ctx.aditoData
    if (!known) {
      if (!unresolved.includes(match)) unresolved.push(match)
      return match
    }
    return known.replace(/[\\/]+$/, '')
  })
  return { resolved: resolved === value && unresolved.length === 0 ? join(value, '') : resolved, unresolved, problems }
}
