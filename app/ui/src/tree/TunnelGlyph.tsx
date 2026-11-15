import { Icon, type IconSize } from '../core/icons/Icon'

// Tunnel mark (a plug): the button that opens the tunnel manager of a system.
export function TunnelGlyph({ size = 'md' }: { size?: IconSize }) {
  return <Icon name="plugs-connected" size={size} />
}
