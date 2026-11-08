//! Liquibase "Update" for the changelogs of a database alias (`.liquibase/<alias>/changelog.xml`).
//!
//! Business rules: the update is run by the same Liquibase library and Java runtime that the
//! original Designer's Liquibase plugin ships, so the checksums in `DATABASECHANGELOG` stay
//! compatible with what the original Designer and the servers wrote. The master changelog must be
//! named `changelog.xml`; its includes are relative to it. Nothing here runs on its own: the caller
//! confirms the target database first. The database password only travels in a short-lived
//! defaults file and never appears in a command line or in the log.

pub mod plugin;

pub use plugin::{InstallDirProvider, LiquibasePlugin};

use database::db_session::DbManager;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;

/// Java runtime and class path of the original Designer's Liquibase plugin.
#[derive(Debug, Clone)]
pub struct Toolchain {
    pub java: PathBuf,
    pub classpath: Vec<PathBuf>,
}

#[derive(Clone)]
pub struct JdbcTarget {
    pub url: String,
    pub user: String,
    pub password: String,
}

impl std::fmt::Debug for JdbcTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JdbcTarget").field("url", &self.url).field("user", &"<redacted>").field("password", &"<redacted>").finish()
    }
}

const MAIN_CLASS: &str = "liquibase.integration.commandline.Main";
const MARIADB_DRIVER: &str = "org.mariadb.jdbc.Driver";

fn find_file(root: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dirs.push(path);
        } else if path.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(name)).unwrap_or(false) {
            return Some(path);
        }
    }
    if depth == 0 {
        return None;
    }
    dirs.into_iter().find_map(|d| find_file(&d, name, depth - 1))
}

pub use app_base::designer_paths::designer_userdirs;

/// Looks up the Java runtime of the Designer installation and the jars of the Liquibase plugin.
pub fn discover_toolchain(install_dir: &Path, userdirs: &[PathBuf]) -> Result<Toolchain, String> {
    let java = if cfg!(windows) { install_dir.join("jre").join("bin").join("java.exe") } else { install_dir.join("jre").join("bin").join("java") };
    if !java.is_file() {
        return Err(format!("The Java runtime of the Designer was not found in {}. Choose the Designer installation in Tools > Options.", install_dir.display()));
    }
    let modules = install_dir.join("lib").join("designer").join("aditoonline").join("modules");
    let liquibase = userdirs
        .iter()
        .find_map(|u| find_file(&u.join("modules").join("ext").join("de.adito.aditoweb.nbm.liquibase"), "liquibase-core.jar", 3))
        .ok_or("The Liquibase plugin is not installed in the Designer (liquibase-core.jar not found). Install it in the Designer first.")?;
    let driver = modules.join("mariadb_java_client.jar");
    if !driver.is_file() {
        return Err(format!("The MariaDB driver was not found: {}", driver.display()));
    }
    let mut classpath = vec![liquibase, driver];
    let jaxb = modules.join("jaxb_api.jar");
    if jaxb.is_file() {
        classpath.push(jaxb);
    }
    for dep in ["snakeyaml.jar", "commons-lang3.jar"] {
        if let Some(p) = userdirs.iter().find_map(|u| find_file(&u.join("modules").join("ext"), dep, 4)) {
            classpath.push(p);
        }
    }
    Ok(Toolchain { java, classpath })
}

/// Java `.properties` escaping: `\uXXXX` for everything outside ASCII, so umlauts in a path or a
/// password survive the ISO-8859-1 reading of Liquibase.
pub fn properties_escape(value: &str) -> String {
    let mut out = String::new();
    for (i, c) in value.chars().enumerate() {
        match c {
            '\\' => out.push_str("\\\\"),
            ':' | '=' | '#' | '!' => {
                out.push('\\');
                out.push(c);
            }
            ' ' if i == 0 => out.push_str("\\ "),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x80 => out.push(c),
            c => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{:04x}", unit));
                }
            }
        }
    }
    out
}

pub fn defaults_file_text(changelog: &Path, target: &JdbcTarget) -> String {
    format!(
        "changeLogFile={}\nurl={}\nusername={}\npassword={}\ndriver={}\nlogLevel=info\n",
        properties_escape(&changelog.to_string_lossy()),
        properties_escape(&target.url),
        properties_escape(&target.user),
        properties_escape(&target.password),
        MARIADB_DRIVER
    )
}

pub fn jdbc_url(local_port: u16, database: &str) -> String {
    format!("jdbc:mariadb://127.0.0.1:{local_port}/{database}")
}

