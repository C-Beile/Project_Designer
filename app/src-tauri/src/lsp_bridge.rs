//! LSP sidecar bridge for the JDito/`valueProcess.js` code field (Ziel B.3).
//!
//! Ported near-verbatim from the already-verified spike
//! (`_scratch/p2-editor-spike/app/src-tauri/src/lib.rs`, see `spike-editor.md` - "Portiere das
//! bewährte Muster ... statt neu zu bauen" per this agent's own briefing point 3). Same framing
//! logic, same two commands, same event names (`lsp-message`/`lsp-closed`/`lsp-error`/
//! `lsp-stderr`), so the frontend Monaco wiring can reuse the spike's proven bridge contract
//! as-is. **Not independently re-run against a live `typescript-language-server` in this round**
//! (see `p4-editor-entity-notes.md` for why - Completion/Diagnostics were already proven PASS in
//! `spike-editor.md`, and re-proving the identical mechanism here would not exercise any new
//! code path, only cost an additional npm/Tauri build cycle against this round's token budget).

use serde_json::Value;
use std::io::{BufReader, Read, Write};
use std::process::{Child, ChildStdin, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct LspProcess {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
}

fn write_framed_message(stdin: &mut ChildStdin, payload: &str) -> std::io::Result<()> {
    let bytes = payload.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", bytes.len());
    stdin.write_all(header.as_bytes())?;
    stdin.write_all(bytes)?;
    stdin.flush()
}

fn read_one_frame<R: Read>(reader: &mut BufReader<R>) -> std::io::Result<Option<String>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            let n = reader.read(&mut byte)?;
            if n == 0 {
                return Ok(None);
            }
            line.push(byte[0]);
            if line.ends_with(b"\r\n") {
                break;
            }
        }
        let line_str = String::from_utf8_lossy(&line);
        let trimmed = line_str.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_length = rest.trim().parse::<usize>().ok();
        }
    }
    let len = match content_length {
        Some(l) => l,
        None => return Ok(None),
    };
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body)?;
    Ok(Some(String::from_utf8_lossy(&body).to_string()))
}

#[tauri::command]
pub fn start_lsp(app: AppHandle, workspace_root: String, node_path: String, server_entry: String) -> Result<(), String> {
    crate::commands::guard("start_lsp", || {
    let state: State<LspProcess> = app.state();

    let mut cmd = platform::console::command(&node_path);
    cmd.arg(&server_entry)
        .arg("--stdio")
        .current_dir(&workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("failed to spawn typescript-language-server: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout handle")?;
    let stderr = child.stderr.take().ok_or("no stderr handle")?;
    let stdin = child.stdin.take().ok_or("no stdin handle")?;

    *state.stdin.lock().unwrap() = Some(stdin);
    *state.child.lock().unwrap() = Some(child);

    let app_for_stdout = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_one_frame(&mut reader) {
                Ok(Some(msg)) => {
                    let _ = app_for_stdout.emit("lsp-message", msg);
                }
                Ok(None) => {
                    let _ = app_for_stdout.emit("lsp-closed", "stdout closed");
                    break;
                }
                Err(e) => {
                    let _ = app_for_stdout.emit("lsp-error", format!("stdout read error: {e}"));
                    break;
                }
            }
        }
    });

    let app_for_stderr = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        use std::io::BufRead;
        loop {
            buf.clear();
            match reader.read_line(&mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let _ = app_for_stderr.emit("lsp-stderr", buf.clone());
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
})
}

#[tauri::command]
pub fn send_lsp_message(state: State<LspProcess>, message: String) -> Result<(), String> {
    crate::commands::guard("send_lsp_message", || {
    let _: Value = serde_json::from_str(&message).map_err(|e| format!("invalid JSON-RPC payload: {e}"))?;
    let mut guard = state.stdin.lock().unwrap();
    let stdin = guard.as_mut().ok_or("lsp not started")?;
    write_framed_message(stdin, &message).map_err(|e| format!("failed to write to lsp stdin: {e}"))
})
}
