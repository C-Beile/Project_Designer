//! SSH-Tunnel über plink: `tunnel_core` (Bausteine), `tunnel_client` (Prozessstart, Host-Key-Flag),
//! `tunnels` (Verwaltung der offenen Weiterleitungen).

pub mod tunnel_client;
pub mod tunnel_config;
pub mod plugin;
pub mod tunnel_core;
pub mod tunnels;
pub use plugin::TunnelPlugin;
