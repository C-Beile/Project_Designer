//! Forge app shell - Tauri 2 adapter layer only (architecture.md §1 "Grundregel"). Every command
//! here is a thin wrapper: parse Tauri's IPC arguments, call into `project` (which itself
//! only ever calls `designer-core`, never touches `.aod` parsing/patching logic directly), return
//! the result. All actual project/editor logic lives in the `project` crate - deliberately
//! kept out of this crate so it never links `tauri`/`wry`/`webview2-com` (früher: DLL-Problem der
//! GNU-Toolchain bei Testbinaries; heute MSVC, Grund nicht geprüft).
//!
//! No editor-specific logic lives in a command: `set_property`/`get_property_tree`/etc. know
//! nothing about "entity" vs. any future object type (architecture.md §6) - the entity-specific
//! pieces (validators) are registered inside `project::project_actor`, not here.

pub mod commands;
pub mod lsp_bridge;
pub mod os_windows;

use project::catalog::CatalogCache;
use project::project_actor::ProjectActorHandle;
#[cfg(feature = "ssh-tunnel")]
use project::settings;
use lsp_bridge::LspProcess;
use tauri::Manager;

/// The macOS menu bar: the app menu (About, Preferences, Hide, Quit) and an Edit menu. Without an
/// Edit menu the web view of a macOS app cannot copy and paste text at all. Undo and Redo are
/// left out on purpose: the native items would swallow Cmd+Z / Cmd+Shift+Z before the app's own
/// undo for the project could see the key. "Preferences" is forwarded to the window as the
/// event `forge://native-menu` (payload `preferences`), which opens Tools > Options.
/// Compiled on every platform so a Windows `cargo check` proves the API calls; only a Mac shows it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn build_native_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    let preferences = MenuItemBuilder::with_id("preferences", "Preferences...").accelerator("CmdOrCtrl+,").build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Dito Designer")
        .about(None)
        .separator()
        .item(&preferences)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit").cut().copy().paste().select_all().build()?;
    let window_menu = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().close_window().build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu, &edit_menu, &window_menu]).build()?;
    app.set_menu(menu)?;
    Ok(())
}

/// Gibt Plugin-Events (`forge://...`) an das Fenster weiter.
struct TauriEvents(tauri::AppHandle);

impl plugin_api::EventSink for TauriEvents {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        use tauri::Emitter;
        let _ = self.0.emit(event, payload);
    }
}

/// Meldet die einkompilierten Feature-Plugins an; ohne Cargo-Feature fehlt das Plugin ganz.
///
/// Zustand gehoert den Plugins, nicht Tauri: der `TunnelManager` gehoert Tunnel- und Datenbank-Plugin
/// (dieselbe `Arc`), der `DbManager` Datenbank-, Deploy- und Liquibase-Plugin. Der Kern nutzt beides nicht.
#[allow(unused_variables, unused_mut)]
fn build_feature_registry(app: &tauri::AppHandle) -> plugin_api::FeatureRegistry {
    let events: std::sync::Arc<dyn plugin_api::EventSink> = std::sync::Arc::new(TauriEvents(app.clone()));
    let mut registry = plugin_api::FeatureRegistry::new();
    #[cfg(feature = "git")]
    registry.register(Box::new(::git::GitPlugin));
    #[cfg(feature = "ssh-tunnel")]
    let tunnels = std::sync::Arc::new(::ssh_tunnel::tunnels::TunnelManager::default());
    #[cfg(feature = "ssh-tunnel")]
    registry.register(Box::new(::ssh_tunnel::TunnelPlugin::new(tunnels.clone())));
    #[cfg(feature = "database")]
    let db = std::sync::Arc::new(::database::db_session::DbManager::with_tunnels(tunnels));
    #[cfg(feature = "database")]
    registry.register(Box::new(::database::DatabasePlugin::new(db.clone(), events.clone())));
    #[cfg(feature = "deploy")]
    registry.register(Box::new(::deploy::DeployPlugin::new(db.clone())));
    #[cfg(feature = "liquibase")]
    {
        let handle = app.clone();
        let install_dir: ::liquibase::InstallDirProvider =
            std::sync::Arc::new(move || commands::settings::settings_file(&handle).ok().and_then(|f| settings::load_settings(&f).designer_install_dir));
        registry.register(Box::new(::liquibase::LiquibasePlugin::new(db.clone(), events.clone(), install_dir)));
    }
    registry
}

