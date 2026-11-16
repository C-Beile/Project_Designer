// Ausgabeformate. Der Kern kennt sie nicht, er bekommt nur die `FormatId`.
// V1 (DISTRIBUTED, CRLF) kann später als `v1.rs` dazukommen, hinter einem Cargo-Feature.

pub mod v2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FormatId {
    V2,
}
