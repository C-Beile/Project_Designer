//! Manual live check of the Services tab backend: `db_live <tunnelconfig.xml> <serverconfig_system.xml> [key.ppk]`.
//! Prints only status and row counts, never credentials.

use forge_app_core::db_session::DbManager;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 {
        eprintln!("usage: db_live <tunnelconfig.xml> <serverconfig_system.xml> [key.ppk]");
        std::process::exit(2);
    }
    let manager = DbManager::default();
    let key = args.get(2).map(Path::new);
    match manager.connect(Path::new(&args[0]), Path::new(&args[1]), key) {
        Ok(status) => println!("connected: {status:?}"),
        Err(e) => {
            println!("connect failed: {e}");
            return;
        }
    }
    match manager.query("SELECT 1", false) {
        Ok(r) => println!("SELECT 1 -> {:?}", r.rows),
        Err(e) => println!("query failed: {e}"),
    }
    match manager.schema() {
        Ok(t) => println!("tables: {}", t.len()),
        Err(e) => println!("schema failed: {e}"),
    }
    println!("write attempt: {:?}", manager.query("DELETE FROM x", false).err());
    manager.disconnect();
    println!("after disconnect: {:?}", manager.status());
}