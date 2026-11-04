// Service inlining stage of the own transpiler. A script may call
// `modules.loadService("name")` to run every implementation of a service. The reference transpiler
// writes the implementations into the script itself: the call becomes a list of function names,
// the functions (one per implementation, named `_____GENERATED_<service>_<implementation>`) are
// appended to the script, and the imports the implementations need are merged into the import
// block. The rules below were derived from, and are verified against, the output of the reference
// transpiler for two real projects (488 scripts).
//
// Details that matter for identical output:
//  - services come in the order of their names, implementations in the order of their lower-cased
//    names; an implementation may call services itself (they are inlined as well);
//  - a name an implementation imports from a module the script already imports is appended to that
//    import statement (for the JDito module the names that were there already are imported again in
//    a statement of their own); a module the script does not import gets a statement of its own,
//    sorted by module and by name, behind the original ones;
//  - the original import statements keep their line ending, generated lines end with LF, the bodies
//    are indented by two spaces and keep the line endings of their source;
//  - the reference reads and writes the scripts with a one-byte character set on the way in and
//    UTF-8 on the way out, so every byte above 127 of a changed script comes out as two bytes.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const JDITO: &str = "@aditosoftware/jdito-types";
const CALL: &str = "modules.loadService(\"";

#[derive(Debug, Default, Clone)]
pub struct ServiceInlineReport {
    pub scripts_changed: usize,
    pub services_inlined: usize,
}

type Implementations = Vec<(String, String)>;
type Owned = HashMap<String, HashMap<String, Implementations>>;

struct Import {
    names: Vec<String>,
    spec: String,
    raw: Option<String>,
    term: String,
}

fn bytes_to_text(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

fn collect_files(dir: &Path, aod: &mut Vec<PathBuf>, js: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|n| n == "modification" || n == ".forge-incremental-cache" || n == "node_modules") {
                continue;
            }
            collect_files(&path, aod, js);
        } else if path.extension().is_some_and(|e| e == "aod") {
            aod.push(path);
        } else if path.extension().is_some_and(|e| e == "js") {
            js.push(path);
        }
    }
}

fn tag_text<'a>(line: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    line.trim().strip_prefix(open.as_str())?.strip_suffix(close.as_str())
}

/// Service definitions of one object: `<entityServiceDefinition>` blocks of an entity and the
/// object itself when it is a service definition.
fn service_definitions(text: &str, is_service_object: bool) -> HashMap<String, Implementations> {
    let mut out: HashMap<String, Implementations> = HashMap::new();
    let lines: Vec<&str> = text.split('\n').collect();
    let mut i = 0;
    while i < lines.len() {
        let t = lines[i].trim();
        let block = if t == "<entityServiceDefinition>" {
            Some("</entityServiceDefinition>")
        } else if is_service_object && t.starts_with("<serviceDefinition ") {
            Some("</serviceDefinition>")
        } else {
            None
        };
        let Some(end_tag) = block else {
            i += 1;
            continue;
        };
        let mut name: Option<String> = None;
        let mut impls: Implementations = Vec::new();
        let mut impl_name: Option<String> = None;
        let mut j = i + 1;
        while j < lines.len() && lines[j].trim() != end_tag {
            let line = lines[j];
            if name.is_none() {
                if let Some(n) = tag_text(line, "name") {
                    name = Some(n.to_string());
                }
            } else if let Some(n) = tag_text(line, "name") {
                impl_name = Some(n.to_string());
            } else if let Some(p) = tag_text(line, "process") {
                if let Some(n) = impl_name.take() {
                    impls.push((n, p.to_string()));
                }
            }
            j += 1;
        }
        if let Some(n) = name {
            out.insert(n, impls);
        }
        i = j + 1;
    }
    out
}

fn is_ws(c: char) -> bool {
    c.is_whitespace()
}

