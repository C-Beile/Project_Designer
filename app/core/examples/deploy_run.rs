//! Headless deploy of one project to one system: `deploy_run <project> <tunnelconfig.xml> <serverconfig_system.xml> [key.ppk] [--execute]`.
//! Without `--execute` it only reads and prints the plan. The write is limited to the clemens-onboarding dev system.
//! The password of the tunnel is taken from the environment variable FORGE_DEPLOY_TUNNEL_PASSWORD when no key file is given.

use forge_app_core::db_session::{DbManager, TunnelAuth};
use forge_app_core::system_db::{execute, plan, DeployOp};
use std::path::Path;

const ALLOWED_TARGET: &str = "dev-clemens-onboarding-htc1-adito-cloud";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let execute_flag = args.iter().any(|a| a == "--execute");
    let rest: Vec<&String> = args.iter().filter(|a| *a != "--execute").collect();
    if rest.len() < 3 {
        eprintln!("usage: deploy_run <project> <tunnelconfig.xml> <serverconfig_system.xml> [key.ppk] [--execute]");
        std::process::exit(2);
    }
    let project = Path::new(rest[0].as_str());
    let tunnel = Path::new(rest[1].as_str());
    let server = Path::new(rest[2].as_str());
    let tunnel_text = std::fs::read_to_string(tunnel).unwrap_or_default();
    if execute_flag && !tunnel_text.contains(ALLOWED_TARGET) {
        eprintln!("refused: --execute is only allowed for {ALLOWED_TARGET}");
        std::process::exit(3);
    }
    let manager = DbManager::default();
    let password = std::env::var("FORGE_DEPLOY_TUNNEL_PASSWORD").ok().filter(|p| !p.is_empty());
    let key = rest.get(3).map(|k| Path::new(k.as_str()));
    let auth = match (&password, key) {
        (Some(p), None) => TunnelAuth::Basic { password: p },
        (_, k) => TunnelAuth::Key(k),
    };
    match manager.connect_with(tunnel, server, &auth) {
        Ok(status) => println!("connected: {status:?}"),
        Err(e) => {
            println!("connect failed: {e}");
            std::process::exit(1);
        }
    }
    let current = match plan(&manager, project, false, None) {
        Ok(p) => p,
        Err(e) => {
            println!("plan failed: {e}");
            std::process::exit(1);
        }
    };
    let count = |op: DeployOp| current.items.iter().filter(|i| i.op == op).count();
    println!("target {}: {} added, {} changed, {} deleted", current.target, count(DeployOp::I), count(DeployOp::U), count(DeployOp::D));
    for item in current.items.iter().take(40) {
        println!("  {:?} {}", item.op, item.key);
    }
    if execute_flag {
        let keys: Vec<String> = current.items.iter().filter(|i| i.selected_by_default).map(|i| i.key.clone()).collect();
        match execute(&manager, project, &keys, false, None, true) {
            Ok(outcome) => println!("deployed {} models to {}", outcome.executed, outcome.target),
            Err(e) => println!("deploy failed: {e}"),
        }
    }
    manager.disconnect();
}
