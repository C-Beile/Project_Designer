//! Conversion layer between `core-model`'s real project-model types and `plugin-kernel`'s
//! deliberately independent placeholder types (architecture.md §2,
//! `p3-plugin-kernel-notes.md` §2's mapping proposal). Lives here, in the facade, rather than in
//! either crate: neither `plugin-kernel` nor `core-model` is allowed to depend on the other
//! (both were built in parallel, isolated by design) - `forge-core` is the one place that
//! legitimately depends on both, so it is the correct home for the translation between them.

use core_model::command::FileCommand as CoreFileCommand;
use core_model::path::NodePath;
use core_model::transaction::Transaction as CoreTransaction;
use core_model::value::{PropertyValue as CorePropertyValue, ScalarValue as CoreScalarValue};
use plugin_kernel::types::{
    FileCommand as PluginFileCommand, ObjectType, PropertyNode, PropertyValue as PluginPropertyValue,
    Transaction as PluginTransaction,
};

/// A core-model scalar has no direct plugin-kernel counterpart for `Object`/`Array` values - the
/// placeholder `PropertyValue` in plugin-kernel is scalar-only (it models one `PropertyNode`'s
/// leaf value, not a subtree, per its own doc comment). Structural values map to `Missing`, the
/// placeholder's own "not a plain scalar" escape hatch.
pub fn to_plugin_value(value: &CorePropertyValue) -> PluginPropertyValue {
    match value {
        CorePropertyValue::Scalar(CoreScalarValue::Text(t)) => PluginPropertyValue::String(t.clone()),
        CorePropertyValue::Scalar(CoreScalarValue::Bool(b)) => PluginPropertyValue::Bool(*b),
        CorePropertyValue::Scalar(CoreScalarValue::Int(i)) => PluginPropertyValue::Int(*i),
        CorePropertyValue::Object(_) | CorePropertyValue::Array(_) => PluginPropertyValue::Missing,
    }
}

/// Builds a plugin-kernel `PropertyNode` for one addressable location in a project object - what
/// `EditorProvider::validate`/`Validator::validate` operate on (architecture.md §2). The caller
/// supplies `object_type` since core-model itself has no object-type concept (a flat
/// `PropertyTree` per file); `forge-core` is where a `.aod` file's object family is known (see
/// `p3-plugin-kernel-notes.md` §2, `ObjectType` row).
pub fn to_plugin_property_node(
    path: &NodePath,
    object_type: ObjectType,
    value: &CorePropertyValue,
) -> PropertyNode {
    PropertyNode::new(path.to_string(), object_type, to_plugin_value(value))
}

/// `core_model::FileCommand` -> `plugin_kernel::types::FileCommand`: same shape
/// (architecture.md §3), differing only in how `file` (`PathBuf` vs. `String`) and the byte
/// range (a named `ByteRange` struct vs. a bare `Range<usize>`) are spelled in each crate.
pub fn to_plugin_file_command(cmd: &CoreFileCommand) -> PluginFileCommand {
    PluginFileCommand {
        file: cmd.file.to_string_lossy().into_owned(),
        old_bytes_range: cmd.old_range.start..cmd.old_range.end,
        old_bytes: cmd.old_bytes.clone(),
        new_bytes: cmd.new_bytes.clone(),
    }
}

pub fn to_plugin_transaction(tx: &CoreTransaction) -> PluginTransaction {
    PluginTransaction::new(tx.commands.iter().map(to_plugin_file_command).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::command::ByteRange;
    use std::path::PathBuf;

    #[test]
    fn scalar_values_convert_to_their_plugin_kernel_counterparts() {
        assert_eq!(
            to_plugin_value(&CorePropertyValue::Scalar(CoreScalarValue::Text("Tour".into()))),
            PluginPropertyValue::String("Tour".into())
        );
        assert_eq!(
            to_plugin_value(&CorePropertyValue::Scalar(CoreScalarValue::Bool(true))),
            PluginPropertyValue::Bool(true)
        );
        assert_eq!(
            to_plugin_value(&CorePropertyValue::Scalar(CoreScalarValue::Int(7))),
            PluginPropertyValue::Int(7)
        );
        assert_eq!(to_plugin_value(&CorePropertyValue::Object(vec![])), PluginPropertyValue::Missing);
    }

    #[test]
    fn property_node_carries_the_dotted_path_and_caller_supplied_object_type() {
        let path = NodePath::root().field("title");
        let node = to_plugin_property_node(
            &path,
            ObjectType::Entity,
            &CorePropertyValue::Scalar(CoreScalarValue::Text("Tour".into())),
        );

        assert_eq!(node.path, "title");
        assert_eq!(node.object_type, ObjectType::Entity);
        assert_eq!(node.value, PluginPropertyValue::String("Tour".into()));
    }

    #[test]
    fn file_command_conversion_preserves_bytes_and_flattens_the_range_type() {
        let cmd = CoreFileCommand {
            file: PathBuf::from("role.aod"),
            old_range: ByteRange::new(19, 23),
            old_bytes: b"Tour".to_vec(),
            new_bytes: b"Round Trip".to_vec(),
        };

        let converted = to_plugin_file_command(&cmd);

        assert_eq!(converted.file, "role.aod");
        assert_eq!(converted.old_bytes_range, 19..23);
        assert_eq!(converted.old_bytes, b"Tour");
        assert_eq!(converted.new_bytes, b"Round Trip");
    }

    #[test]
    fn transaction_conversion_preserves_command_order() {
        let tx = CoreTransaction::new(
            "edit two fields",
            vec![
                CoreFileCommand {
                    file: PathBuf::from("a.aod"),
                    old_range: ByteRange::new(0, 1),
                    old_bytes: b"a".to_vec(),
                    new_bytes: b"A".to_vec(),
                },
                CoreFileCommand {
                    file: PathBuf::from("b.aod"),
                    old_range: ByteRange::new(5, 6),
                    old_bytes: b"b".to_vec(),
                    new_bytes: b"B".to_vec(),
                },
            ],
        );

        let converted = to_plugin_transaction(&tx);

        assert_eq!(converted.commands.len(), 2);
        assert_eq!(converted.commands[0].file, "a.aod");
        assert_eq!(converted.commands[1].file, "b.aod");
    }
}