/// The alias an alias definition belongs to (`<targetAliasName>`): a project alias such as
/// `THHIT_Data_alias` is part of `Data_alias`, which owns the database and the master changelog.
pub fn target_alias_of(aod_text: &str) -> Option<String> {
    let start = aod_text.find("<targetAliasName>")? + "<targetAliasName>".len();
    let end = aod_text[start..].find("</targetAliasName>")? + start;
    let name = aod_text[start..end].trim();
    if name.is_empty() { None } else { Some(name.to_string()) }
}

/// A changelog folder of an alias inside the project; the alias name is a plain file name.
pub fn changelog_dir(project_root: &Path, alias: &str) -> Result<PathBuf, String> {
    if alias.is_empty() || !alias.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("The alias name contains characters that are not allowed.".into());
    }
    let dir = project_root.join(".liquibase").join(alias);
    if !dir.join("changelog.xml").is_file() {
        return Err(format!("No changelog.xml found in {}. The master file of an alias must be named changelog.xml.", dir.display()));
    }
    Ok(dir)
}

struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn is_noise(line: &str) -> bool {
    line.starts_with("##") || line.trim().is_empty()
}

fn is_error_line(line: &str) -> bool {
    let l = line.to_ascii_uppercase();
    l.starts_with("SEVERE") || l.contains("EXCEPTION") || l.starts_with("UNEXPECTED ERROR") || l.starts_with("LIQUIBASE COMMAND") && l.contains("FAILED")
}

/// Runs `liquibase update` for the changelog folder against the target and reports every line of
/// Liquibase to `log` (error flag, text) with the credentials removed.
pub fn run_update(toolchain: &Toolchain, dir: &Path, target: &JdbcTarget, log: &(dyn Fn(bool, &str) + Sync)) -> Result<(), String> {
    let changelog = dir.join("changelog.xml");
    let temp_dir = std::env::temp_dir();
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let file_name = format!("dito-liquibase-{}-{unique}.properties", std::process::id());
    let defaults = TempFile(temp_dir.join(&file_name));
    std::fs::write(&defaults.0, defaults_file_text(&changelog, target)).map_err(|e| format!("The Liquibase settings file could not be written: {e}"))?;

    let sep = if cfg!(windows) { ";" } else { ":" };
    let classpath = toolchain.classpath.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>().join(sep);
    let mut cmd = platform::console::command(&toolchain.java);
    cmd.current_dir(&temp_dir)
        .args(["-Duser.language=en", "-Duser.country=US", "-Dfile.encoding=UTF-8", "-Dsun.stdout.encoding=UTF-8", "-Dsun.stderr.encoding=UTF-8", "-cp"])
        .arg(&classpath)
        .arg(MAIN_CLASS)
        .arg(format!("--defaultsFile={file_name}"))
        .arg("update")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Java could not be started: {e}"))?;
    let secrets = [target.user.as_str(), target.password.as_str()];
    let last_error = std::sync::Mutex::new(String::new());
    std::thread::scope(|scope| {
        let mut readers = Vec::new();
        if let Some(out) = child.stdout.take() {
            readers.push(Box::new(out) as Box<dyn std::io::Read + Send>);
        }
        if let Some(err) = child.stderr.take() {
            readers.push(Box::new(err) as Box<dyn std::io::Read + Send>);
        }
        for reader in readers {
            let last_error = &last_error;
            let secrets = &secrets;
            scope.spawn(move || {
                for line in BufReader::new(reader).split(b'\n').map_while(Result::ok) {
                    let text = String::from_utf8_lossy(&line).trim_end_matches('\r').to_string();
                    if is_noise(&text) {
                        continue;
                    }
                    let clean = ssh_tunnel::tunnel_core::scrub(&text, &secrets.iter().copied().filter(|s| !s.is_empty()).collect::<Vec<_>>());
                    let error = is_error_line(&clean);
                    if error {
                        *last_error.lock().unwrap() = clean.clone();
                    }
                    log(error, &clean);
                }
            });
        }
    });
    let status = child.wait().map_err(|e| e.to_string())?;
    drop(defaults);
    if status.success() {
        Ok(())
    } else {
        let detail = last_error.into_inner().unwrap_or_default();
        Err(if detail.is_empty() { format!("Liquibase stopped with {status}.") } else { format!("Liquibase update failed: {detail}") })
    }
}

#[derive(serde::Serialize)]
pub struct LiquibaseTarget {
    pub system: String,
    pub host: String,
    pub database: String,
}

#[derive(serde::Serialize)]
pub struct LiquibaseConnection {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    /// A tunnel to this host is open, so an update can reach it.
    pub reachable: bool,
}

#[derive(serde::Serialize)]
pub struct LiquibasePlan {
    /// The alias that owns the database and the master changelog.
    pub target_alias: String,
    /// The transpiled changelog of the target alias exists in `dist`.
    pub dist_ready: bool,
}

