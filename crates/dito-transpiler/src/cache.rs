// Der Cache: eine Datei je Projekt statt Tausender kleiner Dateien (wegen des Virenscanners).
//
// Stufe 1 (siehe Plan, Abschnitt 6): Aus allen Eingaben (Modulliste, jede Datei mit Pfad, Größe und Änderungszeit, Engine-Stand,
// Format) wird ein Fingerabdruck gebildet. Ist er gleich dem im Cache, steht das fertige Ergebnis schon da und der Lauf
// ist nach dem Lesen der Dateiliste fertig. Sonst wird ganz neu gebaut und der Cache neu geschrieben (im Hintergrund).
//
// Jede Änderung der Logik (Regeln, Reihenfolgen, Writer) erhöht `ENGINE_REVISION`. Sonst liefert der Cache das alte Ergebnis.
//
// Racy-mtime (wie bei Git): Hat sich eine Datei in den letzten Sekunden vor dem Speichern geändert, wird nicht gespeichert,
// denn eine weitere Änderung in derselben Zeitspanne hätte dieselbe Änderungszeit.

use std::io;
use std::path::{Path, PathBuf};

use xxhash_rust::xxh3::Xxh3;

use crate::api::{Diagnostic, Severity};
use crate::discover::SourceModule;
use crate::format::FormatId;
use crate::overlay::Overlay;
use crate::pipeline::{Content, OutputFile};

/// Bei jeder Logikänderung erhöhen.
pub const ENGINE_REVISION: u32 = 1;

const MAGIC: &[u8; 4] = b"DTC1";
/// Unterhalb dieser Zeitspanne vor dem Speichern gilt eine Änderung als "gerade eben".
const RACY_WINDOW_NS: u64 = 3_000_000_000;

/// Fingerabdruck aller Eingaben und die jüngste Änderungszeit darunter.
pub fn fingerprint(modules: &[SourceModule], overlay: &Overlay, format: FormatId) -> (u64, u64) {
    let mut h = Xxh3::new();
    h.update(&ENGINE_REVISION.to_le_bytes());
    h.update(&[format as u8]);
    for m in modules {
        h.update(m.name.as_bytes());
        h.update(&[0]);
        h.update(m.root.to_string_lossy().as_bytes());
        h.update(&[u8::from(m.is_project), 0]);
    }
    let mut newest = 0u64;
    for (key, source) in overlay.iter() {
        h.update(key.as_bytes());
        h.update(&[0]);
        h.update(&(source.module as u32).to_le_bytes());
        h.update(&source.size.to_le_bytes());
        h.update(&source.mtime_ns.to_le_bytes());
        newest = newest.max(source.mtime_ns);
    }
    (h.digest(), newest)
}

/// Ort der Cache-Datei eines Projekts: `%LOCALAPPDATA%\DitoDesigner\transpile-cache\<Hash des Pfads>.bin`, nie im Projekt.
pub fn default_cache_file(project_root: &Path) -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))
        .unwrap_or_else(std::env::temp_dir);
    let id = xxhash_rust::xxh3::xxh3_64(project_root.to_string_lossy().to_lowercase().as_bytes());
    base.join("DitoDesigner").join("transpile-cache").join(format!("{id:016x}.bin"))
}

pub struct CachedBuild {
    pub files: Vec<OutputFile>,
    pub diagnostics: Vec<Diagnostic>,
}

struct Writer(Vec<u8>);

impl Writer {
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn bytes(&mut self, b: &[u8]) {
        self.u32(b.len() as u32);
        self.0.extend_from_slice(b);
    }
    fn str(&mut self, s: &str) {
        self.bytes(s.as_bytes());
    }
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.0.len() < n {
            return None;
        }
        let (head, tail) = self.0.split_at(n);
        self.0 = tail;
        Some(head)
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    fn bytes(&mut self) -> Option<&'a [u8]> {
        let n = self.u32()? as usize;
        self.take(n)
    }
    fn string(&mut self) -> Option<String> {
        String::from_utf8(self.bytes()?.to_vec()).ok()
    }
}

fn severity_code(s: Severity) -> u8 {
    match s {
        Severity::Info => 0,
        Severity::Warning => 1,
        Severity::Error => 2,
    }
}

fn severity_from(code: u8) -> Severity {
    match code {
        0 => Severity::Info,
        1 => Severity::Warning,
        _ => Severity::Error,
    }
}

