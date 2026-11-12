//! A second OS window that shows one conversation: transcript and composer only.
//!
//! The window runs the normal app bundle. It learns its target from `window.__NUCODE_THREAD_WINDOW__`, which is set by
//! an initialization script before any page script runs, so the frontend never has to guess what kind of window it is.

pub(crate) const LABEL_PREFIX: &str = "thread-";

/// The window label for a thread. It depends on the thread id alone, so any caller can find the window again.
///
/// Ids made only of `A-Za-z0-9_-` are used as they are. Any other id is lowercase hex behind a `:`, a character plain
/// ids cannot contain, so two different ids never share a label.
pub(crate) fn thread_window_label(thread_id: &str) -> String {
    let plain = !thread_id.is_empty()
        && thread_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
    if plain {
        return format!("{LABEL_PREFIX}{thread_id}");
    }
    let hex: String = thread_id.bytes().map(|byte| format!("{byte:02x}")).collect();
    format!("{LABEL_PREFIX}:{hex}")
}

pub(crate) fn is_thread_window_label(label: &str) -> bool {
    label.starts_with(LABEL_PREFIX)
}

/// The script that hands the window its target. The ids are JSON-encoded, never pasted into the script text.
pub(crate) fn target_script(workspace_id: &str, thread_id: &str) -> Result<String, String> {
    let target = serde_json::to_string(&serde_json::json!({ "workspaceId": workspace_id, "threadId": thread_id }))
        .map_err(|error| error.to_string())?;
    Ok(format!("window.__NUCODE_THREAD_WINDOW__ = {target};"))
}

#[cfg(all(desktop, not(target_os = "macos")))]
pub(crate) fn close_all<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    for (label, window) in app.webview_windows() {
        if is_thread_window_label(&label) {
            let _ = window.destroy();
        }
    }
}

#[cfg(desktop)]
#[tauri::command]
pub(crate) async fn open_thread_window(
    app: tauri::AppHandle,
    workspace_id: String,
    thread_id: String,
    title: Option<String>,
) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    if thread_id.is_empty() {
        return Err("Missing thread id".into());
    }
    let label = thread_window_label(&thread_id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let title = title.map(|title| title.trim().to_string()).filter(|title| !title.is_empty());
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(title.as_deref().unwrap_or("nucode"))
        .inner_size(760.0, 820.0)
        .min_inner_size(420.0, 480.0)
        .transparent(true)
        .initialization_script(target_script(&workspace_id, &thread_id)?);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(19.0, 24.0));
    builder.build().map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(desktop)]
#[tauri::command]
pub(crate) async fn close_thread_window(app: tauri::AppHandle, thread_id: String) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(&thread_window_label(&thread_id)) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
pub(crate) async fn retarget_thread_window(
    app: tauri::AppHandle,
    thread_id: String,
    workspace_id: String,
) -> Result<(), String> {
    use tauri::Emitter;
    app.emit_to(
        tauri::EventTarget::webview(thread_window_label(&thread_id)),
        "thread-window-retarget",
        workspace_id,
    )
    .map_err(|error| error.to_string())
}

#[cfg(not(desktop))]
#[tauri::command]
pub(crate) async fn open_thread_window(_workspace_id: String, _thread_id: String, _title: Option<String>) -> Result<(), String> {
    Err("Thread windows are not available on this platform".into())
}

#[cfg(not(desktop))]
#[tauri::command]
pub(crate) async fn close_thread_window(_thread_id: String) -> Result<(), String> {
    Err("Thread windows are not available on this platform".into())
}

#[cfg(not(desktop))]
#[tauri::command]
pub(crate) async fn retarget_thread_window(_thread_id: String, _workspace_id: String) -> Result<(), String> {
    Err("Thread windows are not available on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_ids_are_used_as_they_are() {
        assert_eq!(thread_window_label("019a-bc_D9"), "thread-019a-bc_D9");
    }

    #[test]
    fn other_ids_are_hex_encoded_and_cannot_collide_with_plain_ones() {
        assert_eq!(thread_window_label("a b/ü"), "thread-:6120622fc3bc");
        assert_eq!(thread_window_label(""), "thread-:");
        // The hex of "abc" is also a valid plain id; the two must stay apart.
        assert_ne!(thread_window_label("abc"), thread_window_label("616263"));
        assert_ne!(thread_window_label("a/c"), thread_window_label("a:c"));
    }

    #[test]
    fn label_is_stable_and_recognised() {
        for id in ["x", "a.b", "😀", "with space"] {
            assert_eq!(thread_window_label(id), thread_window_label(id));
            assert!(is_thread_window_label(&thread_window_label(id)));
        }
        assert!(!is_thread_window_label("main"));
        assert!(!is_thread_window_label("browser-thread-1"));
    }

    #[test]
    fn target_script_json_encodes_the_ids() {
        let script = target_script("w\"1", "t');alert(1);//").unwrap();
        let json = script
            .strip_prefix("window.__NUCODE_THREAD_WINDOW__ = ")
            .and_then(|rest| rest.strip_suffix(';'))
            .expect("one assignment");
        let target: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(target["workspaceId"], "w\"1");
        assert_eq!(target["threadId"], "t');alert(1);//");
    }

    #[test]
    fn desktop_capability_lists_thread_windows() {
        // Tauri matches capability webviews as glob patterns, so one entry covers every thread window.
        let capabilities: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let desktop = capabilities["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["identifier"] == "desktop-default")
            .unwrap();
        let webviews: Vec<&str> = desktop["webviews"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
        let prefix = format!("{LABEL_PREFIX}*");
        assert!(webviews.contains(&prefix.as_str()));
        let permissions = desktop["permissions"].as_array().unwrap();
        assert!(permissions.iter().any(|p| p == "core:window:allow-set-title"));
    }
}
