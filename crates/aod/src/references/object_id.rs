//! Identity of an object that references or is referenced (architecture.md §7).
//!
//! An ADITO project object is addressed by its object type plus its ADITO object name (the
//! folder/name under `<module>/<type>/<name>/`, e.g. `entity/THHIT_Tour_entity/`) - the same
//! identity a rename operation renames. Linked files (`%aditoprj%/...`-relative paths, e.g. a
//! `valueProcess` script) are a distinct node kind: architecture.md §7 explicitly says they are
//! "Kanten zu Datei-Knoten, nicht zu `.aod`-Objekten", so they carry a path instead of a bare
//! object name and are never resolved through the alias-style short-name indirection.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ObjectKind {
    Entity,
    View,
    Alias,
    Webservice,
    Context,
    Dashboard,
    Language,
    System,
    Preferences,
    Application,
    Report,
    NotificationType,
    RendererDefinition,
    Process,
    ServiceDefinition,
    Role,
    /// A model family nothing is known about (no reference points to it).
    Other,
    /// A `%aditoprj%/...`-relative linked file (e.g. a `valueProcess` script), not an `.aod`
    /// object - see module doc comment.
    LinkedFile,
}

impl ObjectKind {
    /// The kind of the model family stored in the folder `object_type` (`entity`, `neonContext`, ...).
    pub fn from_object_type(object_type: &str) -> ObjectKind {
        match object_type {
            "entity" => ObjectKind::Entity,
            "neonView" => ObjectKind::View,
            "aliasDefinition" => ObjectKind::Alias,
            "entityWebservice" => ObjectKind::Webservice,
            "neonContext" => ObjectKind::Context,
            "neonDashboard" => ObjectKind::Dashboard,
            "language" => ObjectKind::Language,
            "system" => ObjectKind::System,
            "preferences" => ObjectKind::Preferences,
            "application" => ObjectKind::Application,
            "report" => ObjectKind::Report,
            "neonNotificationType" => ObjectKind::NotificationType,
            "rendererDefinition" => ObjectKind::RendererDefinition,
            "process" => ObjectKind::Process,
            "serviceDefinition" => ObjectKind::ServiceDefinition,
            "role" => ObjectKind::Role,
            _ => ObjectKind::Other,
        }
    }
}

impl fmt::Display for ObjectKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            ObjectKind::Entity => "entity",
            ObjectKind::View => "view",
            ObjectKind::Alias => "alias",
            ObjectKind::Webservice => "webservice",
            ObjectKind::Context => "context",
            ObjectKind::Dashboard => "dashboard",
            ObjectKind::Language => "language",
            ObjectKind::System => "system",
            ObjectKind::Preferences => "preferences",
            ObjectKind::Application => "application",
            ObjectKind::Report => "report",
            ObjectKind::NotificationType => "notificationType",
            ObjectKind::RendererDefinition => "rendererDefinition",
            ObjectKind::Process => "process",
            ObjectKind::ServiceDefinition => "serviceDefinition",
            ObjectKind::Role => "role",
            ObjectKind::Other => "other",
            ObjectKind::LinkedFile => "linkedFile",
        };
        write!(f, "{s}")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ObjectId {
    pub kind: ObjectKind,
    pub name: String,
}

impl ObjectId {
    pub fn new(kind: ObjectKind, name: impl Into<String>) -> Self {
        ObjectId { kind, name: name.into() }
    }

    pub fn entity(name: impl Into<String>) -> Self {
        ObjectId::new(ObjectKind::Entity, name)
    }

    pub fn view(name: impl Into<String>) -> Self {
        ObjectId::new(ObjectKind::View, name)
    }

    pub fn alias(name: impl Into<String>) -> Self {
        ObjectId::new(ObjectKind::Alias, name)
    }

    pub fn webservice(name: impl Into<String>) -> Self {
        ObjectId::new(ObjectKind::Webservice, name)
    }

    pub fn linked_file(path: impl Into<String>) -> Self {
        ObjectId::new(ObjectKind::LinkedFile, path)
    }
}

impl fmt::Display for ObjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.kind, self.name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_object_family_has_its_own_kind() {
        assert_eq!(ObjectKind::from_object_type("neonContext"), ObjectKind::Context);
        assert_eq!(ObjectKind::from_object_type("neonView"), ObjectKind::View);
        assert_eq!(ObjectKind::from_object_type("aliasDefinition"), ObjectKind::Alias);
        assert_eq!(ObjectKind::from_object_type("whatever"), ObjectKind::Other);
        assert_eq!(ObjectId::new(ObjectKind::Context, "A").to_string(), "context:A");
    }
}
