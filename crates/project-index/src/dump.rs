//! Der Index als lesbares JSON (Debug-Menü). Nur zum Anschauen, kein Dateiformat.

use crate::model::{ProjectIndex, Target};
use serde_json::{json, Value};

fn target_text(t: &Target) -> String {
    match t {
        Target::Object(id) => format!("{id:?}"),
        Target::AliasShort(s) => format!("alias:{s}"),
        Target::LinkedFile(p) => format!("file:{p}"),
    }
}

impl ProjectIndex {
    /// Alles, was der Index hält, sortiert und mit Pfaden statt Schlüsseln.
    pub fn dump_json(&self) -> Value {
        let rel_of = |key: &str| self.files.get(key).map(|f| f.rel.clone()).unwrap_or_else(|| key.to_string());

        let files: Vec<Value> = self.files.values().map(|f| json!({ "rel": f.rel, "stamp": format!("{:?}", f.stamp) })).collect();

        let mut objects: Vec<Value> = self
            .objects
            .iter()
            .map(|(key, o)| {
                let references: Vec<Value> = self
                    .refs
                    .references(key)
                    .iter()
                    .map(|r| json!({ "target": target_text(&r.target), "kind": format!("{:?}", r.kind), "site": r.site, "line": r.line, "column": r.column }))
                    .collect();
                let problems = self.static_problems.get(key).cloned().unwrap_or_default();
                json!({
                    "file": rel_of(key),
                    "type": o.object_type,
                    "name": o.name,
                    "rootTag": o.root_tag,
                    "parsed": o.parsed,
                    "aliasTarget": o.alias_target_name,
                    "references": references,
                    "staticProblems": problems,
                })
            })
            .collect();
        objects.sort_by(|a, b| a["file"].as_str().cmp(&b["file"].as_str()));

        let mut referenced_by: Vec<Value> = self
            .refs
            .reverse_entries()
            .map(|(t, files)| {
                let mut rels: Vec<String> = files.iter().map(|f| rel_of(f)).collect();
                rels.sort();
                json!({ "target": target_text(t), "referencedBy": rels })
            })
            .collect();
        referenced_by.sort_by(|a, b| a["target"].as_str().cmp(&b["target"].as_str()));

        let mut names: Vec<(String, Vec<String>)> = self
            .modules
            .names_by_folder
            .iter()
            .map(|(folder, set)| {
                let mut v: Vec<String> = set.iter().cloned().collect();
                v.sort();
                (folder.to_string(), v)
            })
            .collect();
        names.sort();
        let mut alias_targets: Vec<(&String, &String)> = self.modules.alias_targets.iter().collect();
        alias_targets.sort();

        json!({
            "root": self.root.to_string_lossy(),
            "generation": self.generation,
            "counts": self.counts(),
            "modules": {
                "packageJson": format!("{:?}", self.modules.package_json),
                "packageLock": format!("{:?}", self.modules.package_lock),
                "hiddenLock": format!("{:?}", self.modules.hidden_lock),
                "namesByFolder": names.into_iter().collect::<std::collections::BTreeMap<_, _>>(),
                "aliasTargets": alias_targets.into_iter().collect::<std::collections::BTreeMap<_, _>>(),
            },
            "files": files,
            "objects": objects,
            "referencedBy": referenced_by,
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::model::ProjectIndex;

    #[test]
    fn empty_index_dumps() {
        let v = ProjectIndex::default().dump_json();
        assert_eq!(v["counts"]["files"], 0);
        assert!(v["objects"].as_array().unwrap().is_empty());
    }
}
