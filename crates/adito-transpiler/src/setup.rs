//! Where the official ADITO transpiler lives on the user's machine and which private profile
//! Forge runs it under.
//!
//! Business background (RISKS.md R43): the official TranspilerCLI only works when its NetBeans
//! profile ("userdir") carries the NodeJS plugin that the interactive Designer installs from the
//! ADITO plugin portal. Forge must never run the CLI inside the user's real Designer profile (the
//! running Designer owns it and a second instance on the same profile breaks both), so Forge keeps
//! its own profile per Designer version under its app data folder and seeds it once by copying
//! the NodeJS plugin files out of the real profile. The real profile is only ever read.

use std::path::{Path, PathBuf};

use app_base::layout::{self, join_rel};

pub use app_base::designer_paths::{default_profiles_root, default_search_roots, discover_install_dir, is_designer_install, matching_designer_profile, profiles_root_candidates, version_from_install_dir};

/// Files and folders of the NodeJS plugin inside a Designer profile. Without them the CLI stops
/// with exit 142 ("Failed to determine NodeJS installation", spike-transpiler-wrapper.md).
const NODEJS_PLUGIN_SEED: [&str; 5] = [
    "modules/de-adito-aditoweb-nbm-nodejs.jar",
    "modules/ext/de.adito.aditoweb.nbm.nodejs",
    "config/Modules/de-adito-aditoweb-nbm-nodejs.xml",
    "update_tracking/de-adito-aditoweb-nbm-nodejs.xml",
    "libraries/bundled_nodejs",
];

/// Install dir and private profile for one official transpiler run.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OfficialTranspilerSetup {
    pub install_dir: PathBuf,
    pub user_dir: PathBuf,
}

fn copy_tree(src: &Path, dest: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        std::fs::create_dir_all(dest)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_tree(&entry.path(), &dest.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dest).map(|_| ())
    }
}

/// True once Forge's private profile carries every NodeJS plugin file.
pub fn is_seeded(user_dir: &Path) -> bool {
    NODEJS_PLUGIN_SEED.iter().all(|rel| join_rel(user_dir, rel).exists())
}

/// Copies the NodeJS plugin from the real Designer profile into Forge's private profile. The
/// real profile is only read.
pub fn seed_user_dir(designer_profile: &Path, user_dir: &Path) -> Result<(), String> {
    for rel in NODEJS_PLUGIN_SEED {
        let src = join_rel(designer_profile, rel);
        if !src.exists() {
            return Err(format!(
                "The NodeJS plugin of the ADITO Designer is missing in profile {} ({rel} not found). \
                 Start the original ADITO Designer once and install the NodeJS plugin, then try again.",
                designer_profile.display()
            ));
        }
    }
    for rel in NODEJS_PLUGIN_SEED {
        let dest = join_rel(user_dir, rel);
        if !dest.exists() {
            copy_tree(&join_rel(designer_profile, rel), &dest)
                .map_err(|e| format!("could not copy {rel} into the Dito_Transpiler profile {}: {e}", user_dir.display()))?;
        }
    }
    Ok(())
}

