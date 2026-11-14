import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/** `React.lazy` für einen benannten Export: `lazyNamed(() => import('./Foo'), 'Foo')`. Der Code lädt erst, wenn die Komponente zum ersten Mal erscheint. */
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K): LazyExoticComponent<M[K]> {
  return lazy(async () => ({ default: (await load())[name] }))
}
