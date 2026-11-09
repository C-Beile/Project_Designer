//! End-to-end proof of the undo/redo contract: a `Transaction` bundling several `FileCommand`s
//! is atomically reversible and re-applicable, byte-for-byte, against a simulated document
//! buffer - the property architecture.md §3 and ADR-0005 point 2 are built around.

use aod::tree::testing::InMemoryEventSource;
use aod::tree::{NodePath, PropertyTree, PropertyValue, ScalarValue, Transaction, UndoStack};

fn two_field_source() -> InMemoryEventSource {
    // <root><a>alpha</a><b>beta</b></root>
    let mut src = InMemoryEventSource::new("two.aod", b"<root><a>alpha</a><b>beta</b></root>".to_vec());
    src.register_value(NodePath::root().field("a"), aod::tree::ByteRange::new(9, 14));
    src.register_value(NodePath::root().field("b"), aod::tree::ByteRange::new(21, 25));
    src
}

fn two_field_tree() -> PropertyTree<InMemoryEventSource> {
    let value = PropertyValue::Object(vec![
        ("a".to_string(), PropertyValue::Scalar(ScalarValue::Text("alpha".to_string()))),
        ("b".to_string(), PropertyValue::Scalar(ScalarValue::Text("beta".to_string()))),
    ]);
    PropertyTree::from_value(two_field_source(), value)
}

#[test]
fn single_command_undo_restores_original_bytes() {
    let mut tree = two_field_tree();
    let a = tree.child_by_field(tree.root(), "a").unwrap();
    let original = tree.source().buffer().to_vec();

    let cmd = tree.set_scalar(a, ScalarValue::Text("ALPHA".to_string())).unwrap();
    let tx = Transaction::single("edit a", cmd);

    let mut stack = UndoStack::new();
    // Apply the forward edit to the simulated document, then park the transaction on the stack -
    // mirrors how a real save/edit cycle would sequence this.
    let mut buf_source = two_field_source();
    buf_source.apply_transaction(&tx);
    stack.push(tx);

    assert_ne!(buf_source.buffer(), original.as_slice());

    let inverse = stack.undo().expect("expected a transaction to undo");
    buf_source.apply_transaction(&inverse);
    assert_eq!(buf_source.buffer(), original.as_slice());
}

#[test]
fn bundled_transaction_is_undone_and_redone_atomically() {
    let mut tree = two_field_tree();
    let a = tree.child_by_field(tree.root(), "a").unwrap();
    let b = tree.child_by_field(tree.root(), "b").unwrap();
    let original = tree.source().buffer().to_vec();

    // Two edits in one file, bundled as a single atomic action (e.g. a rename cascade touching
    // two reference sites) - architecture.md §3's "mehrere FileCommands ... atomar".
    let cmd_a = tree.set_scalar(a, ScalarValue::Text("ALPHA".to_string())).unwrap();
    let cmd_b = tree.set_scalar(b, ScalarValue::Text("BETA".to_string())).unwrap();
    let tx = Transaction::new("rename cascade", vec![cmd_a, cmd_b]);

    let mut buf_source = two_field_source();
    buf_source.apply_transaction(&tx);
    assert_eq!(buf_source.buffer(), b"<root><a>ALPHA</a><b>BETA</b></root>");

    let mut stack = UndoStack::new();
    stack.push(tx.clone());

    let inverse = stack.undo().unwrap();
    buf_source.apply_transaction(&inverse);
    assert_eq!(buf_source.buffer(), original.as_slice(), "both edits must revert together");

    let redo_tx = stack.redo().unwrap();
    buf_source.apply_transaction(&redo_tx);
    assert_eq!(buf_source.buffer(), b"<root><a>ALPHA</a><b>BETA</b></root>", "both edits must reapply together");
}
