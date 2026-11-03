// Small tunnel mark (an arch with a floor): the button that opens the tunnel manager of a system.
export function TunnelGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 11V8a6 6 0 0 1 12 0v3" />
      <path d="M5 11V8a3 3 0 0 1 6 0v3" />
      <path d="M1.5 11h13" />
    </svg>
  )
}
