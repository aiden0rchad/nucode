use crate::{remote_backend, state::AppState};
use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, Manager, State};

#[tauri::command]
pub(crate) async fn browser_request(
    params: Value,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&state).await {
        return remote_backend::call_remote(
            &state,
            app,
            "browser_request",
            json!({"params":params}),
        )
        .await;
    }
    let result=state.browser.ui_request(params).await;
    if result.is_err(){nucode_diag_mcp::writer::record(||nucode_diag_mcp::core::event("error","browser","browser.request_failed","Browser request failed"));}
    result
}

#[tauri::command]
pub(crate) async fn browser_subscribe(
    channel: Channel<Value>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let browser = state.browser.clone();
    let remote = remote_backend::is_remote_mode(&state).await;
    let id = uuid::Uuid::new_v4().to_string();
    let task = tokio::spawn(async move {
        let mut events = browser.state.subscribe();
        let mut native_events = browser.native_state.subscribe();
        let mut last = Value::Null;
        loop {
            let state = app.state::<AppState>();
            let result = if remote {
                remote_backend::call_remote(
                    &state,
                    app.clone(),
                    "browser_request",
                    json!({"params":{"action":"poll"}}),
                )
                .await
            } else {
                browser.request(json!({"action":"poll"})).await
            };
            let value = match result {
                Ok(v) => v,
                Err(e) => json!({"error":e}),
            };
            if value != last {
                if channel.send(value.clone()).is_err() {
                    break;
                }
                last = value;
            }
            // Local frames wake immediately; a daemon owner is polled through the
            // existing authenticated RPC/socket, with no exposed CDP port.
            tokio::select! { _ = events.changed() => (), _ = native_events.changed() => (), _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => () }
        }
    });
    state.browser_streams.lock().await.insert(id.clone(), task);
    Ok(id)
}

#[tauri::command]
pub(crate) async fn browser_unsubscribe(
    id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut streams = state.browser_streams.lock().await;
    if let Some(task) = streams.remove(&id) {
        task.abort();
    }
    if streams.is_empty() {
        browser_request(json!({"action":"detach"}), state.clone(), app).await?;
    }
    Ok(())
}

// Native placement is app-only: it never targets a remote daemon's window.
async fn native_request(state: &AppState, params: Value) -> Result<Value, String> {
    if state.browser.native.get().is_none() || state.browser.settings()?.engine != crate::types::BrowserEngine::Native {
        return Err("Native browser is not selected".into());
    }
    state.browser.ui_request(params).await
}
#[tauri::command]
pub(crate) async fn browser_native_attach(tab_id: String, url: Option<String>, rect: Value, visible: bool, state: State<'_, AppState>) -> Result<Value,String> {
    let result = native_request(&state,json!({"action":"attach","tabId":tab_id,"rect":rect,"visible":visible})).await?;
    if let Some(url) = url { native_request(&state,json!({"action":"navigate","url":url})).await?; }
    Ok(result)
}
#[tauri::command]
pub(crate) async fn browser_native_bounds(tab_id: String, rect: Value, visible: bool, state: State<'_, AppState>) -> Result<Value,String> {
    native_request(&state,json!({"action":"bounds","tabId":tab_id,"rect":rect,"visible":visible})).await
}
#[tauri::command]
pub(crate) async fn browser_native_navigate(url: String, state: State<'_, AppState>) -> Result<Value,String> {
    native_request(&state,json!({"action":"navigate","url":url})).await
}
macro_rules! native_command {
    ($name:ident, $action:literal) => {
        #[tauri::command]
        pub(crate) async fn $name(state: State<'_, AppState>) -> Result<Value,String> {
            native_request(&state,json!({"action":$action})).await
        }
    };
}
native_command!(browser_native_back,"back");
native_command!(browser_native_forward,"forward");
native_command!(browser_native_reload,"reload");
native_command!(browser_native_stop,"stop");
native_command!(browser_native_close,"close");
native_command!(browser_native_snapshot_image,"screenshot");

#[cfg(target_os = "macos")]
fn passwords(state: &AppState) -> Result<&crate::shared::browser::native::NativeBackend, String> {
    state.browser.native_ui.get().map(|b| b.as_ref()).ok_or("Native browser unavailable".into())
}
#[tauri::command]
pub(crate) async fn browser_passwords_list(state: State<'_, AppState>) -> Result<crate::shared::browser::passwords::Index, String> {
    #[cfg(target_os = "macos")] { passwords(&state)?.list_passwords() }
    #[cfg(not(target_os = "macos"))] { let _ = state; Err(crate::shared::browser::passwords::UNAVAILABLE.into()) }
}
#[tauri::command]
pub(crate) async fn browser_password_save(origin: String, username: String, password: String, state: State<'_, AppState>) -> Result<(), String> {
    nucode_diag_mcp::writer::remember_secret(&password);
    #[cfg(target_os = "macos")] { passwords(&state)?.save_password(&origin, &username, &password) }
    #[cfg(not(target_os = "macos"))] { let _ = (origin, username, password, state); Err(crate::shared::browser::passwords::UNAVAILABLE.into()) }
}
#[tauri::command]
pub(crate) async fn browser_password_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")] { passwords(&state)?.delete_password(&id) }
    #[cfg(not(target_os = "macos"))] { let _ = (id, state); Err(crate::shared::browser::passwords::UNAVAILABLE.into()) }
}
#[tauri::command]
pub(crate) async fn browser_password_unblock(origin: String, state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")] { passwords(&state)?.unblock_password(&origin) }
    #[cfg(not(target_os = "macos"))] { let _ = (origin, state); Err(crate::shared::browser::passwords::UNAVAILABLE.into()) }
}
#[tauri::command]
pub(crate) async fn browser_password_fill(tab_id: String, id: String, state: State<'_, AppState>) -> Result<Value, String> {
    #[cfg(target_os = "macos")] { passwords(&state)?.fill_saved(&tab_id, &id).await }
    #[cfg(not(target_os = "macos"))] { let _ = (tab_id, id, state); Err(crate::shared::browser::passwords::UNAVAILABLE.into()) }
}
#[tauri::command]
pub(crate) async fn browser_password_offer(decision: String, state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")] { passwords(&state)?.decide_offer(&decision) }
    #[cfg(not(target_os = "macos"))] { let _ = (decision, state); Err(crate::shared::browser::passwords::UNAVAILABLE.into()) }
}
#[tauri::command]
pub(crate) async fn browser_password_resume(tab_id: String, state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "macos")] { passwords(&state)?.resume(&tab_id).await }
    #[cfg(not(target_os = "macos"))] { let _ = (tab_id, state); Err(crate::shared::browser::passwords::UNAVAILABLE.into()) }
}
