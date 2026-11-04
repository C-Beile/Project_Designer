//! Writes the icon set of one Designer installation as JSON, for the copy that ships with the app
//! (so the icon chooser works on machines without an ADITO Designer):
//! `dump_icons <designer install folder> <output.json>`.
//! The output maps an icon id as used in `iconId` (`VAADIN:HOME`, `NEON:IMPORT`) to its SVG markup.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;

fn read_svgs(jar: &Path, prefix: &str, id_prefix: &str, out: &mut BTreeMap<String, String>) -> Result<(), String> {
    let file = std::fs::File::open(jar).map_err(|e| format!("{}: {e}", jar.display()))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let Some(rest) = name.strip_prefix(prefix) else { continue };
        let Some(stem) = rest.strip_suffix(".svg") else { continue };
        if stem.contains('/') {
            continue;
        }
        let mut svg = String::new();
        entry.read_to_string(&mut svg).map_err(|e| e.to_string())?;
        let svg = clean(&svg);
        out.insert(format!("{id_prefix}:{}", stem.to_uppercase()), svg);
    }
    Ok(())
}

/// Drops the XML prolog and doctype and makes the colour and size follow the surrounding text.
fn clean(svg: &str) -> String {
    let start = svg.find("<svg").unwrap_or(0);
    let mut body = svg[start..].to_string();
    body = body.replace("#$$$COLOR$$$", "currentColor").replace("$$$WIDTH$$$", "16").replace("$$$HEIGHT$$$", "16");
    body.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        eprintln!("usage: dump_icons <designer install folder> <output.json>");
        std::process::exit(2);
    }
    let lib = Path::new(&args[0]).join("lib").join("designer");
    let mut icons = BTreeMap::new();
    let vaadin = lib.join("platform/modules/de-adito-nbm-de-adito-vaadin-icons.jar");
    let neon = lib.join("aditoonline/modules/ext/de.adito.designer.netbeans.VaadinIcons/de-adito/neon-icons-enum.jar");
    if let Err(e) = read_svgs(&vaadin, "de/adito/aditoweb/nbm/vaadinicons/svg_templates/", "VAADIN", &mut icons) {
        eprintln!("vaadin icons not read: {e}");
        std::process::exit(1);
    }
    if let Err(e) = read_svgs(&neon, "META-INF/resources/fonts/images/icons/", "NEON", &mut icons) {
        eprintln!("neon icons not read: {e}");
        std::process::exit(1);
    }
    std::fs::write(&args[1], serde_json::to_string(&icons).expect("the icons serialise")).expect("the output file can be written");
    println!("{} icons written to {}", icons.len(), args[1]);
}
