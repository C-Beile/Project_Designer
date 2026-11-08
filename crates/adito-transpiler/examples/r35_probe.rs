// One-off R35 investigation tool (Clemens' direct instruction, 2026-09-27): tests two
// hypotheses for why the reference transpiler (`NbexecTranspilerRunner`) leaves `%aditoprj%`
// references unresolved even against a brand-new project copy (RISKS.md R35):
//   (a) a missing "full transpile" trigger (the CLI silently runs some partial/incremental
//       mode by default), visible directly in its own stdout log ("Full Transpile" vs.
//       "Partial Transpile" markers) - independent of which userdir is used.
//   (b) stale state in the SHARED scratch userdir/cachedir (`_scratch\p3-transpiler-wrapper\
//       userdir`), reused unchanged by every P5 harness run since `differential-harness` -
//       tested by re-running against the exact same project copy with a userdir that has NEVER
//       processed any real corpus project (only the four `de.adito.aditoweb.nbm.nodejs` plugin
//       seed artifacts, freshly copied from the real interactive designer profile, see
//       spike-transpiler-wrapper.md).
//
// Not part of the crate's normal API surface - a throwaway `cargo run --example` probe, kept
// only long enough to answer the question for `p5-incremental-notes.md` / RISKS.md R35.
//
// Usage: cargo run -p transpiler --release --example r35_probe -- <project_home> <user_dir> <label>

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use transpiler::{EventSink, LogStream, TranspileEvent, TranspilerConfig, TranspilerRunner, NbexecTranspilerRunner};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: r35_probe <project_home> <user_dir> <label>");
        std::process::exit(2);
    }
    let project_home = PathBuf::from(&args[1]);
    let user_dir = PathBuf::from(&args[2]);
    let label = &args[3];

    let install_dir = PathBuf::from(r"C:\Users\ClemensBeile\Desktop\ADITO_Designer\Adito_designer\ADITODesigner2026.0.4");
    let config = TranspilerConfig::new(install_dir, user_dir).with_timeout(std::time::Duration::from_secs(900));
    let runner = NbexecTranspilerRunner::new(config);

    let lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let lines_for_sink = lines.clone();
    let sink: EventSink = Arc::new(move |event| {
        if let TranspileEvent::Log { stream, line } = &event {
            let prefix = match stream {
                LogStream::Stdout => "OUT",
                LogStream::Stderr => "ERR",
            };
            lines_for_sink.lock().unwrap().push(format!("[{prefix}] {line}"));
        }
    });

    println!("[{label}] starting reference transpiler run against {} with userdir {}", project_home.display(), args[2]);
    let result = runner.run(&project_home, sink);

    let log_path = project_home.join(format!("r35-probe-{label}.log"));
    let captured = lines.lock().unwrap();
    std::fs::write(&log_path, captured.join("\n")).expect("failed to write probe log");

    match result {
        Ok(outcome) => {
            println!("[{label}] exit_code={:?} outcome={:?}", outcome.exit_code, outcome.outcome);
        }
        Err(e) => {
            println!("[{label}] runner error: {e}");
        }
    }

    let full_count = captured.iter().filter(|l| l.contains("Full Transpile")).count();
    let partial_count = captured.iter().filter(|l| l.contains("Partial Transpile")).count();
    println!("[{label}] log lines captured: {}, 'Full Transpile' markers: {}, 'Partial Transpile' markers: {}", captured.len(), full_count, partial_count);
    println!("[{label}] full log written to {}", log_path.display());
}
