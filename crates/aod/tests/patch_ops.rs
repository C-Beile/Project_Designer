//! Targeted before/after byte-comparison tests for the three event-level patch primitives
//! (`replace_text_at`, `insert_at`, `delete_range`) plus the `customProperties` indentation
//! quirk exception (aod-format.md #1.2). Fixtures here are small, hand-built XML snippets
//! rather than corpus files, so each test isolates exactly the mechanism it names.

use aod_io::{
    build_index, delete_range, insert_at, replace_text_at, serialize, EventPath, PathStep,
    SiblingHint,
};

fn root_child_path(tag: &str, occurrence: usize) -> EventPath {
    EventPath(vec![PathStep::Child {
        tag: tag.to_string(),
        occurrence,
    }])
}

#[test]
fn replace_text_at_changes_only_the_targeted_field_value() {
    let original =
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<entity>\r\n  <name>Foo</name>\r\n</entity>\r\n"
            .to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let index = build_index(&doc);

    let name_path = EventPath(vec![
        PathStep::Child {
            tag: "entity".to_string(),
            occurrence: 0,
        },
        PathStep::Child {
            tag: "name".to_string(),
            occurrence: 0,
        },
    ]);
    let text_idx = index
        .text_event_index(&doc, &name_path)
        .expect("name element has a single Text child");

    let old = replace_text_at(&mut doc, text_idx..text_idx + 1, b"Bar".to_vec()).unwrap();
    assert_eq!(old, b"Foo");

    let regenerated = serialize(&doc);
    let expected =
        b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<entity>\r\n  <name>Bar</name>\r\n</entity>\r\n"
            .to_vec();
    assert_eq!(regenerated, expected);
}

#[test]
fn replace_text_at_rejects_a_multi_event_range() {
    let original = b"<entity>\r\n  <name>Foo</name>\r\n</entity>\r\n".to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let err = replace_text_at(&mut doc, 0..2, b"x".to_vec()).unwrap_err();
    assert!(matches!(err, aod_io::PatchError::NotASingleTextEvent(_)));
}

#[test]
fn insert_at_appends_last_child_with_standard_indentation() {
    let original =
        b"<entityFields>\r\n  <entityField>\r\n    <name>A</name>\r\n  </entityField>\r\n</entityFields>\r\n"
            .to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let index = build_index(&doc);

    let parent_path = root_child_path("entityFields", 0);
    let template = b"<entityField>\r\n    <name>B</name>\r\n  </entityField>";
    insert_at(
        &mut doc,
        &index,
        &parent_path,
        template,
        SiblingHint::AppendAsLastChild,
    )
    .unwrap();

    let regenerated = serialize(&doc);
    let expected = b"<entityFields>\r\n  <entityField>\r\n    <name>A</name>\r\n  </entityField>\r\n  <entityField>\r\n    <name>B</name>\r\n  </entityField>\r\n</entityFields>\r\n".to_vec();
    assert_eq!(regenerated, expected);
}

#[test]
fn insert_at_before_existing_sibling_keeps_its_own_indentation_intact() {
    let original = b"<entityFields>\r\n  <entityField>\r\n    <name>B</name>\r\n  </entityField>\r\n</entityFields>\r\n".to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let index = build_index(&doc);

    let parent_path = root_child_path("entityFields", 0);
    let existing_field_path = EventPath(vec![
        PathStep::Child {
            tag: "entityFields".to_string(),
            occurrence: 0,
        },
        PathStep::Child {
            tag: "entityField".to_string(),
            occurrence: 0,
        },
    ]);
    let template = b"<entityField>\r\n    <name>A</name>\r\n  </entityField>";
    insert_at(
        &mut doc,
        &index,
        &parent_path,
        template,
        SiblingHint::Before(existing_field_path),
    )
    .unwrap();

    let regenerated = serialize(&doc);
    let expected = b"<entityFields>\r\n  <entityField>\r\n    <name>A</name>\r\n  </entityField>\r\n  <entityField>\r\n    <name>B</name>\r\n  </entityField>\r\n</entityFields>\r\n".to_vec();
    assert_eq!(regenerated, expected);
}

#[test]
fn insert_at_after_existing_sibling() {
    let original = b"<entityFields>\r\n  <entityField>\r\n    <name>A</name>\r\n  </entityField>\r\n</entityFields>\r\n".to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let index = build_index(&doc);

    let parent_path = root_child_path("entityFields", 0);
    let existing_field_path = EventPath(vec![
        PathStep::Child {
            tag: "entityFields".to_string(),
            occurrence: 0,
        },
        PathStep::Child {
            tag: "entityField".to_string(),
            occurrence: 0,
        },
    ]);
    let template = b"<entityField>\r\n    <name>B</name>\r\n  </entityField>";
    insert_at(
        &mut doc,
        &index,
        &parent_path,
        template,
        SiblingHint::After(existing_field_path),
    )
    .unwrap();

    let regenerated = serialize(&doc);
    let expected = b"<entityFields>\r\n  <entityField>\r\n    <name>A</name>\r\n  </entityField>\r\n  <entityField>\r\n    <name>B</name>\r\n  </entityField>\r\n</entityFields>\r\n".to_vec();
    assert_eq!(regenerated, expected);
}

