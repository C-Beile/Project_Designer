//! Observability (architecture.md §3): per-node callbacks plus a project-wide change bus.
//!
//! Deliberately Bordmittel only (ADR-0005 point 3) - a `Vec` of callbacks per node, and
//! `std::sync::mpsc` for the bus that `refs::RefGraph` and `index` subscribe to. No reactive
//! framework, no dependency graph.

use crate::tree::path::NodePath;
use crate::tree::tree::NodeId;
use std::sync::mpsc::{self, Receiver, Sender};

/// What changed, in terms other subscribers (RefGraph, index) can act on incrementally without
/// re-scanning the whole tree - see architecture.md §5 "nur Dateien ... neu geparst".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeEvent {
    ValueChanged { node: NodeId, path: NodePath },
    ChildInserted { parent: NodeId, parent_path: NodePath, child: NodeId },
    ChildRemoved { parent: NodeId, parent_path: NodePath, removed_path: NodePath },
}

/// Fan-out publisher for `ChangeEvent`s. Held by `PropertyTree`; every `subscribe()` call hands
/// out one more receiver. Disconnected receivers are pruned lazily on the next publish so a
/// dropped subscriber (e.g. a closed UI panel) doesn't leak.
#[derive(Default)]
pub struct ChangeBus {
    subscribers: Vec<Sender<ChangeEvent>>,
}

impl ChangeBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&mut self) -> Receiver<ChangeEvent> {
        let (tx, rx) = mpsc::channel();
        self.subscribers.push(tx);
        rx
    }

    pub fn publish(&mut self, event: ChangeEvent) {
        self.subscribers.retain(|tx| tx.send(event.clone()).is_ok());
    }
}
