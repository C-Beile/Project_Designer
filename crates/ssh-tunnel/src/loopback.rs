//! Zusatzadressen `127.0.200.x` (eine je Dienst, mit dem echten Port). Windows und Linux kennen sie von selbst.
//! macOS kennt nur `127.0.0.1`: dort legt eine einmalige Einrichtung (Admin-Passwort) die Adressen dauerhaft an.
//! Ohne sie arbeitet der Tunnel trotzdem, mit `127.0.0.1` und dem echten oder einem freien Port.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LoopbackStatus {
    /// Die Adressen `127.0.200.x` sind nutzbar.
    pub available: bool,
    /// Auf diesem System ist eine Einrichtung nötig und möglich (macOS).
    pub setup_possible: bool,
}

pub fn status() -> LoopbackStatus {
    LoopbackStatus { available: crate::tunnels::extra_loopback_available(), setup_possible: cfg!(target_os = "macos") }
}

#[cfg(target_os = "macos")]
const LABEL: &str = "org.aditotunnels.loopback";
#[cfg(target_os = "macos")]
const ADDRESSES: u8 = 32;

/// Das Skript, das mit Admin-Rechten läuft. Es enthält nur feste Werte, keine Eingaben des Benutzers.
#[cfg(any(target_os = "macos", test))]
fn setup_script(label: &str, count: u8) -> String {
    let aliases: Vec<String> = (1..=count).map(|n| format!("/sbin/ifconfig lo0 alias 127.0.200.{n} up")).collect();
    let commands = aliases.join("; ");
    let plist = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n<key>Label</key><string>{label}</string>\n<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>{commands}</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n"
    );
    format!(
        "set -e\ncat > /Library/LaunchDaemons/{label}.plist <<'PLIST_END'\n{plist}PLIST_END\nchown root:wheel /Library/LaunchDaemons/{label}.plist\nchmod 644 /Library/LaunchDaemons/{label}.plist\n/bin/launchctl bootout system/{label} 2>/dev/null || true\n/bin/launchctl bootstrap system /Library/LaunchDaemons/{label}.plist\n{commands}\n"
    )
}

/// Legt die Adressen an und sorgt dafür, dass sie nach einem Neustart wieder da sind. Fragt einmal nach dem Admin-Passwort.
#[cfg(target_os = "macos")]
pub fn setup() -> Result<(), String> {
    let script = std::env::temp_dir().join(format!("dito-loopback-{}.sh", std::process::id()));
    std::fs::write(&script, setup_script(LABEL, ADDRESSES)).map_err(|e| format!("The set-up script could not be written: {e}"))?;
    let apple = format!("do shell script \"/bin/sh '{}'\" with administrator privileges", script.display());
    let output = std::process::Command::new("osascript").arg("-e").arg(apple).output();
    let _ = std::fs::remove_file(&script);
    let output = output.map_err(|e| format!("osascript could not be started: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let text = String::from_utf8_lossy(&output.stderr);
    if text.contains("-128") || text.to_ascii_lowercase().contains("user canceled") {
        return Err("The set-up was cancelled.".into());
    }
    Err(format!("The set-up failed: {}", text.trim()))
}

#[cfg(not(target_os = "macos"))]
pub fn setup() -> Result<(), String> {
    Err("No set-up is needed on this system.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_script_sets_up_every_address_and_a_start_up_job() {
        let script = setup_script("org.example.loopback", 3);
        assert!(script.contains("ifconfig lo0 alias 127.0.200.1 up; /sbin/ifconfig lo0 alias 127.0.200.2 up; /sbin/ifconfig lo0 alias 127.0.200.3 up"));
        assert!(script.contains("/Library/LaunchDaemons/org.example.loopback.plist"));
        assert!(script.contains("<key>RunAtLoad</key><true/>"));
        assert!(!script.contains("127.0.200.4"));
    }

    #[test]
    fn status_reports_the_system() {
        let s = status();
        assert_eq!(s.setup_possible, cfg!(target_os = "macos"));
        #[cfg(windows)]
        assert!(s.available);
    }
}