#[test]
fn insert_at_into_empty_element_is_rejected() {
    let original = b"<usePermissions v=\"true\" />\r\n".to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let index = build_index(&doc);
    let path = root_child_path("usePermissions", 0);
    let err = insert_at(
        &mut doc,
        &index,
        &path,
        b"<x/>",
        SiblingHint::AppendAsLastChild,
    )
    .unwrap_err();
    assert!(matches!(err, aod_io::PatchError::CannotInsertIntoEmptyElement(_)));
}

#[test]
fn delete_range_removes_element_and_its_leading_whitespace() {
    let original = b"<entityFields>\r\n  <entityField>\r\n    <name>A</name>\r\n  </entityField>\r\n  <entityField>\r\n    <name>B</name>\r\n  </entityField>\r\n</entityFields>\r\n".to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let index = build_index(&doc);

    let first_field_path = EventPath(vec![
        PathStep::Child {
            tag: "entityFields".to_string(),
            occurrence: 0,
        },
        PathStep::Child {
            tag: "entityField".to_string(),
            occurrence: 0,
        },
    ]);
    let range = match index.get(&first_field_path).unwrap() {
        aod_io::IndexedRange::Element(r) => r.clone(),
        _ => panic!("expected an element range"),
    };

    delete_range(&mut doc, range).unwrap();

    let regenerated = serialize(&doc);
    // no blank line where the first entityField (and its indentation lead-in) used to be
    let expected = b"<entityFields>\r\n  <entityField>\r\n    <name>B</name>\r\n  </entityField>\r\n</entityFields>\r\n".to_vec();
    assert_eq!(regenerated, expected);
}

/// aod-format.md #1.2: when a parent already has a `customProperties` child at some
/// (possibly irregular) indentation, inserting another one should copy that existing sibling's
/// indentation verbatim rather than compute the standard depth-based indent — this is the
/// documented "match an existing example" fallback in `patch::KNOWN_INDENT_QUIRKS`.
#[test]
fn insert_at_copies_existing_custom_properties_sibling_indentation() {
    // Root element's children stand at standard depth-2 indent (4 spaces); the existing
    // customProperties child here is deliberately indented 3 spaces instead, mimicking the
    // real-world irregularity without needing the full aliasDefinition nesting depth.
    let original = b"<entityFieldDb>\r\n   <customProperties><stringEntry><name>k</name></stringEntry></customProperties>\r\n</entityFieldDb>\r\n".to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let index = build_index(&doc);

    let parent_path = root_child_path("entityFieldDb", 0);
    let template = b"<customProperties><stringEntry><name>k2</name></stringEntry></customProperties>";
    let inserted_range = insert_at(
        &mut doc,
        &index,
        &parent_path,
        template,
        SiblingHint::AppendAsLastChild,
    )
    .unwrap();

    // the leading Text event of the inserted block must be the copied 3-space indent, not the
    // standard 4-space depth-based indent.
    match &doc.events[inserted_range.start] {
        aod_io::AodEvent::Text(b) => assert_eq!(b, b"\r\n   "),
        other => panic!("expected the inserted block to start with a Text indent, got {other:?}"),
    }
}

#[test]
fn insert_at_falls_back_to_standard_indent_when_no_quirk_sibling_exists() {
    let original = b"<entityFieldDb>\r\n  <name>k</name>\r\n</entityFieldDb>\r\n".to_vec();
    let mut doc = aod_io::parse(&original).unwrap();
    let index = build_index(&doc);

    let parent_path = root_child_path("entityFieldDb", 0);
    let template = b"<customProperties><stringEntry><name>k2</name></stringEntry></customProperties>";
    let inserted_range = insert_at(
        &mut doc,
        &index,
        &parent_path,
        template,
        SiblingHint::AppendAsLastChild,
    )
    .unwrap();

    // no existing customProperties sibling to copy from -> standard indent: entityFieldDb is
    // the fixture's root element (path length 1), so its children indent 2 spaces, matching
    // the existing <name> sibling already in the fixture.
    match &doc.events[inserted_range.start] {
        aod_io::AodEvent::Text(b) => assert_eq!(b, b"\r\n  "),
        other => panic!("expected the inserted block to start with a Text indent, got {other:?}"),
    }
}
