//! macOS needs no stubs any more: the real implementations live in [`crate::unix`] (shared with
//! Linux) and are reachable under one name as [`crate::native`]. This module only keeps the old
//! path `platform::macos::...` valid. Everything here is compiled and run on a Mac only; it was
//! prepared on Windows without being executed (see PROJECT/MACOS_PORT.md).

pub use crate::unix::*;
