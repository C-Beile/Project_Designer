import { ErrorBoundary } from '../errorHandling'
import { useShellExtensions, type ShellExtensionContext } from './registry'

/** Rendert die Shell-Beiträge der Plugins (unsichtbar; sie halten Zustand und zeigen eingebettete Dialoge). */
export function ShellExtensions({ ctx }: { ctx: ShellExtensionContext }) {
  const extensions = useShellExtensions()
  return (
    <>
      {extensions.map((e) => (
        <ErrorBoundary key={e.id} compact label={`Plugin ${e.plugin ?? e.id}`}>
          <e.component {...ctx} />
        </ErrorBoundary>
      ))}
    </>
  )
}