/// System key to work on: the given one or the active session, without the `|alias:` suffix of an
/// alias browser session.
pub fn liquibase_system(system: Option<String>, db: &DbManager) -> Result<String, String> {
    let key = system.or_else(|| db.active_system()).unwrap_or_default();
    let key = key.split("|alias:").next().unwrap_or("").to_string();
    if key.is_empty() || !db.activate(&key) {
        return Err("Connect a system first (Services > Connect); Liquibase needs the open session of a system.".to_string());
    }
    Ok(key)
}

/// An alias definition of the project belongs to a target alias (`THHIT_Data_alias` -> `Data_alias`);
/// that alias owns the connection and the master changelog the update runs.
pub fn plan(project_root: &Path, alias: &str) -> LiquibasePlan {
    let read = |base: PathBuf| std::fs::read_to_string(base.join("aliasDefinition").join(alias).join(format!("{alias}.aod"))).ok();
    let target = read(project_root.to_path_buf())
        .or_else(|| read(project_root.join("dist")))
        .and_then(|text| target_alias_of(&text))
        .unwrap_or_else(|| alias.to_string());
    let dist_ready = changelog_dir(&project_root.join("dist"), &target).is_ok();
    LiquibasePlan { target_alias: target, dist_ready }
}

/// Every database connection the system knows (ASYS_ALIASCONFIG), for the "Select Database Connection" list.
pub fn connections(db: &DbManager, system: Option<String>) -> Result<Vec<LiquibaseConnection>, String> {
    liquibase_system(system, db)?;
    let result = db.query("SELECT ALIASID, CAST(XMLDATA AS CHAR) FROM ASYS_ALIASCONFIG ORDER BY ALIASID", false)?;
    let mut out: Vec<LiquibaseConnection> = Vec::new();
    for row in result.rows {
        let mut cells = row.into_iter();
        let (Some(Some(alias)), Some(Some(xml))) = (cells.next(), cells.next()) else { continue };
        let Some(conn) = database::system_config::alias_db_connection(&xml) else { continue };
        if !out.iter().any(|c| c.alias == alias && c.host == conn.host && c.database == conn.database) {
            let reachable = db.forward_port_for(&conn.host, conn.port).is_some();
            out.push(LiquibaseConnection { alias, host: conn.host, port: conn.port, database: conn.database, reachable });
        }
    }
    Ok(out)
}

/// Where a Liquibase update of this alias would go; shown in the confirmation before anything runs.
/// `connection_alias` names the alias whose connection is used when the alias has none of its own.
pub fn target(db: &DbManager, system: Option<String>, alias: &str, connection_alias: Option<&str>) -> Result<LiquibaseTarget, String> {
    let system = liquibase_system(system, db)?;
    let conn = database::system_db::read_alias_db(db, connection_alias.unwrap_or(alias), &[])?;
    Ok(LiquibaseTarget { system, host: conn.host, database: conn.database })
}

