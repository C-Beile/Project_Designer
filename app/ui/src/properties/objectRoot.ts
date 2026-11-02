// `%aditoprj%` of an object file `<root>/<typeFolder>/<Name>/<Name>.aod`: the project folder for
// project objects and the package folder (`node_modules/@scope/package`) for module objects. Every
// linked file (process.js, valueProcess.js, ...) is resolved against this folder, in the same way as
// `object_project_root` in the backend. Both path separators occur in node ids on Windows.
export function objectRoot(id: string): string {
  const parts = id.split(/[\\/]/)
  return parts.slice(0, Math.max(0, parts.length - 3)).join('/')
}

// Absolute path of a linked file for the object file `id` and a `%aditoprj%/...` reference.
export function linkedFilePathOf(id: string, reference: string): string {
  return `${objectRoot(id)}/${reference.replace(/^%aditoprj%\//, '')}`
}
