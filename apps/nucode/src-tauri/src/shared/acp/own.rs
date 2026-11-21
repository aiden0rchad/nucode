//! Agents that sign in on their own and bring their own model list (Antigravity, OpenCode, Cursor).
use crate::shared::engine_registry::Preset;
use serde_json::{json, Value};
use std::{path::{Path, PathBuf}, sync::Mutex};

pub(super) fn cache_file(data: &Path, engine: &str) -> PathBuf { data.join(engine).join("models.json") }
/// Models from a `session/new` or `session/load` result, or from a later config update: the ACP `models`
/// object, else the `model` config option (options may be grouped).
pub(super) fn parse_models(source: &Value) -> Option<Value> {
    let entry = |value: &Value, name: &Value, description: &Value| value.as_str().map(|id| json!({"id":id,"name":name.as_str().unwrap_or(id),"description":description.as_str().unwrap_or("")}));
    let (models, current): (Vec<Value>, Value) = if let Some(list) = source["models"]["availableModels"].as_array() {
        (list.iter().filter_map(|m| entry(&m["modelId"], &m["name"], &m["description"])).collect(), source["models"]["currentModelId"].clone())
    } else {
        let option = source["configOptions"].as_array()?.iter().find(|o| o["category"] == "model" && o["options"].is_array())?;
        let mut models = vec![];
        for item in option["options"].as_array()? {
            match item["options"].as_array() {
                Some(group) => models.extend(group.iter().filter_map(|m| entry(&m["value"], &m["name"], &m["description"]))),
                None => models.extend(entry(&item["value"], &item["name"], &item["description"])),
            }
        }
        (models, option["currentValue"].clone())
    };
    (!models.is_empty()).then(|| json!({"models":models,"current":current}))
}
pub(super) fn read_cache(file: &Path) -> Value {
    std::fs::read(file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_else(|| json!({}))
}
pub(super) fn cached(cache: &Mutex<Value>, file: &Path) -> Value {
    let mut cache = cache.lock().unwrap();
    if cache.is_null() { *cache = read_cache(file); }
    cache.clone()
}
/// Keeps the latest list in memory and on disk, so the picker has entries before the first session of a run.
pub(super) fn store(cache: &Mutex<Value>, file: &Path, source: &Value) {
    let Some(models) = parse_models(source) else { return };
    let mut cache = cache.lock().unwrap();
    if *cache == models { return; }
    *cache = models.clone();
    if let Some(parent) = file.parent() { let _ = std::fs::create_dir_all(parent); }
    let temp = file.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    if std::fs::write(&temp, models.to_string()).and_then(|_| std::fs::rename(&temp, file)).is_err() { let _ = std::fs::remove_file(temp); }
}
/// ModelOption rows for the engine's own models; "Agent default" while nothing is known yet.
pub(crate) fn entries(preset: &Preset, cache: &Value) -> Vec<Value> {
    let mut rows: Vec<(String, String, String)> = cache["models"].as_array().into_iter().flatten()
        .filter_map(|m| Some((m["id"].as_str()?.to_owned(), m["name"].as_str()?.to_owned(), m["description"].as_str().unwrap_or("").to_owned()))).collect();
    if rows.is_empty() { rows.push(("default".into(), "Agent default".into(), "Uses the model the agent picks".into())); }
    let current = cache["current"].as_str().map(str::to_owned).unwrap_or_else(|| rows[0].0.clone());
    rows.into_iter().map(|(id, name, description)| {
        let full = format!("{}/{id}", preset.id);
        json!({"id":full,"model":full,"providerId":preset.id,"providerName":preset.name,"modelId":id,"displayName":name,"description":description,
            "engines":[preset.id],"supportedReasoningEfforts":[],"defaultReasoningEffort":null,"isDefault":id == current,"contextWindow":null})
    }).collect()
}
pub(crate) fn catalog_for(data: &Path, preset: &Preset) -> Vec<Value> { entries(preset, &read_cache(&cache_file(data, preset.id))) }
/// Models the thread's session holds right now and whether they change through `set_model`.
pub(super) fn current_model(capabilities: &Value) -> Option<String> {
    if capabilities["models"]["availableModels"].is_array() { return capabilities["models"]["currentModelId"].as_str().map(str::to_owned); }
    capabilities["configOptions"].as_array()?.iter().find(|o| o["category"] == "model")?["currentValue"].as_str().map(str::to_owned)
}
/// The model recorded for a new thread: the user's pick, else what the agent says it is using.
pub(super) fn initial_model(explicit: &str, result: &Value) -> String {
    if explicit != "default" { return explicit.into(); }
    current_model(result).unwrap_or_else(|| "default".into())
}
/// An agent request nucode cannot serve is answered at once so the turn never waits on it.
pub(super) fn unsupported(method: &str) -> Value {
    if method == "elicitation/create" { json!({"action":"cancel"}) } else { json!({"__rpcError":{"code":-32601,"message":format!("Method not found: {method}")}}) }
}
pub(super) fn stop_error(preset: &Preset, reason: &str) -> Option<String> {
    Some(match (preset.id, reason) {
        ("antigravity", "refusal") => "Antigravity quota exhausted".into(),
        (_, "refusal") => format!("{} refused this request", preset.name),
        (_, "max_tokens") => format!("{} stopped at its output token limit", preset.name),
        (_, "max_turn_requests") => format!("{} stopped at its limit of model requests for one turn", preset.name),
        _ => return None,
    })
}