/// The import statements at the start of a script and the position where the rest begins.
fn split_imports(text: &str) -> (Vec<Import>, usize) {
    let mut out = Vec::new();
    let mut pos = 0;
    loop {
        let skipped_ws = text[pos..].len() - text[pos..].trim_start_matches(is_ws).len();
        let p = pos + skipped_ws;
        let rest = &text[p..];
        let Some(after) = rest.strip_prefix("import") else { break };
        let ws = after.len() - after.trim_start_matches(is_ws).len();
        if ws == 0 {
            break;
        }
        let clause_start = p + "import".len() + ws;
        // The clause ends at the first place where `from "` follows (white space allowed).
        let mut found: Option<(usize, usize, char)> = None;
        let mut q = clause_start;
        while q <= text.len() {
            if q > clause_start {
                let c = text.as_bytes()[q - 1] as char;
                if c == ';' || c == '"' || c == '\'' {
                    break;
                }
            }
            let tail = &text[q..];
            let skipped = tail.len() - tail.trim_start_matches(is_ws).len();
            if let Some(f) = tail[skipped..].strip_prefix("from") {
                let skipped2 = f.len() - f.trim_start_matches(is_ws).len();
                if let Some(quote) = f[skipped2..].chars().next().filter(|&c| c == '"' || c == '\'') {
                    found = Some((q, q + skipped + "from".len() + skipped2, quote));
                    break;
                }
            }
            if q == text.len() {
                break;
            }
            q += 1;
            while q < text.len() && !text.is_char_boundary(q) {
                q += 1;
            }
        }
        let Some((clause_end, quote_at, quote)) = found else { break };
        let spec_start = quote_at + 1;
        let Some(spec_len) = text[spec_start..].find(quote) else { break };
        let spec = &text[spec_start..spec_start + spec_len];
        if spec.contains('\n') || spec.is_empty() {
            break;
        }
        let mut end = spec_start + spec_len + 1;
        let after_spec = &text[end..];
        end += after_spec.len() - after_spec.trim_start_matches(is_ws).len();
        let mut term = String::new();
        let mut statement_end = end;
        if text[end..].starts_with(';') {
            end += 1;
            statement_end = end;
            while end < text.len() && (text.as_bytes()[end] == b' ' || text.as_bytes()[end] == b'\t') {
                end += 1;
            }
            if text[end..].starts_with("\r\n") {
                term = "\r\n".to_string();
                end += 2;
            } else if text[end..].starts_with('\n') {
                term = "\n".to_string();
                end += 1;
            }
        }
        let clause = &text[clause_start..clause_end];
        let names: Vec<String> = match (clause.find('{'), clause.find('}')) {
            (Some(a), Some(b)) if a < b => clause[a + 1..b].split(',').map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).collect(),
            _ => Vec::new(),
        };
        let raw_start = p;
        let raw = text[raw_start..statement_end].trim().to_string();
        out.push(Import { names, spec: spec.to_string(), raw: Some(raw), term });
        pos = end;
    }
    (out, pos)
}

fn add_names(raw: &str, names: &[String]) -> Option<String> {
    let open = raw.find('{')?;
    let close = raw[open..].find('}')? + open;
    let inner = &raw[open + 1..close];
    let lead_len = inner.len() - inner.trim_start_matches(is_ws).len();
    let (lead, rest) = inner.split_at(lead_len);
    let core = rest.trim_end_matches(is_ws);
    let trail = &rest[core.len()..];
    let mut out = String::new();
    out.push_str(&raw[..open + 1]);
    out.push_str(lead);
    out.push_str(core);
    for n in names {
        out.push_str(", ");
        out.push_str(n);
    }
    out.push_str(trail);
    out.push_str(&raw[close..]);
    Some(out)
}

fn indent(text: &str) -> String {
    text.split('\n').map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n")
}

fn function_name(service: &str, implementation: &str) -> String {
    let clean: String = implementation.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect();
    format!("_____GENERATED_{service}_{clean}")
}

