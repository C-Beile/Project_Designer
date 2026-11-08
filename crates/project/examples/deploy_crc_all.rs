//! Prints `name<TAB>kind<TAB>crc32` of the row the deploy would write for every model of the
//! project's `dist`, to compare with `SELECT ID, CRC32(XMLDATA)` on a deployed system:
//! `deploy_crc_all <project>`.

use deploy::system_deploy::collect_local_models;
use std::path::PathBuf;

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in bytes {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

fn main() {
    let project = PathBuf::from(std::env::args().nth(1).expect("usage: deploy_crc_all <project>"));
    match collect_local_models(&project) {
        Ok(models) => {
            for m in models {
                let name = m.key.split_once('/').map(|(_, n)| n).unwrap_or(&m.key);
                println!("{name}\t{}\t{}", m.kind, crc32(m.content.as_bytes()));
            }
        }
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
