//! Child processes of the GUI app must never flash a console window on Windows. Every spawn in
//! the workspace goes through `command()` or `hide_console()`.

use std::ffi::OsStr;
use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Marks the command so that Windows starts it without a console window (no-op elsewhere).
pub fn hide_console(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// `Command::new` that already carries the no-console flag.
pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    hide_console(&mut cmd);
    cmd
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn hidden_command_still_runs() {
        let out = super::command("cmd").args(["/C", "echo ok"]).output().unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).contains("ok"));
    }
}