/// Every `modules.loadService("x")` of a text: (start, end, service).
fn calls(text: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = text[from..].find(CALL) {
        let start = from + at;
        let name_start = start + CALL.len();
        let Some(len) = text[name_start..].find('"') else { break };
        let after = name_start + len + 1;
        if text[after..].starts_with(')') && !text[name_start..name_start + len].contains('\n') {
            out.push((start, after + 1, text[name_start..name_start + len].to_string()));
            from = after + 1;
        } else {
            from = name_start;
        }
    }
    out
}

fn replace_calls(text: &str, bodies: &BTreeMap<String, Vec<(String, String)>>) -> String {
    let mut out = String::new();
    let mut last = 0;
    for (start, end, name) in calls(text) {
        out.push_str(&text[last..start]);
        let names: Vec<&str> = bodies.get(&name).map(|f| f.iter().map(|(n, _)| n.as_str()).collect()).unwrap_or_default();
        out.push('[');
        out.push_str(&names.join(", "));
        out.push(']');
        last = end;
    }
    out.push_str(&text[last..]);
    out
}

struct Context<'a> {
    output_dir: &'a Path,
    project_home: &'a Path,
    owned: &'a Owned,
    resolved: HashMap<String, String>,
}

impl Context<'_> {
    fn canonical(&mut self, spec: &str) -> String {
        if spec.contains('/') || spec.starts_with('@') {
            return spec.to_string();
        }
        if let Some(hit) = self.resolved.get(spec) {
            return hit.clone();
        }
        let mut found = spec.to_string();
        let modules = self.project_home.join("node_modules");
        if let Ok(scopes) = fs::read_dir(&modules) {
            let mut scope_names: Vec<String> = scopes.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with('@')).collect();
            scope_names.sort();
            'search: for scope in scope_names {
                let Ok(packages) = fs::read_dir(modules.join(&scope)) else { continue };
                let mut package_names: Vec<String> = packages.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
                package_names.sort();
                for package in package_names {
                    if modules.join(&scope).join(&package).join("process").join(spec).join("process.js").is_file() {
                        found = format!("{scope}/{package}/process/{spec}/process");
                        break 'search;
                    }
                }
            }
        }
        self.resolved.insert(spec.to_string(), found.clone());
        found
    }

    fn find_service(&self, owner: &str, name: &str) -> Option<&Implementations> {
        self.owned.get(owner).and_then(|m| m.get(name)).or_else(|| self.owned.get(&format!("serviceDefinition/{name}")).and_then(|m| m.get(name)))
    }

    fn read_impl(&self, reference: &str) -> String {
        let relative = reference.strip_prefix("%aditoprj%/").unwrap_or(reference);
        fs::read(self.output_dir.join(relative)).map(|b| bytes_to_text(&b)).unwrap_or_default()
    }

    /// The script with its service calls inlined, or `None` when it has none.
    fn transform(&mut self, owner: &str, base: &str) -> Option<String> {
        let (imports, main_at) = split_imports(base);
        let main = &base[main_at..];
        let occurrences = calls(main);
        if occurrences.is_empty() {
            return None;
        }
        let mut orig: Vec<Import> = imports;
        let mut bodies: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
        let mut needed: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut queue: Vec<String> = occurrences.iter().map(|(_, _, n)| n.clone()).collect::<BTreeSet<_>>().into_iter().collect();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        while !queue.is_empty() {
            let name = queue.remove(0);
            if !seen.insert(name.clone()) {
                continue;
            }
            let mut impls: Implementations = self.find_service(owner, &name).cloned().unwrap_or_default();
            impls.sort_by_key(|(n, _)| n.to_lowercase());
            let mut funcs = Vec::new();
            for (impl_name, reference) in impls {
                let source = self.read_impl(&reference);
                let (impl_imports, impl_main_at) = split_imports(&source);
                for imp in &impl_imports {
                    needed.entry(imp.spec.clone()).or_default().extend(imp.names.iter().cloned());
                }
                let code = source[impl_main_at..].trim().to_string();
                for (_, _, nested) in calls(&code) {
                    queue.push(nested);
                }
                funcs.push((function_name(&name, &impl_name), code));
            }
            bodies.insert(name, funcs);
        }

        let mut generated: Vec<(String, BTreeSet<String>)> = Vec::new();
        for (spec, names) in &needed {
            if let Some(o) = orig.iter_mut().find(|o| &o.spec == spec) {
                let missing: Vec<String> = names.iter().filter(|n| !o.names.contains(n)).cloned().collect();
                let present: Vec<String> = names.iter().filter(|n| o.names.contains(n)).cloned().collect();
                if !missing.is_empty() {
                    o.raw = o.raw.as_deref().and_then(|r| add_names(r, &missing));
                    o.names.extend(missing);
                }
                if spec == JDITO && !present.is_empty() {
                    push_generated(&mut generated, spec, present);
                }
                continue;
            }
            let canon = self.canonical(spec);
            let mut have: BTreeSet<String> = BTreeSet::new();
            for o in &orig {
                if o.spec == canon {
                    have.extend(o.names.iter().cloned());
                }
            }
            let mut by_canon: HashMap<String, BTreeSet<String>> = HashMap::new();
            for (s, ns) in &generated {
                by_canon.insert(self.canonical(s), ns.clone());
            }
            if let Some(ns) = by_canon.get(&canon) {
                have.extend(ns.iter().cloned());
            }
            let fresh: Vec<String> = names.iter().filter(|n| !have.contains(*n)).cloned().collect();
            if !fresh.is_empty() {
                push_generated(&mut generated, spec, fresh);
            }
        }

        let mut new_main = replace_calls(main, &bodies);
        if bodies.values().any(|f| !f.is_empty()) {
            new_main = new_main.trim_end_matches('\n').to_string();
        }
        let mut text = String::new();
        for o in &orig {
            match &o.raw {
                Some(r) => text.push_str(r),
                None => text.push_str(&format!("import {{ {} }} from \"{}\";", o.names.join(", "), o.spec)),
            }
            text.push_str(&o.term);
        }
        generated.sort_by(|a, b| a.0.cmp(&b.0));
        for (spec, names) in &generated {
            text.push_str(&format!("import {{ {} }} from \"{}\";\n", names.iter().cloned().collect::<Vec<_>>().join(", "), spec));
        }
        text.push('\n');
        text.push_str(&new_main);
        let mut first = true;
        for funcs in bodies.values() {
            let was_first = first;
            first = false;
            if funcs.is_empty() {
                continue;
            }
            if was_first {
                text.push_str("\n\n");
            }
            let parts: Vec<String> = funcs.iter().map(|(n, c)| format!("function {n}()\n{{\n{}\n}}", indent(&replace_calls(c, &bodies)))).collect();
            text.push_str(&parts.join("\n\n"));
            text.push_str("\n\n");
        }
        Some(text)
    }
}

