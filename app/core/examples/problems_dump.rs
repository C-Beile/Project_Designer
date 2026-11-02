// Hardening helper: prints the problems scan of a project grouped by message shape (read-only).
fn main() {
    let root = std::env::args().nth(1).expect("project root");
    let list = forge_app_core::problems::scan_project(std::path::Path::new(&root));
    let mut seen = std::collections::BTreeMap::<String, (usize, String)>::new();
    for p in &list {
        let v = format!("{p:?}");
        let key: String = v.chars().skip(0).take(0).collect::<String>() + &format!("{:?}", p.severity) + &p.message.chars().take(60).collect::<String>();
        let e = seen.entry(key).or_insert((0, v));
        e.0 += 1;
    }
    for (k, (n, v)) in seen {
        println!("{n}x {k}\n     e.g. {}", v.chars().take(330).collect::<String>());
    }
}