/// Baut die Transpiler-Registry: `native` ist immer da, `adito` nur mit dem Feature `adito-transpiler`.
/// Die Vorgabe ist die eigene Engine.
fn build_transpiler_registry() -> std::sync::Arc<plugin_api::TranspilerRegistry> {
    let mut registry = plugin_api::TranspilerRegistry::new();
    registry.register(std::sync::Arc::new(project::transpile_action::NativeTranspiler));
    #[cfg(feature = "adito-transpiler")]
    registry.register(std::sync::Arc::new(::adito_transpiler::plugin::AditoTranspiler));
    registry.set_default(project::transpile_action::NATIVE_ID);
    std::sync::Arc::new(registry)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let transpilers = build_transpiler_registry();
    project::transpile_action::set_transpilers(transpilers.clone());
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ProjectActorHandle::spawn())
        .manage(transpilers)
        .manage(os_windows::WindowPayloads::default())
        .manage(os_windows::ModalWindows::default())
        .manage(os_windows::CloseGuards::default())
        .on_window_event(os_windows::on_window_event)
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let _ = app.emit("forge://native-menu", event.id().0.clone());
        })
        .manage(LspProcess::default())
        .manage(CatalogCache::default())
        .manage(commands::project::ProjectFingerprints::default())
        .setup(|app| {
            app.manage(std::sync::Arc::new(build_feature_registry(app.handle())));
            // Logs and backups live in the app data folder; the panic hook and the backup hook are
            // installed before anything else can fail. Panics reach the window as an event.
            #[cfg(feature = "ssh-tunnel")]
            if let Ok(settings_path) = commands::settings::settings_file(app.handle()) {
                ::ssh_tunnel::tunnel_client::set_accept_new_host_keys(settings::load_settings(&settings_path).ssh_accept_new_host_keys.unwrap_or(false));
            }
            #[cfg(target_os = "macos")]
            build_native_menu(app.handle())?;
            if let Ok(dir) = app.path().app_data_dir() {
                app_base::crashlog::set_log_dir(dir.join("logs"));
                app_base::crashlog::set_app_version(&app.package_info().version.to_string());
                app_base::backup::set_backup_dir(dir.join("backups"));
            }
            app_base::backup::install();
            let build_handle = app.handle().clone();
            project::transpile_action::set_build_log_sink(std::sync::Arc::new(move |is_error, line| {
                use tauri::Emitter;
                let _ = build_handle.emit("forge://build-output", serde_json::json!({ "line": line, "error": is_error }));
            }));
            let log_handle = app.handle().clone();
            app_base::crashlog::set_entry_listener(move |time, kind, message| {
                use tauri::Emitter;
                let _ = log_handle.emit("forge://log-entry", serde_json::json!({ "time": time, "kind": kind, "message": message }));
            });
            let handle = app.handle().clone();
            app_base::crashlog::set_panic_notifier(move |message, file| {
                use tauri::Emitter;
                let _ = handle.emit("forge://panic", serde_json::json!({ "message": message, "log": file.to_string_lossy() }));
            });
            app_base::crashlog::install_panic_hook();
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::plugins::plugin_call,
            commands::misc::set_log_timezone,
            commands::plugins::plugin_list,
            commands::misc::check_for_update,
            commands::misc::install_update,
            commands::project::open_project,
            commands::project::list_tree_children,
            commands::project::restore_open_projects,
            commands::project::list_icons,
            commands::project::add_open_project,
            commands::project::remove_open_project,
            commands::editor::get_property_tree,
            commands::editor::set_property,
            commands::editor::list_diagnostics,
            commands::transpile::execute_action,
            commands::editor::undo,
            commands::editor::redo,
            commands::editor::save,
            commands::editor::save_overwrite,
            commands::editor::reload_object,
            commands::editor::external_changes,
            commands::project::project_changed,
            commands::misc::open_log_folder,
            commands::misc::open_backup_folder,
            commands::misc::log_client_error,
            commands::files::read_linked_file,
            commands::project::resolve_import,
            commands::project::list_project_files,
            commands::files::read_theme_file,
            commands::files::read_theme_pack,
            commands::misc::open_local_url,
            commands::files::write_linked_file,
            commands::dialogs::pick_project_folder,
            commands::dialogs::pick_project_folders,
            commands::project::get_recent_projects,
            commands::project::get_recent_project,
            commands::project::set_recent_project,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::settings::detect_designer_install,
            commands::editor::get_property_sheet,
            commands::editor::get_navigator,
            commands::editor::set_sheet_property,
            commands::editor::remove_sheet_property,
            commands::editor::reset_sheet_property,
            commands::editor::reset_sheet_element,
            commands::files::file_info,
            commands::files::file_paste,
            commands::files::file_rename,
            commands::files::file_delete,
            commands::files::open_in_system,
            commands::transpile::cancel_build,
            commands::transpile::npm_run,
            commands::editor::activate_mapping,
            commands::project::scan_problems,
            commands::misc::local_data_info,
            commands::project::find_usages,
            commands::editor::enable_modification,
            commands::editor::set_modification_property,
            commands::editor::set_modification_script,
            commands::editor::discard_modification,
            commands::editor::get_object_source,
            commands::editor::set_object_source,
            commands::dialogs::pick_file,
            commands::files::copy_object,
            commands::files::delete_object,
            commands::files::new_object_kinds,
            commands::files::validate_new_name,
            commands::files::create_object,
            commands::files::rename_plan,
            commands::files::rename_object,
            commands::project::list_project_models,
            commands::project::export_project_zip,
            commands::project::inspect_project_zip,
            commands::project::import_project_zip,
            commands::dialogs::pick_save_file,
            commands::editor::read_jdito_types,
            commands::transpile::transpile_compare,
            commands::project::project_create_empty,
            os_windows::window_open,
            os_windows::window_payload,
            os_windows::window_result,
            os_windows::window_close,
            os_windows::window_close_guard,
            os_windows::app_exit,
            os_windows::main_window_contains,
            os_windows::window_show,
            lsp_bridge::start_lsp,
            lsp_bridge::send_lsp_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