fn push_generated(generated: &mut Vec<(String, BTreeSet<String>)>, spec: &str, names: Vec<String>) {
    if let Some(entry) = generated.iter_mut().find(|(s, _)| s == spec) {
        entry.1.extend(names);
    } else {
        generated.push((spec.to_string(), names.into_iter().collect()));
    }
}

/// Inlines the service calls of every script below `output_dir`.
pub fn run_service_inline(project_home: &Path, output_dir: &Path) -> io::Result<ServiceInlineReport> {
    let mut report = ServiceInlineReport::default();
    let mut aod = Vec::new();
    let mut js = Vec::new();
    collect_files(output_dir, &mut aod, &mut js);

    let mut owned: Owned = HashMap::new();
    for file in &aod {
        let Ok(rel) = file.strip_prefix(output_dir) else { continue };
        let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        if parts.len() != 3 || parts[0].starts_with('.') {
            continue;
        }
        let Ok(bytes) = fs::read(file) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        if !text.contains("<implementations>") && !text.contains("<entityServiceDefinition>") {
            continue;
        }
        let defs = service_definitions(&text, parts[0] == "serviceDefinition");
        if !defs.is_empty() {
            owned.insert(format!("{}/{}", parts[0], parts[1]), defs);
        }
    }

    let mut context = Context { output_dir, project_home, owned: &owned, resolved: HashMap::new() };
    for file in &js {
        let Ok(rel) = file.strip_prefix(output_dir) else { continue };
        let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
        if parts.len() < 3 || parts.iter().any(|p| p == "implementations") {
            continue;
        }
        let Ok(bytes) = fs::read(file) else { continue };
        if !bytes.windows(CALL.len()).any(|w| w == CALL.as_bytes()) {
            continue;
        }
        let owner = format!("{}/{}", parts[0], parts[1]);
        let Some(text) = context.transform(&owner, &bytes_to_text(&bytes)) else { continue };
        fs::write(file, text.as_bytes())?;
        report.scripts_changed += 1;
    }
    report.services_inlined = owned.values().map(HashMap::len).sum();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, rel: &str, text: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn inlines_the_implementations_of_a_service_and_merges_their_imports() {
        let root = std::env::temp_dir().join(format!("forge-inline-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let out = root.join("out");
        let entity = "<entity>\r\n  <name>E_entity</name>\r\n  <entityServiceDefinition>\r\n    <name>x_service</name>\r\n    <implementations>\r\n      <serviceImplementation>\r\n        <name>b_impl</name>\r\n        <process>%aditoprj%/entity/E_entity/b.js</process>\r\n      </serviceImplementation>\r\n      <serviceImplementation>\r\n        <name>A_impl</name>\r\n        <process>%aditoprj%/entity/E_entity/a.js</process>\r\n      </serviceImplementation>\r\n    </implementations>\r\n  </entityServiceDefinition>\r\n</entity>";
        write(&out, "entity/E_entity/E_entity.aod", entity);
        write(&out, "entity/E_entity/a.js", "import { vars } from \"@aditosoftware/jdito-types\";\nimport { Utils } from \"Utils_lib\";\n\nUtils.run(vars.get(\"$field.A\"));");
        write(&out, "entity/E_entity/b.js", "import { vars, neon } from \"@aditosoftware/jdito-types\";\n\nneon.x();");
        write(&out, "entity/E_entity/onInit.js", "import { modules } from \"@aditosoftware/jdito-types\";\r\n\r\nmodules.loadService(\"x_service\")\r\n    .forEach(f => f());");

        let report = run_service_inline(&root, &out).unwrap();
        assert_eq!(report.scripts_changed, 1);
        let text = fs::read_to_string(out.join("entity/E_entity/onInit.js")).unwrap();
        let expected = "import { modules, neon, vars } from \"@aditosoftware/jdito-types\";\r\nimport { Utils } from \"Utils_lib\";\n\n\r\n[_____GENERATED_x_service_A_impl, _____GENERATED_x_service_b_impl]\r\n    .forEach(f => f());\n\nfunction _____GENERATED_x_service_A_impl()\n{\n  Utils.run(vars.get(\"$field.A\"));\n}\n\nfunction _____GENERATED_x_service_b_impl()\n{\n  neon.x();\n}\n\n";
        assert_eq!(text, expected);
    }

    #[test]
    fn an_empty_service_becomes_an_empty_list_and_impl_scripts_stay_untouched() {
        let root = std::env::temp_dir().join(format!("forge-inline-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let out = root.join("out");
        write(&out, "process/L_lib/process.js", "import { modules } from \"@aditosoftware/jdito-types\";\n\nmodules.loadService(\"none_service\").length;");
        write(&out, "serviceDefinition/s_service/implementations/i/process.js", "modules.loadService(\"none_service\");");
        run_service_inline(&root, &out).unwrap();
        assert_eq!(fs::read_to_string(out.join("process/L_lib/process.js")).unwrap(), "import { modules } from \"@aditosoftware/jdito-types\";\n\n\nmodules.loadService(\"none_service\").length;".replace("modules.loadService(\"none_service\")", "[]"));
        assert!(fs::read_to_string(out.join("serviceDefinition/s_service/implementations/i/process.js")).unwrap().contains("loadService"));
    }
}
