use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};
use tauri::menu::MenuItem;
use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};
use tauri::{Manager, Runtime};

pub struct MenuItemRegistry<R: Runtime> {
    items: Mutex<HashMap<String, MenuItem<R>>>,
}

impl<R: Runtime> Default for MenuItemRegistry<R> {
    fn default() -> Self {
        Self {
            items: Mutex::new(HashMap::new()),
        }
    }
}

impl<R: Runtime> MenuItemRegistry<R> {
    fn register(&self, id: &str, item: &MenuItem<R>) {
        if let Ok(mut items) = self.items.lock() {
            items.insert(id.to_string(), item.clone());
        }
    }

    fn set_accelerator(&self, id: &str, accelerator: Option<&str>) -> tauri::Result<bool> {
        let item = match self.items.lock() {
            Ok(items) => items.get(id).cloned(),
            Err(_) => return Ok(false),
        };
        if let Some(item) = item {
            item.set_accelerator(accelerator)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct MenuAcceleratorUpdate {
    pub id: String,
    pub accelerator: Option<String>,
}

#[tauri::command]
pub fn menu_set_accelerators<R: Runtime>(
    app: tauri::AppHandle<R>,
    updates: Vec<MenuAcceleratorUpdate>,
) -> Result<(), String> {
    let registry = app.state::<MenuItemRegistry<R>>();
    for update in updates {
        registry
            .set_accelerator(&update.id, update.accelerator.as_deref())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn build_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<Menu<R>> {
    let registry = handle.state::<MenuItemRegistry<R>>();
    let app_name = "nucode".to_string();
    let about_item =
        MenuItemBuilder::with_id("about", format!("About {app_name}")).build(handle)?;
    let settings_item = MenuItemBuilder::with_id("file_open_settings", "Settings...")
        .accelerator("CmdOrCtrl+,")
        .build(handle)?;
    let app_menu = Submenu::with_items(
        handle,
        app_name.clone(),
        true,
        &[
            &about_item,
            &settings_item,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    let new_agent_item = MenuItemBuilder::with_id("file_new_agent", "New Agent").build(handle)?;
    let new_worktree_agent_item =
        MenuItemBuilder::with_id("file_new_worktree_agent", "New Worktree Agent").build(handle)?;
    let new_clone_agent_item =
        MenuItemBuilder::with_id("file_new_clone_agent", "New Clone Agent").build(handle)?;
    let add_workspace_item =
        MenuItemBuilder::with_id("file_add_workspace", "Add Workspaces...").build(handle)?;
    let add_workspace_from_url_item =
        MenuItemBuilder::with_id("file_add_workspace_from_url", "Add Workspace from URL...")
            .build(handle)?;

    let open_thread_window_item =
        MenuItemBuilder::with_id("file_open_thread_window", "Open Thread in New Window").build(handle)?;

    registry.register("file_new_agent", &new_agent_item);
    registry.register("file_new_worktree_agent", &new_worktree_agent_item);
    registry.register("file_new_clone_agent", &new_clone_agent_item);

    #[cfg(target_os = "linux")]
    let file_menu = {
        let close_window_item =
            MenuItemBuilder::with_id("file_close_window", "Close Window").build(handle)?;
        let quit_item = MenuItemBuilder::with_id("file_quit", "Quit").build(handle)?;
        Submenu::with_items(
            handle,
            "File",
            true,
            &[
                &new_agent_item,
                &new_worktree_agent_item,
                &new_clone_agent_item,
                &PredefinedMenuItem::separator(handle)?,
                &add_workspace_item,
                &add_workspace_from_url_item,
                &PredefinedMenuItem::separator(handle)?,
                &open_thread_window_item,
                &PredefinedMenuItem::separator(handle)?,
                &close_window_item,
                &quit_item,
            ],
        )?
    };
    #[cfg(not(target_os = "linux"))]
    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &new_agent_item,
            &new_worktree_agent_item,
            &new_clone_agent_item,
            &PredefinedMenuItem::separator(handle)?,
            &add_workspace_item,
            &add_workspace_from_url_item,
            &PredefinedMenuItem::separator(handle)?,
            &open_thread_window_item,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;

    let cycle_model_item = MenuItemBuilder::with_id("composer_cycle_model", "Cycle Model")
        .accelerator("CmdOrCtrl+Shift+M")
        .build(handle)?;
    let cycle_access_item = MenuItemBuilder::with_id("composer_cycle_access", "Cycle Access Mode")
        .accelerator("CmdOrCtrl+Shift+A")
        .build(handle)?;
    let cycle_reasoning_item =
        MenuItemBuilder::with_id("composer_cycle_reasoning", "Cycle Reasoning Mode")
            .accelerator("CmdOrCtrl+Shift+R")
            .build(handle)?;
    let cycle_collaboration_item =
        MenuItemBuilder::with_id("composer_cycle_collaboration", "Cycle Collaboration Mode")
            .accelerator("Shift+Tab")
            .build(handle)?;
    registry.register("composer_cycle_model", &cycle_model_item);
    registry.register("composer_cycle_access", &cycle_access_item);
    registry.register("composer_cycle_reasoning", &cycle_reasoning_item);
    registry.register("composer_cycle_collaboration", &cycle_collaboration_item);

    let composer_menu = Submenu::with_items(
        handle,
        "Composer",
        true,
        &[
            &cycle_model_item,
            &cycle_access_item,
            &cycle_reasoning_item,
            &cycle_collaboration_item,
        ],
    )?;

    let toggle_projects_sidebar_item =
        MenuItemBuilder::with_id("view_toggle_projects_sidebar", "Toggle Sidebar")
            .build(handle)?;
    let toggle_git_sidebar_item =
        MenuItemBuilder::with_id("view_toggle_git_sidebar", "Toggle Git Sidebar").build(handle)?;
    let toggle_debug_panel_item =
        MenuItemBuilder::with_id("view_toggle_debug_panel", "Toggle Debug Panel")
            .accelerator("CmdOrCtrl+Shift+D")
            .build(handle)?;
    let toggle_terminal_item = MenuItemBuilder::with_id("view_toggle_terminal", "Toggle Terminal")
        .accelerator("CmdOrCtrl+Shift+T")
        .build(handle)?;
    let next_agent_item =
        MenuItemBuilder::with_id("view_next_agent", "Next Agent").build(handle)?;
    let prev_agent_item =
        MenuItemBuilder::with_id("view_prev_agent", "Previous Agent").build(handle)?;
    let next_workspace_item =
        MenuItemBuilder::with_id("view_next_workspace", "Next Workspace").build(handle)?;
    let prev_workspace_item =
        MenuItemBuilder::with_id("view_prev_workspace", "Previous Workspace").build(handle)?;
    registry.register(
        "view_toggle_projects_sidebar",
        &toggle_projects_sidebar_item,
    );
    registry.register("view_toggle_git_sidebar", &toggle_git_sidebar_item);
    registry.register("view_toggle_debug_panel", &toggle_debug_panel_item);
    registry.register("view_toggle_terminal", &toggle_terminal_item);
    registry.register("view_next_agent", &next_agent_item);
    registry.register("view_prev_agent", &prev_agent_item);
    registry.register("view_next_workspace", &next_workspace_item);
    registry.register("view_prev_workspace", &prev_workspace_item);

    // Modes, as in the sidebar's mode menu. No accelerators: ⌘1–3 stay with the web view, which leaves them to any
    // shortcut the user has bound there.
    let mode_code_item = MenuItemBuilder::with_id("view_mode_code", "Code").build(handle)?;
    let mode_chat_item = MenuItemBuilder::with_id("view_mode_chat", "Chat").build(handle)?;
    let mode_work_item = MenuItemBuilder::with_id("view_mode_work", "Work").build(handle)?;
    let toggle_side_panel_item = MenuItemBuilder::with_id("view_toggle_side_panel", "Toggle Side Panel")
        .build(handle)?;
    let back_item = MenuItemBuilder::with_id("view_back", "Back")
        .accelerator("CmdOrCtrl+[")
        .build(handle)?;
    let forward_item = MenuItemBuilder::with_id("view_forward", "Forward")
        .accelerator("CmdOrCtrl+]")
        .build(handle)?;
    let previous_tab_item = MenuItemBuilder::with_id("view_previous_tab", "Previous Panel Tab")
        .accelerator("CmdOrCtrl+Shift+[")
        .build(handle)?;
    let next_tab_item = MenuItemBuilder::with_id("view_next_tab", "Next Panel Tab")
        .accelerator("CmdOrCtrl+Shift+]")
        .build(handle)?;
    let new_browser_tab_item = MenuItemBuilder::with_id("view_new_browser_tab", "New Browser Tab")
        .accelerator("CmdOrCtrl+Shift+B")
        .build(handle)?;
    let zoom_in_item = MenuItemBuilder::with_id("view_zoom_in", "Zoom In")
        .accelerator("CmdOrCtrl+Equal")
        .build(handle)?;
    let zoom_out_item = MenuItemBuilder::with_id("view_zoom_out", "Zoom Out")
        .accelerator("CmdOrCtrl+Minus")
        .build(handle)?;
    let zoom_reset_item = MenuItemBuilder::with_id("view_zoom_reset", "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(handle)?;

    #[cfg(target_os = "linux")]
    let view_menu = {
        let fullscreen_item =
            MenuItemBuilder::with_id("view_fullscreen", "Toggle Full Screen").build(handle)?;
        Submenu::with_items(
            handle,
            "View",
            true,
            &[
                &mode_code_item,
                &mode_chat_item,
                &mode_work_item,
                &PredefinedMenuItem::separator(handle)?,
                &toggle_projects_sidebar_item,
                &toggle_side_panel_item,
                &toggle_git_sidebar_item,
                &PredefinedMenuItem::separator(handle)?,
                &toggle_debug_panel_item,
                &toggle_terminal_item,
                &PredefinedMenuItem::separator(handle)?,
                &back_item,
                &forward_item,
                &PredefinedMenuItem::separator(handle)?,
                &previous_tab_item,
                &next_tab_item,
                &new_browser_tab_item,
                &PredefinedMenuItem::separator(handle)?,
                &next_agent_item,
                &prev_agent_item,
                &next_workspace_item,
                &prev_workspace_item,
                &PredefinedMenuItem::separator(handle)?,
                &zoom_in_item,
                &zoom_out_item,
                &zoom_reset_item,
                &PredefinedMenuItem::separator(handle)?,
                &fullscreen_item,
            ],
        )?
    };
    #[cfg(not(target_os = "linux"))]
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &mode_code_item,
            &mode_chat_item,
            &mode_work_item,
            &PredefinedMenuItem::separator(handle)?,
            &toggle_projects_sidebar_item,
            &toggle_side_panel_item,
            &toggle_git_sidebar_item,
            &PredefinedMenuItem::separator(handle)?,
            &toggle_debug_panel_item,
            &toggle_terminal_item,
            &PredefinedMenuItem::separator(handle)?,
            &back_item,
            &forward_item,
            &PredefinedMenuItem::separator(handle)?,
            &previous_tab_item,
            &next_tab_item,
            &new_browser_tab_item,
            &PredefinedMenuItem::separator(handle)?,
            &next_agent_item,
            &prev_agent_item,
            &next_workspace_item,
            &prev_workspace_item,
            &PredefinedMenuItem::separator(handle)?,
            &zoom_in_item,
            &zoom_out_item,
            &zoom_reset_item,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
        ],
    )?;

    #[cfg(target_os = "linux")]
    let window_menu = {
        let minimize_item =
            MenuItemBuilder::with_id("window_minimize", "Minimize").build(handle)?;
        let maximize_item =
            MenuItemBuilder::with_id("window_maximize", "Maximize").build(handle)?;
        let close_item = MenuItemBuilder::with_id("window_close", "Close Window").build(handle)?;
        Submenu::with_items(
            handle,
            "Window",
            true,
            &[
                &minimize_item,
                &maximize_item,
                &PredefinedMenuItem::separator(handle)?,
                &close_item,
            ],
        )?
    };
    #[cfg(not(target_os = "linux"))]
    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;

    #[cfg(target_os = "linux")]
    let help_menu = {
        let about_item =
            MenuItemBuilder::with_id("help_about", format!("About {app_name}")).build(handle)?;
        Submenu::with_items(handle, "Help", true, &[&about_item])?
    };
    #[cfg(not(target_os = "linux"))]
    let help_menu = Submenu::with_items(handle, "Help", true, &[])?;

    Menu::with_items(
        handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &composer_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

pub(crate) fn handle_menu_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    event: tauri::menu::MenuEvent,
) {
    match event.id().as_ref() {
        "about" | "help_about" => {
            if let Some(window) = app.get_window("about") {
                let _ = window.show();
                let _ = window.set_focus();
                return;
            }
            let _ = WebviewWindowBuilder::new(app, "about", WebviewUrl::App("index.html".into()))
                .title("About nucode")
                .resizable(false)
                .inner_size(360.0, 240.0)
                .center()
                .build();
        }
        "file_new_agent" => emit_menu_event(app, "menu-new-agent"),
        "file_new_worktree_agent" => emit_menu_event(app, "menu-new-worktree-agent"),
        "file_new_clone_agent" => emit_menu_event(app, "menu-new-clone-agent"),
        "file_add_workspace" => emit_menu_event(app, "menu-add-workspace"),
        "file_add_workspace_from_url" => emit_menu_event(app, "menu-add-workspace-from-url"),
        "file_open_settings" => emit_menu_event(app, "menu-open-settings"),
        "file_open_thread_window" => {
            // A thread window is already its own window; the entry is for the main one.
            if focused_thread_window_label(app).is_none() {
                emit_menu_event(app, "menu-open-thread-window");
            }
        }
        "file_close_window" | "window_close" => {
            if let Some(window) = focused_app_window(app) {
                let _ = window.close();
            }
        }
        "file_quit" => {
            app.exit(0);
        }
        "view_fullscreen" => {
            if let Some(window) = focused_app_window(app) {
                let is_fullscreen = window.is_fullscreen().unwrap_or(false);
                let _ = window.set_fullscreen(!is_fullscreen);
            }
        }
        "view_toggle_side_panel" | "view_back" | "view_forward" | "view_previous_tab"
        | "view_next_tab" | "view_new_browser_tab" | "view_zoom_in" | "view_zoom_out"
        | "view_zoom_reset" | "view_mode_code" | "view_mode_chat" | "view_mode_work" => {
            let action = event.id().as_ref().trim_start_matches("view_");
            let _ = app.emit_to(tauri::EventTarget::webview("main"), "menu-view-action", action);
        }
        "view_toggle_projects_sidebar" => emit_menu_event(app, "menu-toggle-projects-sidebar"),
        "view_toggle_git_sidebar" => emit_menu_event(app, "menu-toggle-git-sidebar"),
        "view_toggle_debug_panel" => emit_menu_event(app, "menu-toggle-debug-panel"),
        "view_toggle_terminal" => emit_menu_event(app, "menu-toggle-terminal"),
        "view_next_agent" => emit_menu_event(app, "menu-next-agent"),
        "view_prev_agent" => emit_menu_event(app, "menu-prev-agent"),
        "view_next_workspace" => emit_menu_event(app, "menu-next-workspace"),
        "view_prev_workspace" => emit_menu_event(app, "menu-prev-workspace"),
        "composer_cycle_model" => emit_composer_event(app, "menu-composer-cycle-model"),
        "composer_cycle_access" => emit_composer_event(app, "menu-composer-cycle-access"),
        "composer_cycle_reasoning" => emit_composer_event(app, "menu-composer-cycle-reasoning"),
        "composer_cycle_collaboration" => emit_composer_event(app, "menu-composer-cycle-collaboration"),
        "window_minimize" => {
            if let Some(window) = focused_app_window(app) {
                let _ = window.minimize();
            }
        }
        "window_maximize" => {
            if let Some(window) = focused_app_window(app) {
                let _ = window.maximize();
            }
        }
        _ => {}
    }
}

fn emit_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &str) {
    if let Some(window) = app.get_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit_to(tauri::EventTarget::webview("main"), event, ());
}

/// The label of the focused thread window, if a thread window has the focus.
fn focused_thread_window_label<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    app.windows()
        .into_iter()
        .find(|(label, window)| {
            crate::thread_window::is_thread_window_label(label) && window.is_focused().unwrap_or(false)
        })
        .map(|(label, _)| label)
}

/// The focused app window, or main when none of them is (the menu can fire while a browser view has the focus).
fn focused_app_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<tauri::Window<R>> {
    let focused = app.windows().into_iter().find(|(label, window)| {
        (label == "main" || label == "about" || crate::thread_window::is_thread_window_label(label))
            && window.is_focused().unwrap_or(false)
    });
    focused.map(|(_, window)| window).or_else(|| app.get_window("main"))
}

/// Composer shortcuts belong to the window they were pressed in. A thread window gets them directly, without
/// bringing main forward; everything else goes to main as before.
fn emit_composer_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &str) {
    match focused_thread_window_label(app) {
        Some(label) => {
            let _ = app.emit_to(tauri::EventTarget::webview(label), event, ());
        }
        None => emit_menu_event(app, event),
    }
}
