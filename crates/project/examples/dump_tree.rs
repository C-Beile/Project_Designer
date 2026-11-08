// Dumps the wire-format property tree of one object as JSON (read-only), used to build UI fixtures from real data.
// Usage: cargo run --release --example dump_tree -p forge-app-core -- <file.aod> <out.json>
use forge_app_core::project_actor::ProjectActorHandle;

fn main() {
    let mut args = std::env::args().skip(1);
    let file = args.next().expect("aod file");
    let out = args.next().expect("output json");
    let actor = ProjectActorHandle::spawn();
    let tree = actor.get_property_tree(file.replace(std::path::MAIN_SEPARATOR, "/")).expect("tree");
    std::fs::write(out, serde_json::to_string(&tree).unwrap()).unwrap();
}
