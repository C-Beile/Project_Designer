use native_transpiler::own_engine::linked_unshare_stage::{link_folders, misplaced_links};

fn main() {
    let path = std::env::args().nth(1).unwrap();
    let base = std::env::args().nth(2).unwrap();
    let text = std::fs::read_to_string(path).unwrap();
    for (rel, canonical) in link_folders(&text, &base).into_iter().filter(|(r, _)| r.contains("conditions_param") || r.contains("validonly_param")) {
        println!("{rel} -> {canonical:?}");
    }
    for rel in misplaced_links(&text, &base) {
        println!("misplaced: {rel}");
    }
}