/// Schreibt den Cache atomar (Temp-Datei, dann umbenennen). `newest_input_ns`: jüngste Änderungszeit der Eingaben.
/// Gibt `Ok(false)` zurück, wenn nicht gespeichert wurde (racy).
pub fn store(path: &Path, fingerprint: u64, newest_input_ns: u64, files: &[OutputFile], diagnostics: &[Diagnostic]) -> io::Result<bool> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);
    if newest_input_ns + RACY_WINDOW_NS > now {
        return Ok(false);
    }
    let mut w = Writer(Vec::with_capacity(1 << 20));
    w.u32(files.len() as u32);
    for f in files {
        w.str(&f.path);
        match &f.content {
            Content::FromDisk(p) => {
                w.0.push(0);
                w.str(&p.to_string_lossy());
            }
            Content::Bytes(b) => {
                w.0.push(1);
                w.bytes(b);
            }
        }
    }
    w.u32(diagnostics.len() as u32);
    for d in diagnostics {
        w.0.push(severity_code(d.severity));
        w.str(&d.message);
        w.u32(d.sources.len() as u32);
        for s in &d.sources {
            w.str(&s.to_string_lossy());
        }
    }
    let packed = lz4_flex::compress_prepend_size(&w.0);
    let mut out = Vec::with_capacity(packed.len() + 24);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&fingerprint.to_le_bytes());
    out.extend_from_slice(&packed);

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &out)?;
    std::fs::rename(&tmp, path)?;
    Ok(true)
}

/// Liest den Cache, wenn er zum Fingerabdruck passt. Alles andere (fehlt, fremder Stand, kaputt) ist `None`.
pub fn load(path: &Path, fingerprint: u64) -> Option<CachedBuild> {
    let data = std::fs::read(path).ok()?;
    if data.len() < 12 || &data[..4] != MAGIC || data[4..12] != fingerprint.to_le_bytes() {
        return None;
    }
    let body = lz4_flex::decompress_size_prepended(&data[12..]).ok()?;
    let mut r = Reader(&body);
    let count = r.u32()? as usize;
    let mut files = Vec::with_capacity(count);
    for _ in 0..count {
        let path = r.string()?;
        let kind = *r.take(1)?.first()?;
        let content = match kind {
            0 => Content::FromDisk(PathBuf::from(r.string()?)),
            1 => Content::Bytes(r.bytes()?.to_vec()),
            _ => return None,
        };
        files.push(OutputFile { path, content });
    }
    let dcount = r.u32()? as usize;
    let mut diagnostics = Vec::with_capacity(dcount);
    for _ in 0..dcount {
        let severity = severity_from(*r.take(1)?.first()?);
        let message = r.string()?;
        let n = r.u32()? as usize;
        let mut sources = Vec::with_capacity(n);
        for _ in 0..n {
            sources.push(PathBuf::from(r.string()?));
        }
        diagnostics.push(Diagnostic { severity, message, sources });
    }
    Some(CachedBuild { files, diagnostics })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (Vec<OutputFile>, Vec<Diagnostic>) {
        (
            vec![
                OutputFile { path: "a/b.aod".into(), content: Content::Bytes(b"<x/>\n".to_vec()) },
                OutputFile { path: "doc/c.png".into(), content: Content::FromDisk(PathBuf::from("C:/m/doc/c.png")) },
            ],
            vec![Diagnostic { severity: Severity::Warning, message: "hi".into(), sources: vec![PathBuf::from("x")] }],
        )
    }

    #[test]
    fn roundtrip_and_fingerprint_check() {
        let dir = std::env::temp_dir().join("dito-transpiler-cache-test");
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("p.bin");
        let (files, diags) = sample();
        // Eingaben von gestern: nicht racy.
        assert!(store(&file, 42, 1, &files, &diags).unwrap());
        let hit = load(&file, 42).expect("hit");
        assert_eq!(hit.files.len(), 2);
        assert!(matches!(&hit.files[0].content, Content::Bytes(b) if b == b"<x/>\n"));
        assert!(matches!(&hit.files[1].content, Content::FromDisk(p) if p == &PathBuf::from("C:/m/doc/c.png")));
        assert_eq!(hit.diagnostics[0].message, "hi");
        assert!(load(&file, 43).is_none(), "anderer Fingerabdruck");
        std::fs::write(&file, b"junk").unwrap();
        assert!(load(&file, 42).is_none(), "kaputte Datei");
    }

    #[test]
    fn very_recent_inputs_are_not_stored() {
        let dir = std::env::temp_dir().join("dito-transpiler-cache-racy");
        let file = dir.join("p.bin");
        let _ = std::fs::remove_dir_all(&dir);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() as u64;
        let (files, diags) = sample();
        assert!(!store(&file, 1, now, &files, &diags).unwrap());
        assert!(!file.exists());
    }
}
