use crate::state::AppState;
use serde_json::{json, Value};
use tauri::State;

/// `resolve` (the merged list), `install` ({source, replace}) and `remove` ({name}) for the skills library.
#[tauri::command]
pub(crate) async fn skills_request(state: State<'_, AppState>, action: String, params: Value) -> Result<Value, String> {
    let data = state.settings_path.parent().ok_or("App data folder unavailable")?.to_path_buf();
    let settings = state.app_settings.lock().await.skills.clone();
    tokio::task::spawn_blocking(move || -> Result<Value, String> {
        use crate::shared::skills;
        match action.as_str() {
            "resolve" => serde_json::to_value(skills::resolve(&data, &settings)).map_err(|e| e.to_string()),
            "install" => {
                let source = params["source"].as_str().ok_or("Missing source")?;
                serde_json::to_value(skills::install(&data, source, params["replace"].as_bool().unwrap_or(false))?).map_err(|e| e.to_string())
            }
            "remove" => { skills::remove(&data, params["name"].as_str().ok_or("Missing name")?)?; Ok(json!(null)) }
            _ => Err(format!("Unknown skills action: {action}")),
        }
    }).await.map_err(|e| e.to_string())?
}
