//! Error types for the `aod-io` crate.
//!
//! Kept small and explicit on purpose: callers (`core-model`) need to distinguish
//! "the file is not well-formed XML" from "the patch operation could not be applied to
//! this document" without downcasting a generic error type.

use std::ops::Range;
use thiserror::Error;

/// Failure while parsing raw `.aod` bytes into an [`crate::document::AodDocument`].
#[derive(Debug, Error)]
pub enum AodError {
    #[error("malformed XML: {0}")]
    Xml(#[from] quick_xml::Error),
}

/// Failure while applying one of the event-level patch operations
/// (`replace_text_at`, `insert_at`, `delete_range`).
#[derive(Debug, Error)]
pub enum PatchError {
    #[error("event range {0:?} does not refer to exactly one Text event")]
    NotASingleTextEvent(Range<usize>),

    #[error("path {0:?} was not found in the event index")]
    PathNotFound(String),

    #[error("path {0:?} does not refer to an element (it is an attribute entry)")]
    NotAnElement(String),

    #[error("cannot insert children into a self-closing (Empty) element at path {0:?}; \
             convert it to a Start/End pair first")]
    CannotInsertIntoEmptyElement(String),

    #[error("insert template did not parse as a single well-formed element: {0}")]
    InvalidTemplate(#[from] quick_xml::Error),

    #[error("insert template must contain exactly one root element, found {0}")]
    TemplateNotSingleElement(usize),

    #[error("event range {0:?} is out of bounds for a document with {1} events")]
    RangeOutOfBounds(Range<usize>, usize),
}
