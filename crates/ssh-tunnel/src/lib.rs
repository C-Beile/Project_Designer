//! SSH-Tunnel in-process über russh: `tunnel_core` (Bausteine), `ssh_keys` (Schlüssel prüfen, Passphrase),
//! `ssh_session` (Anmeldung, Host-Keys), `tunnels` (Verwaltung der offenen Weiterleitungen).

pub mod loopback;
pub mod plugin;
pub mod shared_tunnels;
pub mod ssh_keys;
pub mod ssh_session;
pub mod tunnel_config;
pub mod tunnel_core;
pub mod tunnels;
pub use plugin::TunnelPlugin;
