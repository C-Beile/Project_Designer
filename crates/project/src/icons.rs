//! The icons an `iconId` property can point at (`VAADIN:HOME`, `NEON:IMPORT`), shipped with the app
//! so the icon chooser works on every machine, with or without an installed ADITO Designer.
//! The set is generated from a Designer installation by `examples/dump_icons.rs`.

use serde::Serialize;
use std::collections::BTreeMap;

const BUNDLED_ICONS: &str = include_str!("../assets/icons.json");

#[derive(Debug, Clone, Serialize)]
pub struct IconDto {
    pub id: String,
    pub svg: String,
}

pub fn bundled_icons() -> Vec<IconDto> {
    serde_json::from_str::<BTreeMap<String, String>>(BUNDLED_ICONS)
        .unwrap_or_default()
        .into_iter()
        .map(|(id, svg)| IconDto { id, svg })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_set_holds_both_icon_families() {
        let icons = bundled_icons();
        assert!(icons.iter().any(|i| i.id == "VAADIN:HOME"));
        assert!(icons.iter().any(|i| i.id == "NEON:IMPORT"));
        assert!(icons.iter().all(|i| i.svg.starts_with("<svg")));
    }
}
