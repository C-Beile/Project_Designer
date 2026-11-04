//! Writes the property catalog of one Designer installation as JSON, for the copy that ships with
//! the app (so the app works on machines without an ADITO Designer):
//! `dump_catalog <designer install folder> <output.json>`.

use forge_app_core::catalog::load_catalog;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        eprintln!("usage: dump_catalog <designer install folder> <output.json>");
        std::process::exit(2);
    }
    match load_catalog(Path::new(&args[0]), None) {
        Ok(catalog) => {
            let json = serde_json::to_string(&catalog).expect("the catalog serialises");
            std::fs::write(&args[1], json).expect("the output file can be written");
            println!("catalog written to {}", args[1]);
        }
        Err(e) => {
            eprintln!("catalog not read: {e}");
            std::process::exit(1);
        }
    }
}
