// Service-Aufrufe in Skripten: `modules.loadService("name")` führt alle Implementierungen eines Services aus. V2 schreibt die
// Implementierungen in das Skript selbst: Der Aufruf wird zur Liste von Funktionsnamen, die Funktionen
// (`_____GENERATED_<service>_<implementierung>`) hängen hinten am Skript, und die Imports der Implementierungen werden in den
// Importblock eingemischt. Port der Regeln aus dem alten Rust-Transpiler (V1-Orakel, 488 Skripte), am V2-Orakel zu prüfen.
//
// Wichtig für gleiche Ausgabe:
//  - Services in Namensreihenfolge, Implementierungen in der Reihenfolge ihrer kleingeschriebenen Namen (V2 weicht bei einzelnen
//    Services ab, siehe Plan, offen); eine Implementierung kann selbst Services aufrufen (werden mit eingesetzt);
//  - Ein Name, den eine Implementierung aus einem Modul importiert, das das Skript schon importiert, wird an dessen Import
//    angehängt (beim JDito-Modul werden schon vorhandene Namen noch einmal in einer eigenen Anweisung importiert);
//    ein Modul, das das Skript nicht importiert, bekommt eine eigene Anweisung, nach Modul und Name sortiert, hinter den alten;
//  - die Funktionsrümpfe sind um zwei Leerzeichen eingerückt.
// Der Text ist der rohe (schon XML-maskierte) Text des Baums, `=>` steht also als `=&gt;` darin; das stört nichts.

use std::collections::{BTreeMap, BTreeSet, HashMap};

pub const JDITO: &str = "@aditosoftware/jdito-types";
pub const CALL: &str = "modules.loadService(\"";

pub type Implementations = Vec<(String, String)>;
/// Besitzer (`entity/Foo_entity`) -> Servicename -> Implementierungen (Name, Skript).
pub type Owned = HashMap<String, HashMap<String, Implementations>>;

struct Import {
    names: Vec<String>,
    spec: String,
    raw: Option<String>,
    term: String,
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


pub struct Context<'a> {
    pub owned: &'a Owned,
    /// Kurzname eines Moduls (`Contact_lib`) -> ausgeschriebener Name (`@aditosoftware/contact/process/Contact_lib/process`).
    pub canonical: &'a (dyn Fn(&str) -> String + Sync),
}

impl Context<'_> {
    fn find_service(&self, owner: &str, name: &str) -> Option<&Implementations> {
        self.owned.get(owner).and_then(|m| m.get(name)).or_else(|| self.owned.get(&format!("serviceDefinition/{name}")).and_then(|m| m.get(name)))
    }

    /// Das Skript mit eingesetzten Services, oder `None`, wenn es keinen Aufruf hat.
    pub fn transform(&self, owner: &str, base: &str) -> Option<String> {
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
            for (impl_name, source) in impls {
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
                let mut missing: Vec<String> = names.iter().filter(|n| !o.names.contains(n)).cloned().collect();
                // V2 sortiert die Namen ohne Rücksicht auf Groß- und Kleinschreibung (Orakel: `newSelect, SqlBuilder`).
                missing.sort_by_key(|n| n.to_lowercase());
                let present: Vec<String> = names.iter().filter(|n| o.names.contains(n)).cloned().collect();
                if !missing.is_empty() {
                    o.raw = o.raw.as_deref().and_then(|r| add_names(r, &missing));
                    o.names.extend(missing);
                }
                // V1 importierte beim JDito-Modul schon vorhandene Namen noch einmal in einer eigenen Anweisung; V2 tut das nicht.
                let _ = present;
                continue;
            }
            let canon = (self.canonical)(spec);
            let mut have: BTreeSet<String> = BTreeSet::new();
            for o in &orig {
                if o.spec == canon {
                    have.extend(o.names.iter().cloned());
                }
            }
            let mut by_canon: HashMap<String, BTreeSet<String>> = HashMap::new();
            for (s, ns) in &generated {
                by_canon.insert((self.canonical)(s), ns.clone());
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
                Some(r) => text.push_str(&normalize_braces(r)),
                None => text.push_str(&format!("import {{ {} }} from \"{}\";", o.names.join(", "), o.spec)),
            }
            text.push_str(&o.term);
        }
        generated.sort_by(|a, b| a.0.cmp(&b.0));
        for (spec, names) in &generated {
            text.push_str(&format!("import {{ {} }} from \"{}\";\n", { let mut sorted: Vec<String> = names.iter().cloned().collect(); sorted.sort_by_key(|n| n.to_lowercase()); sorted.join(", ") }, spec));
        }
        // V2: genau eine Leerzeile bleibt nach den Importen (V1 fügte hier noch eine ein).
        text.push_str(&new_main);
        // V2 hängt je Service an: ohne Implementierung zwei Zeilenenden, sonst die Funktionen und ein Zeilenende.
        // Vor dem ersten Service mit Funktionen steht eine Leerzeile.
        let mut first = true;
        for funcs in bodies.values() {
            let was_first = first;
            first = false;
            if funcs.is_empty() {
                text.push_str("\n\n");
                continue;
            }
            text.push_str(if was_first { "\n\n" } else { "\n" });
            let parts: Vec<String> = funcs.iter().map(|(n, c)| format!("function {n}()\n{{\n{}\n}}", indent(&replace_calls(c, &bodies)))).collect();
            text.push_str(&parts.join("\n\n"));
            text.push('\n');
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

/// V2 schreibt die Namen eines Imports mit je einem Leerzeichen: `{ a, b }` (Orakel: `vars  }` wird `vars }`).
fn normalize_braces(raw: &str) -> String {
    let (Some(open), Some(close)) = (raw.find('{'), raw.find('}')) else { return raw.to_string() };
    if open > close {
        return raw.to_string();
    }
    let names: Vec<&str> = raw[open + 1..close].split(',').map(str::trim).filter(|n| !n.is_empty()).collect();
    if names.is_empty() {
        return raw.to_string();
    }
    format!("{}{{ {} }}{}", &raw[..open], names.join(", "), &raw[close + 1..])
}
