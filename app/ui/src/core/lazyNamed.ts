import { createElement, lazy, type ComponentProps, type ComponentType } from 'react'

export type LazyNamed<C extends ComponentType<any>> = ComponentType<ComponentProps<C>> & { preload: () => Promise<C> }

/**
 * `React.lazy` für einen benannten Export: `lazyNamed(() => import('./Foo'), 'Foo')`. Der Code lädt erst, wenn die Komponente zum ersten Mal erscheint.
 * `preload()` lädt vorher. Ist der Code da, zeichnet die Komponente sofort, ohne Suspense: React würde sonst nach einem
 * gezeigten Ersatzbild noch bis zu 300 ms mit dem Inhalt warten.
 */
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K): LazyNamed<M[K]> {
  let loaded: M[K] | undefined
  let pending: Promise<M[K]> | undefined
  const preload = () => (pending ??= load().then((m) => (loaded = m[name])))
  const Lazy = lazy(async () => ({ default: await preload() }))
  const Component = (props: ComponentProps<M[K]>) => (loaded ? createElement(loaded, props) : createElement(Lazy, props))
  return Object.assign(Component, { preload }) as LazyNamed<M[K]>
}
