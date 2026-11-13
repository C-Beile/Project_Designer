//! End-to-end proof of the rename cascade (architecture.md §7) across several simulated files:
//! `references::rename_cascade` must bundle one `FileCommand` per referencing file into a single
//! `Transaction`, and applying it must land the new name at the right byte offset in every file.

use std::collections::HashMap;

use aod::tree::testing::InMemoryEventSource;
use aod::tree::{ByteRange, NodePath, PropertyTree, PropertyValue, ScalarValue};
use aod::references::{read_references, rename_cascade, ObjectId, Reference};

fn text(s: &str) -> PropertyValue {
    PropertyValue::Scalar(ScalarValue::Text(s.to_string()))
}

fn obj(fields: Vec<(&str, PropertyValue)>) -> PropertyValue {
    PropertyValue::Object(fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// Builds a simulated `.aod` file: a raw buffer plus the registered byte span for `needle` at
/// `site`. The span is found programmatically (`windows().position()`), not hand-counted, so the
/// fixture can't drift from the actual buffer the way two earlier byte-offset bugs in this
/// workspace did.
fn simulated_file(file: &str, buffer: &[u8], site: NodePath, needle: &str) -> InMemoryEventSource {
    let idx = buffer
        .windows(needle.len())
        .position(|w| w == needle.as_bytes())
        .unwrap_or_else(|| panic!("fixture text {needle:?} must occur in the buffer for {file}"));
    let mut src = InMemoryEventSource::new(file, buffer.to_vec());
    src.register_value(site, ByteRange::new(idx, idx + needle.len()));
    src
}

#[test]
fn rename_cascade_bundles_patches_from_multiple_simulated_files_into_one_transaction() {
    let target = ObjectId::entity("THHIT_Tour_entity");

    // File 1: a view's neonContext references the entity by bare name.
    let site1 = NodePath::root().field("neonContext").field("entity");
    let root1 = obj(vec![("neonContext", obj(vec![("entity", text("THHIT_Tour_entity"))]))]);
    let src1 = simulated_file(
        "view1.aod",
        b"<neonContext><entity>THHIT_Tour_entity</entity></neonContext>",
        site1,
        "THHIT_Tour_entity",
    );

    // File 2: a different view's entityConsumer dependency on the same entity.
    let site2 = NodePath::root().field("entityConsumer").field("dependency").field("entityName");
    let root2 = obj(vec![(
        "entityConsumer",
        obj(vec![("dependency", obj(vec![("entityName", text("THHIT_Tour_entity")), ("fieldName", text("Title"))]))]),
    )]);
    let src2 = simulated_file(
        "view2.aod",
        b"<entityConsumer><dependency><entityName>THHIT_Tour_entity</entityName><fieldName>Title</fieldName></dependency></entityConsumer>",
        site2,
        "THHIT_Tour_entity",
    );

    // Kept aside, untouched, to verify the resulting FileCommands against a known-good buffer -
    // mirrors aod::tree's own undo_redo.rs pattern of a separate "apply target" buffer.
    let mut verify1 = src1.clone();
    let mut verify2 = src2.clone();

    let view1 = ObjectId::view("THHIT_TourFilter_view");
    let view2 = ObjectId::view("THHIT_TourDetail_view");

    let mut incoming: Vec<Reference> = Vec::new();
    incoming.extend(read_references(&view1, &root1, &|_| None));
    incoming.extend(read_references(&view2, &root2, &|_| None));
    incoming.retain(|r| r.to == target);
    assert_eq!(incoming.len(), 2, "both files must be read as referencing the entity");

    let mut trees = HashMap::new();
    trees.insert(view1.clone(), PropertyTree::from_value(src1, root1));
    trees.insert(view2.clone(), PropertyTree::from_value(src2, root2));

    let tx = rename_cascade(&incoming, &target, "THHIT_Fahrt_entity", &mut trees)
        .expect("both incoming edges have a tree supplied, cascade must succeed");

    assert_eq!(tx.commands.len(), 2, "one FileCommand per referencing file, bundled atomically");
    assert_eq!(tx.label, "Rename entity:THHIT_Tour_entity to THHIT_Fahrt_entity");

    for cmd in &tx.commands {
        assert_eq!(cmd.old_bytes, b"THHIT_Tour_entity");
        assert_eq!(cmd.new_bytes, b"THHIT_Fahrt_entity");
        if cmd.file.ends_with("view1.aod") {
            verify1.apply(cmd);
        } else if cmd.file.ends_with("view2.aod") {
            verify2.apply(cmd);
        } else {
            panic!("unexpected file in cascade command: {:?}", cmd.file);
        }
    }

    assert_eq!(verify1.buffer(), b"<neonContext><entity>THHIT_Fahrt_entity</entity></neonContext>");
    assert_eq!(
        verify2.buffer(),
        b"<entityConsumer><dependency><entityName>THHIT_Fahrt_entity</entityName><fieldName>Title</fieldName></dependency></entityConsumer>"
    );

    // Undo must revert both files together, atomically, in one step (architecture.md §3).
    let inverse = tx.inverse();
    for cmd in &inverse.commands {
        if cmd.file.ends_with("view1.aod") {
            verify1.apply(cmd);
        } else {
            verify2.apply(cmd);
        }
    }
    assert_eq!(verify1.buffer(), b"<neonContext><entity>THHIT_Tour_entity</entity></neonContext>");
    assert_eq!(
        verify2.buffer(),
        b"<entityConsumer><dependency><entityName>THHIT_Tour_entity</entityName><fieldName>Title</fieldName></dependency></entityConsumer>"
    );
}

#[test]
fn rename_cascade_currently_skips_value_process_linked_file_edges() {
    // Linked-file references (architecture.md §7's last bullet) hold a full `%aditoprj%/...`
    // path, not a bare object name - the plain "replace the whole site with new_name" a rename
    // cascade does for every other edge kind would corrupt the path rather than rename it inside
    // it. Full linked-file path rewriting is out of this round's scope (documented as a TODO in
    // p3-core-model-notes.md), so these edges are skipped rather than mis-patched. Proven here by
    // an *empty* `trees` map: if the skip were ever removed, this would fail with `MissingTree`
    // instead of silently passing.
    let linked_file = ObjectId::linked_file("%aditoprj%/entity/THHIT_Tour_entity/process/countryValueProcess.js");
    let entity = ObjectId::entity("THHIT_Tour_entity");
    let root = obj(vec![(
        "entityFields",
        obj(vec![(
            "entityField",
            PropertyValue::Array(vec![obj(vec![
                ("name", text("COUNTRY")),
                ("valueProcess", text("%aditoprj%/entity/THHIT_Tour_entity/process/countryValueProcess.js")),
            ])]),
        )]),
    )]);

    let incoming: Vec<Reference> = read_references(&entity, &root, &|_| None).into_iter().filter(|r| r.to == linked_file).collect();
    assert_eq!(incoming.len(), 1, "the valueProcess field must be read as a reference to the linked file");

    let mut trees: HashMap<ObjectId, PropertyTree<InMemoryEventSource>> = HashMap::new();
    let tx = rename_cascade(&incoming, &linked_file, "countryValueProcess2.js", &mut trees)
        .expect("no tree lookup happens because the only incoming edge is skipped");

    assert!(tx.commands.is_empty(), "ValueProcessLinkedFile edges are not yet rewritten by this cascade");
}
