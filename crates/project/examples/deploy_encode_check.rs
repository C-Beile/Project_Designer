//! Prints what the deploy would write for chosen models, to compare with the rows of a deployed
//! system: `deploy_encode_check <project> <type/name>...` prints `name kind byte-length title`.
//! With `--out <dir>` the encoded text is also written to `<dir>/<name>.xml`.

use deploy::deploy_encode::{encode_model, kind_of, title_of};
use std::path::PathBuf;

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let out = args.iter().position(|a| a == "--out").map(|i| {
        let dir = args.remove(i + 1);
        args.remove(i);
        PathBuf::from(dir)
    });
    let project = PathBuf::from(args.remove(0));
    let dist = project.join("dist");
    for key in args {
        let (folder, name) = key.split_once('/').expect("keys look like type/name");
        let main = dist.join(folder).join(name).join(format!("{name}.aod"));
        match encode_model(&dist, &main) {
            Ok(xml) => {
                println!("{name}\t{}\t{}\t{}", kind_of(folder).unwrap_or(-1), xml.len(), title_of(&xml).unwrap_or_default());
                if let Some(dir) = &out {
                    std::fs::create_dir_all(dir).unwrap();
                    std::fs::write(dir.join(format!("{name}.xml")), xml).unwrap();
                }
            }
            Err(e) => println!("{name}\tERROR {e}"),
        }
    }
}
