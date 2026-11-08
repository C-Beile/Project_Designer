//! `snapshot_check <project> <data_dir> <out_dir>`: mirrors the project like a transpile does, times it, then runs the built-in engine on the snapshot into `<out_dir>`.

use native_transpiler::{IncrementalEngine, OwnEngine};
use std::path::Path;
use std::time::Instant;

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let (project, data, out) = (Path::new(&a[0]), Path::new(&a[1]), Path::new(&a[2]));
    for round in 1..=2 {
        let t = Instant::now();
        let snap = match project::transpile_action::try_snapshot_project(project, data) {
            Ok(s) => s,
            Err(e) => {
                println!("snapshot failed: {e}");
                return;
            }
        };
        println!("snapshot {round}: {:?} in {:.2}s", snap, t.elapsed().as_secs_f32());
        if round == 2 {
            std::env::set_var("FORGE_INCREMENTAL_CACHE_DIR", data.join("transpile-cache"));
            let _ = std::fs::remove_dir_all(out);
            std::fs::create_dir_all(out).unwrap();
            let t = Instant::now();
            let r = IncrementalEngine.run(&snap, out);
            println!("engine: {:?} in {:.1}s", r.is_ok(), t.elapsed().as_secs_f32());
        }
    }
}
