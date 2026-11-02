// Business background: two engines can produce a project's `dist` output -
// - "official": the real ADITO TranspilerCLI (nbexec64.exe). Production-grade, always correct.
// - "experimental": Forge's own from-scratch Rust engine. Real and runnable, but its own
//   differential-harness measurements against a full real project report a 57.25% byte-exact
//   match rate against the official output - well short of the zero-deviation bar required
//   before it could ever become the default. It exists strictly as an opt-in choice.
//
// The choice is deliberately never persisted (no localStorage, no backend setting): every app
// start is back on "official", so nobody transpiles with the experimental engine without
// consciously choosing it in the current session.
export type TranspilerEngineId = 'official' | 'experimental'

export const DEFAULT_ENGINE: TranspilerEngineId = 'official'

export const ENGINE_LABELS: Record<TranspilerEngineId, string> = {
  official: 'Official ADITO transpiler',
  experimental: 'Experimental Forge engine',
}

export const EXPERIMENTAL_WARNING =
  'Experimental: the own Forge transpiler engine does not yet guarantee a byte-exact match with ' +
  'the official ADITO transpiler. The last measured match rate against a real project was ' +
  '57.25% (not 100%). Use the official transpiler for any production deployment; pick this engine ' +
  'only to inspect or exercise the own engine itself.'

export type TranspileMode = 'partial' | 'full'

/**
 * Parameters for the generic "transpile" action. A Designer installation chosen in
 * Tools > Options is handed on; without one the backend discovers it itself.
 */
export function transpileParams(
  engine: TranspilerEngineId,
  mode: TranspileMode,
  installDir: string | null,
): Record<string, string> {
  const params: Record<string, string> = { engine, mode }
  if (installDir && installDir.trim()) params.install_dir = installDir.trim()
  return params
}