/// Resolves install dir and private profile for an official transpiler run.
///
/// - `explicit_install_dir`: the folder chosen in Tools > Options, if any.
/// - `forge_data_dir`: Forge's own per-user app data folder.
/// - `profiles_root`: the folder holding the real Designer profiles (`%APPDATA%\.aditodesigner`).
pub fn resolve(
    explicit_install_dir: Option<&Path>,
    search_roots: &[PathBuf],
    forge_data_dir: &Path,
    profiles_root: &Path,
) -> Result<OfficialTranspilerSetup, String> {
    let install_dir = match explicit_install_dir {
        Some(dir) => match layout::designer_root(dir) {
            Some(root) => root,
            None => {
                return Err(format!(
                    "{} is not an ADITO Designer installation ({} not found). Choose the Designer folder in Tools > Options.",
                    dir.display(),
                    layout::launcher_relative_candidates()[0]
                ))
            }
        },
        None => discover_install_dir(search_roots).and_then(|d| layout::designer_root(&d)).ok_or_else(|| {
            "No ADITO Designer installation found. The official transpiler needs an installed ADITO Designer - choose its folder in Tools > Options."
                .to_string()
        })?,
    };
    let version = version_from_install_dir(&install_dir).unwrap_or_else(|| "unknown".to_string());
    let user_dir = forge_data_dir.join("official-transpiler").join(&version).join("userdir");
    if !is_seeded(&user_dir) {
        let profile = matching_designer_profile(profiles_root, &version).ok_or_else(|| {
            format!(
                "No ADITO Designer profile for version {version} found under {}. Start the original ADITO Designer {version} once so it creates its profile and installs the NodeJS plugin.",
                profiles_root.display()
            )
        })?;
        seed_user_dir(&profile, &user_dir)?;
    }
    Ok(OfficialTranspilerSetup { install_dir, user_dir })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "forge-official-setup-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    fn fake_install(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        touch(&join_rel(&dir, layout::launcher_relative_candidates()[0]));
        dir
    }

    fn fake_profile(root: &Path, version: &str) -> PathBuf {
        let dir = root.join(version);
        touch(&join_rel(&dir, "modules/de-adito-aditoweb-nbm-nodejs.jar"));
        touch(&join_rel(&dir, "modules/ext/de.adito.aditoweb.nbm.nodejs/a.jar"));
        touch(&join_rel(&dir, "config/Modules/de-adito-aditoweb-nbm-nodejs.xml"));
        touch(&join_rel(&dir, "update_tracking/de-adito-aditoweb-nbm-nodejs.xml"));
        touch(&join_rel(&dir, "libraries/bundled_nodejs/node.exe"));
        dir
    }

    #[test]
    fn version_is_read_from_both_install_folder_name_styles() {
        assert_eq!(version_from_install_dir(&Path::new("x").join("ADITODesigner2026.0.4")).as_deref(), Some("2026.0.4"));
        assert_eq!(version_from_install_dir(&Path::new("x").join("ADITODesigner_2023.2.6")).as_deref(), Some("2023.2.6"));
        assert_eq!(version_from_install_dir(&Path::new("x").join("ADITO Designer 2026.0.4.app")).as_deref(), Some("2026.0.4"));
    }

    #[test]
    fn discovery_picks_the_newest_installation() {
        let root = scratch("discover");
        fake_install(&root, "ADITODesigner_2023.2.6");
        fake_install(&root, "ADITODesigner2026.0.4");
        fake_install(&root, "ADITODesigner2024.2.5.5");
        std::fs::create_dir_all(root.join("ADITODesigner2099.0.0")).unwrap();
        let found = discover_install_dir(&[root.clone()]).unwrap();
        assert!(found.ends_with("ADITODesigner2026.0.4"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_seeds_a_private_profile_without_touching_the_real_one() {
        let root = scratch("resolve");
        let install = fake_install(&root.join("installs"), "ADITODesigner2026.0.4");
        let profiles = root.join("profiles");
        let real = fake_profile(&profiles, "2026.0.4");
        let data = root.join("forge-data");

        let setup = resolve(Some(&install), &[], &data, &profiles).unwrap();
        assert_eq!(setup.install_dir, install);
        assert!(setup.user_dir.starts_with(&data));
        assert!(is_seeded(&setup.user_dir));
        assert!(!real.join("forge-transpile.lock").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn profile_falls_back_to_same_major_minor() {
        let root = scratch("profile-fallback");
        fake_profile(&root, "2024.2.5");
        assert!(matching_designer_profile(&root, "2024.2.5.5").unwrap().ends_with("2024.2.5"));
        assert!(matching_designer_profile(&root, "2025.0.4").is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_wrong_explicit_folder_is_a_clear_error() {
        let root = scratch("wrong-folder");
        let err = resolve(Some(&root), &[], &root, &root).unwrap_err();
        assert!(err.contains("Tools > Options"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn missing_plugin_in_the_real_profile_is_a_clear_error() {
        let root = scratch("no-plugin");
        let install = fake_install(&root.join("installs"), "ADITODesigner2026.0.4");
        std::fs::create_dir_all(root.join("profiles").join("2026.0.4")).unwrap();
        let err = resolve(Some(&install), &[], &root.join("data"), &root.join("profiles")).unwrap_err();
        assert!(err.contains("NodeJS plugin"));
        let _ = std::fs::remove_dir_all(root);
    }
}
