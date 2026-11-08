import { useShellExtensions, type ShellExtensionContext } from './registry'

/** Rendert die Shell-Beiträge der Plugins (unsichtbar; sie halten Zustand und zeigen eingebettete Dialoge). */
export function ShellExtensions({ ctx }: { ctx: ShellExtensionContext }) {
  const extensions = useShellExtensions()
  return (
    <>
      {extensions.map((e) => (
        <e.component key={e.id} {...ctx} />
      ))}
    </>
  )
}
