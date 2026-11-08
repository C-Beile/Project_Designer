// Windows Credential Manager access for DB login credentials (architecture.md §8). `target` is
// an opaque caller-chosen key (e.g. "forge/db/<alias>") - this trait does not impose a naming
// scheme, that belongs to `db-layer`/`designer-core`.

use crate::error::PlatformError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Credential {
    pub username: String,
    pub secret: String,
}

pub trait CredentialStore: Send + Sync {
    fn get(&self, target: &str) -> Result<Option<Credential>, PlatformError>;
    fn set(&self, target: &str, credential: &Credential) -> Result<(), PlatformError>;
    fn delete(&self, target: &str) -> Result<(), PlatformError>;
}
