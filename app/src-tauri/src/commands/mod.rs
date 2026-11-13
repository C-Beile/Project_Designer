//! Tauri-Befehle, nach Feature gruppiert. Die Handler-Liste steht weiterhin in `lib.rs`.

pub mod index;
pub mod dialogs;
pub mod editor;
pub mod files;
pub mod misc;
pub mod plugins;
pub mod project;
pub mod rest;
pub mod settings;
pub mod transpile;

// ---------- Panic-Schutz für Tauri-Befehle ----------
// Ein Panic in einem Befehl darf weder die App beenden noch das Versprechen im Frontend offen lassen.
// `guard`/`guard_async` fangen ihn ab, schreiben ihn ins Protokoll und liefern einen Fehler (bei `Result`) oder einen leeren Wert.

use std::future::Future;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::pin::Pin;
use std::task::{Context, Poll};

/// Was ein Befehl nach einem Panic zurückgibt.
pub trait PanicFallback {
    fn on_panic(command: &str, message: String) -> Self;
}

impl<T> PanicFallback for Result<T, String> {
    fn on_panic(command: &str, message: String) -> Self {
        Err(format!("Interner Fehler in '{command}': {message}"))
    }
}
impl<T> PanicFallback for Option<T> {
    fn on_panic(_: &str, _: String) -> Self {
        None
    }
}
impl<T> PanicFallback for Vec<T> {
    fn on_panic(_: &str, _: String) -> Self {
        Vec::new()
    }
}
impl PanicFallback for bool {
    fn on_panic(_: &str, _: String) -> Self {
        false
    }
}
impl PanicFallback for () {
    fn on_panic(_: &str, _: String) -> Self {}
}

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload.downcast_ref::<&str>().map(|s| (*s).to_string()).or_else(|| payload.downcast_ref::<String>().cloned()).unwrap_or_else(|| "unbekannter Panic".to_string())
}

fn report(command: &str, message: &str) {
    let _ = app_base::crashlog::write_entry("ERROR", &format!("Panic im Befehl {command}: {message}"));
}

/// Führt den Rumpf eines Befehls aus; ein Panic wird zum Fehlerwert.
pub fn guard<T: PanicFallback>(command: &str, body: impl FnOnce() -> T) -> T {
    match catch_unwind(AssertUnwindSafe(body)) {
        Ok(v) => v,
        Err(payload) => {
            let message = panic_message(&*payload);
            report(command, &message);
            T::on_panic(command, message)
        }
    }
}

struct Guarded<'a, F> {
    command: &'a str,
    inner: Pin<Box<F>>,
}

impl<F: Future> Future for Guarded<'_, F>
where
    F::Output: PanicFallback,
{
    type Output = F::Output;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let command = self.command;
        match catch_unwind(AssertUnwindSafe(|| self.inner.as_mut().poll(cx))) {
            Ok(p) => p,
            Err(payload) => {
                let message = panic_message(&*payload);
                report(command, &message);
                Poll::Ready(<F::Output as PanicFallback>::on_panic(command, message))
            }
        }
    }
}

/// Wie `guard` für `async`-Befehle: ein Panic in einem Schritt des Futures wird zum Fehlerwert.
pub fn guard_async<'a, F: Future>(command: &'a str, fut: F) -> impl Future<Output = F::Output> + 'a
where
    F::Output: PanicFallback,
    F: 'a,
{
    Guarded { command, inner: Box::pin(fut) }
}

/// Fuehrt blockierende Arbeit ausserhalb des UI-Threads aus; ein abgestuerzter Task wird zum Fehlertext.
pub(crate) async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod guard_tests {
    use super::*;

    #[test]
    fn panic_in_result_command_becomes_error_text() {
        let r: Result<u32, String> = guard("demo", || -> Result<u32, String> { panic!("kaputt") });
        let e = r.unwrap_err();
        assert!(e.contains("demo") && e.contains("kaputt"), "{e}");
    }

    #[test]
    fn panic_in_other_commands_gives_empty_values() {
        assert_eq!(guard("a", || -> Option<u8> { panic!("x") }), None);
        assert!(guard("b", || -> Vec<u8> { panic!("x") }).is_empty());
        assert!(!guard("c", || -> bool { panic!("x") }));
    }

    #[test]
    fn normal_values_pass_through() {
        assert_eq!(guard("ok", || -> Result<u8, String> { Ok(7) }), Ok(7));
    }

    #[test]
    fn panic_in_async_command_becomes_error_text() {
        let r = tauri::async_runtime::block_on(guard_async("demo_async", async { if true { panic!("async kaputt") } else { Ok::<u8, String>(1) } }));
        assert!(r.unwrap_err().contains("async kaputt"));
    }
}