/// Runs the changelogs of `.liquibase/<alias>` against the alias database of the system. Only call
/// after the user confirmed the target. `configured_install` is the Designer folder from the settings.
#[allow(clippy::too_many_arguments)]
pub fn update(
    db: &DbManager,
    system: Option<String>,
    alias: &str,
    project_root: &Path,
    connection_alias: Option<&str>,
    use_dist: bool,
    configured_install: Option<String>,
    emit: &(dyn Fn(bool, &str) + Sync),
) -> Result<String, String> {
    let system = liquibase_system(system, db)?;
    // The transpiled master changelog of the alias includes the changelogs of every module and project alias.
    let changelog_root = if use_dist { project_root.join("dist") } else { project_root.to_path_buf() };
    let dir = changelog_dir(&changelog_root, alias)?;
    let conn = database::system_db::read_alias_db(db, connection_alias.unwrap_or(alias), &[])?;
    let port = db.forward_port_for(&conn.host, conn.port).ok_or_else(|| format!("Open the tunnel to {}:{} first (Services).", conn.host, conn.port))?;
    let install = configured_install
        .filter(|d| !d.trim().is_empty())
        .or_else(app_base::designer_paths::detect_designer_install)
        .ok_or("The Designer installation was not found. Choose it in Tools > Options.")?;
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
    let install = PathBuf::from(install);
    let toolchain = discover_toolchain(&install, &designer_userdirs(&install, &appdata))?;
    let jdbc = JdbcTarget { url: jdbc_url(port, &conn.database), user: conn.user.clone(), password: conn.password.clone() };
    emit(false, &format!("Liquibase update of {alias} on system {system} (database {})", conn.database));
    run_update(&toolchain, &dir, &jdbc, emit)?;
    emit(false, "Liquibase update finished.");
    Ok("Liquibase update finished.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_what_a_properties_file_needs() {
        assert_eq!(properties_escape("C:\\FZ_Jürlich"), "C\\:\\\\FZ_J\\u00fcrlich");
        assert_eq!(properties_escape("p=a#b!c"), "p\\=a\\#b\\!c");
        assert_eq!(properties_escape(" lead"), "\\ lead");
        assert_eq!(properties_escape("😀"), "\\ud83d\\ude00");
    }

    #[test]
    fn defaults_file_has_url_user_password_and_changelog_but_no_extra_secret_copy() {
        let target = JdbcTarget { url: jdbc_url(3307, "cloud_data"), user: "u".into(), password: "p@ss=1".into() };
        let text = defaults_file_text(Path::new("C:/p/.liquibase/Data_alias/changelog.xml"), &target);
        assert!(text.contains("url=jdbc\\:mariadb\\://127.0.0.1\\:3307/cloud_data\n"));
        assert!(text.contains("password=p@ss\\=1\n"));
        assert!(text.contains("changeLogFile=C\\:/p/.liquibase/Data_alias/changelog.xml\n"));
        assert!(!format!("{target:?}").contains("p@ss"));
    }

    #[test]
    fn a_project_alias_belongs_to_its_target_alias() {
        let aod = "<aliasDefinition><aliasDefinitionSub><aliasDefDb><targetAliasName>Data_alias</targetAliasName></aliasDefDb></aliasDefinitionSub></aliasDefinition>";
        assert_eq!(target_alias_of(aod).as_deref(), Some("Data_alias"));
        assert_eq!(target_alias_of("<aliasDefinition/>"), None);
        assert_eq!(target_alias_of("<a><targetAliasName> </targetAliasName></a>"), None);
    }

    #[test]
    fn changelog_dir_needs_a_plain_alias_name_and_a_master_changelog() {
        let tmp = std::env::temp_dir().join(format!("forge-lb-{}", std::process::id()));
        let dir = tmp.join(".liquibase").join("Data_alias");
        std::fs::create_dir_all(&dir).unwrap();
        assert!(changelog_dir(&tmp, "Data_alias").is_err(), "no changelog.xml yet");
        std::fs::write(dir.join("changelog.xml"), "<databaseChangeLog/>").unwrap();
        assert_eq!(changelog_dir(&tmp, "Data_alias").unwrap(), dir);
        assert!(changelog_dir(&tmp, "../x").is_err());
        assert!(changelog_dir(&tmp, "").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn toolchain_discovery_reports_a_missing_java_and_a_missing_plugin() {
        let tmp = std::env::temp_dir().join(format!("forge-lb-tc-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        assert!(discover_toolchain(&tmp, &[]).unwrap_err().contains("Java runtime"));
        let java = tmp.join("jre").join("bin");
        std::fs::create_dir_all(&java).unwrap();
        std::fs::write(java.join(if cfg!(windows) { "java.exe" } else { "java" }), "").unwrap();
        assert!(discover_toolchain(&tmp, &[]).unwrap_err().contains("Liquibase plugin"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // Needs the Designer installation of this machine; skipped where it is not found.
    #[test]
    fn a_closed_port_fails_cleanly_streams_the_output_and_never_shows_the_password() {
        let Some(install) = app_base::designer_paths::detect_designer_install().map(PathBuf::from) else { return };
        let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default();
        let Ok(toolchain) = discover_toolchain(&install, &designer_userdirs(&install, &appdata)) else { return };
        let tmp = std::env::temp_dir().join(format!("forge-lb-run-{}", std::process::id()));
        let dir = tmp.join(".liquibase").join("Data_alias");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("changelog.xml"), "<?xml version=\"1.1\" encoding=\"UTF-8\"?><databaseChangeLog xmlns=\"http://www.liquibase.org/xml/ns/dbchangelog\"/>").unwrap();
        let target = JdbcTarget { url: jdbc_url(9, "nothing"), user: "lbuser".into(), password: "S3cr3t-Pw".into() };
        let lines = std::sync::Mutex::new(Vec::<String>::new());
        let result = run_update(&toolchain, &changelog_dir(&tmp, "Data_alias").unwrap(), &target, &|_, l| lines.lock().unwrap().push(l.to_string()));
        let _ = std::fs::remove_dir_all(&tmp);
        let all = lines.into_inner().unwrap().join("
");
        let err = result.expect_err("nothing listens on port 9");
        assert!(!all.contains("S3cr3t-Pw") && !err.contains("S3cr3t-Pw"));
        assert!(!all.is_empty(), "Liquibase output is streamed");
    }

    #[test]
    fn error_lines_are_recognised_and_the_banner_is_noise() {
        assert!(is_error_line("SEVERE 2026 something"));
        assert!(is_error_line("liquibase.exception.LiquibaseException: x"));
        assert!(!is_error_line("Liquibase: Update has been successful."));
        assert!(is_noise("##   _     _   ##"));
    }
}
