use crate::shared::{
    engines::key_env,
    providers::{self, KeyStore},
};
use crate::{codegraph::CodegraphSetup, types::*};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path};

pub(super) fn provider_id(p: &ProviderEntry, registry: &[ProviderEntry]) -> String {
    let kind = serde_json::to_value(p.kind)
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    if matches!(
        p.kind,
        ProviderKind::Ollama | ProviderKind::Lmstudio | ProviderKind::OpenaiCompatible
    ) || registry
        .iter()
        .filter(|v| v.enabled && v.kind == p.kind)
        .count()
        > 1
    {
        // Prefix custom IDs so a registry slug cannot activate an OAuth provider.
        format!("nucode-{}", p.id)
    } else {
        kind
    }
}

pub(crate) fn models(registry: &[ProviderEntry]) -> Value {
    let mut entries = serde_json::Map::new();
    for p in registry.iter().filter(|p| p.enabled) {
        let id = provider_id(p, registry);
        let custom = id.starts_with("nucode-");
        let auth = match &p.auth {
            ProviderAuth::None => "nucode-no-key".into(),
            ProviderAuth::ApiKey => format!("${}", key_env(&p.id)),
            ProviderAuth::Env { var } => format!("${var}"),
            ProviderAuth::Command { .. } => format!("${}", key_env(&p.id)),
        };
        let mut entry = json!({"name":p.name,"apiKey":auth,"models":p.models.iter().filter(|m|m.enabled).map(|m| {
            let mut v = json!({"id":m.id,"name":m.display_name.as_ref().unwrap_or(&m.id)});
            if let Some(n) = m.context_window { v["contextWindow"] = json!(n); }
            if let Some(images) = m.supports_images.or_else(|| providers::likely_vision(&m.id)) { v["input"] = if images { json!(["text","image"]) } else { json!(["text"]) }; }
            if let Some(cap) = &m.reasoning { super::super::reasoning::pi_config(&mut v, cap, p.kind); }
            v
        }).collect::<Vec<_>>()});
        if custom
            || p.base_url
                .as_deref()
                .is_some_and(|s| !s.is_empty() && s != providers::kind_info(p.kind).0)
        {
            entry["baseUrl"] = json!(providers::base_url(p));
        }
        if custom {
            entry["api"] = json!(match p.kind {
                ProviderKind::Anthropic => "anthropic-messages",
                ProviderKind::Google => "google-generative-ai",
                ProviderKind::Openai => "openai-responses",
                _ if p.api_style == Some(ApiStyle::Responses) => "openai-responses",
                _ => "openai-completions",
            });
        }
        if !p.extra_headers.is_empty() {
            entry["headers"] = json!(p.extra_headers);
        }
        entries.insert(id, entry);
    }
    json!({"providers":entries})
}

pub(super) fn mcp(setup: Option<&CodegraphSetup>) -> Value {
    let entries = crate::shared::connectors::effective(
        &AppSettings::default(),
        &WorkspaceSettings::default(),
        setup,
    )
    .expect("valid built-in connector");
    crate::shared::connectors::delivery(&entries, &providers::Keychain)
        .expect("built-in connector has no secrets")
        .pi
}

pub(crate) fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    write_file(path, &serde_json::to_vec(value).map_err(|e| e.to_string())?)
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = std::fs::write(&temp, bytes).and_then(|_| std::fs::rename(&temp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result.map_err(|e| e.to_string())
}

pub(crate) fn write_policy(
    home: &Path,
    registry: &[ProviderEntry],
    policy: &AgentPolicy,
) -> Result<(), String> {
    std::fs::create_dir_all(home.join("nucode/threads")).map_err(|e| e.to_string())?;
    write_json(&home.join("nucode/policy.json"), &policy_value(registry, policy)?)
}

fn policy_value(registry: &[ProviderEntry], policy: &AgentPolicy) -> Result<Value, String> {
    let key = |m: &ModelRef| format!("{}/{}", m.provider_id, m.model_id);
    let mut value = serde_json::to_value(&policy.subagents).map_err(|e| e.to_string())?;
    value["allowedModels"] = json!(policy
        .subagents
        .allowed_models
        .iter()
        .map(&key)
        .collect::<Vec<_>>());
    value["defaultModel"] = json!(policy.subagents.default_model.as_ref().map(&key));
    for (v, role) in value["roles"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .zip(&policy.subagents.roles)
    {
        v["model"] = json!(role.model.as_ref().map(&key));
        if let (Some(effort), Some(m)) = (role.reasoning_effort.as_deref(), role.model.as_ref()) {
            let cap = registry.iter().filter(|p| p.id == m.provider_id).flat_map(|p| &p.models).find(|x| x.id == m.model_id).and_then(|x| x.reasoning.as_ref());
            if let Some(cap) = cap { v["reasoningEffort"] = json!(crate::shared::reasoning::clamp(cap, Some(effort))); }
        }
    }
    let mut models = serde_json::Map::new();
    for p in registry.iter().filter(|p| p.enabled) {
        for m in p.models.iter().filter(|m| m.enabled) {
            models.insert(
                format!("{}/{}", p.id, m.id),
                json!(format!("{}/{}", provider_id(p, registry), m.id)),
            );
        }
    }
    value["models"] = Value::Object(models);
    Ok(value)
}

fn team_file(home: &Path, id: &str, folder: &str) -> Result<std::path::PathBuf, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err("Invalid conversation ID".into());
    }
    Ok(home.join("nucode").join(folder).join(format!("{id}.json")))
}

pub(super) fn read_team(home: &Path, id: &str) -> Result<Option<SubagentPolicy>, String> {
    match std::fs::read(team_file(home, id, "teams")?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("Cannot read conversation team: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub(super) fn write_team(home: &Path, id: &str, team: Option<&SubagentPolicy>) -> Result<(), String> {
    let file = team_file(home, id, "teams")?;
    if let Some(team) = team {
        std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
        write_json(&file, &serde_json::to_value(team).map_err(|e| e.to_string())?)
    } else {
        match std::fs::remove_file(file) {
            Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e.to_string()),
        }
    }
}

pub(super) fn apply_team(base: &AgentPolicy, team: Option<SubagentPolicy>) -> AgentPolicy {
    let mut policy = base.clone();
    if let Some(team) = team {
        policy.subagents = team;
        // This allowance belongs to the project ledger, never an individual conversation.
        policy.subagents.daily_token_limit = base.subagents.daily_token_limit;
    }
    policy
}

pub(super) fn write_thread_policy(home: &Path, id: &str, registry: &[ProviderEntry], policy: &AgentPolicy) -> Result<(), String> {
    let file = team_file(home, id, "policies")?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    write_json(&file, &policy_value(registry, policy)?)
}

pub(crate) fn sync_policies(data: &Path, settings: &AppSettings) -> Result<(), String> {
    let workspaces = crate::storage::read_workspaces(&data.join("workspaces.json"))?;
    for (id, workspace) in workspaces {
        if !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || id.is_empty()
        {
            continue;
        }
        let home = data.join("pi/agent").join(id);
        if home.exists() {
            write_policy(
                &home,
                &settings.providers,
                &providers::effective_policy(
                    &settings.agent_policy,
                    workspace.settings.agent_policy.as_ref(),
                ),
            )?;
            write_json(
                &home.join("nucode/connectors.json"),
                &json!(crate::shared::connectors::effective(
                    settings,
                    &workspace.settings,
                    None
                )?),
            )?;
        }
    }
    Ok(())
}

pub(super) fn write_access(home: &Path, id: &str, mode: Option<&str>) -> Result<(), String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("Invalid pi session ID".into());
    }
    std::fs::create_dir_all(home.join("nucode/threads")).map_err(|e| e.to_string())?;
    let file = home.join("nucode/threads").join(format!("{id}.json"));
    if matches!(mode, None | Some("current")) && file.exists() {
        return Ok(());
    }
    let mode = match mode.unwrap_or("ask") {
        "current" | "ask" => "ask",
        "read-only" => "read-only",
        "full-access" => "full-access",
        _ => return Err("Invalid access mode".into()),
    };
    let mut value = match std::fs::read(&file) {
        Ok(bytes) => serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({"sessionAllow":[]}),
        Err(e) => return Err(e.to_string()),
    };
    value["accessMode"] = json!(mode);
    write_json(&file, &value)
}

fn settings_value(registry: &[ProviderEntry], auto_compact: &AutoCompact) -> Value {
    let enabled: Vec<_> = registry.iter().filter(|p| p.enabled).flat_map(|p| p.models.iter().filter(|m| m.enabled).map(move |m| (format!("{}/{}", provider_id(p, registry), m.id), m))).collect();
    let mut compaction = json!({"enabled": auto_compact.enabled});
    // pi compacts when used > window - reserveTokens, so the reserve is the unused share.
    // A model's own compaction point wins over the global percentage.
    let overrides: serde_json::Map<_, _> = enabled.iter().filter_map(|(key, m)| {
        let reserve = match (m.compact_at, auto_compact.percent, m.context_window) {
            (Some(at), _, _) => m.window().saturating_sub(at),
            (None, Some(percent), Some(w)) => w - w * percent as u64 / 100,
            _ => return None,
        };
        Some((key.clone(), json!({"reserveTokens": reserve.max(1024)})))
    }).collect();
    if !overrides.is_empty() { compaction["modelOverrides"] = Value::Object(overrides); }
    json!({"quietStartup":true,"enableInstallTelemetry":false,"enabledModels":enabled.iter().map(|(key, _)| key).collect::<Vec<_>>(),"compaction":compaction})
}

// A `pi` CLI the agent runs in its own shell inherits this home and leaves an empty `{}` auth.json
// behind. That holds no account, so it is removed (as the runtime's own guard does); anything with
// content is still refused.
pub(super) fn clear_empty_auth(home: &Path) -> Result<(), String> {
    let auth = home.join("auth.json");
    let Ok(bytes) = std::fs::read(&auth) else { return Ok(()) };
    if serde_json::from_slice::<Value>(&bytes).ok().and_then(|v| v.as_object().map(|o| o.is_empty())) == Some(true) {
        return std::fs::remove_file(&auth).map_err(|e| format!("Cannot remove the empty auth.json from nucode's isolated pi home: {e}"));
    }
    Err("Remove auth.json from nucode's isolated pi home; accounts and logins are not supported".into())
}

pub(super) fn prepare(
    home: &Path,
    registry: &[ProviderEntry],
    graph: Option<&CodegraphSetup>,
    auto_compact: &AutoCompact,
) -> Result<HashMap<String, String>, String> {
    std::fs::create_dir_all(home.join("extensions")).map_err(|e| e.to_string())?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(home, std::fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?; }
    std::fs::create_dir_all(home.join("extensions/lib")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(home.join("nucode")).map_err(|e| e.to_string())?;
    for (name, source) in [
        (
            "nucode-gate.ts",
            include_str!("../../../../engines/pi/extensions/nucode-gate.ts"),
        ),
        (
            "nucode-subagents.ts",
            include_str!("../../../../engines/pi/extensions/nucode-subagents.ts"),
        ),
        (
            "nucode-work.ts",
            include_str!("../../../../engines/pi/extensions/nucode-work.ts"),
        ),
        (
            "lib/policy.ts",
            include_str!("../../../../engines/pi/extensions/lib/policy.ts"),
        ),
        (
            "lib/connectors.ts",
            include_str!("../../../../engines/pi/extensions/lib/connectors.ts"),
        ),
        (
            "lib/recovery.ts",
            include_str!("../../../../engines/pi/extensions/lib/recovery.ts"),
        ),
        (
            "lib/streamRecovery.ts",
            include_str!("../../../../engines/pi/extensions/lib/streamRecovery.ts"),
        ),
        (
            "lib/screenshotFile.ts",
            include_str!("../../../../engines/pi/extensions/lib/screenshotFile.ts"),
        ),
        (
            "lib/commandGuard.ts",
            include_str!("../../../../engines/pi/extensions/lib/commandGuard.ts"),
        ),
        (
            "lib/toolPaths.ts",
            include_str!("../../../../engines/pi/extensions/lib/toolPaths.ts"),
        ),
        (
            "lib/verification.ts",
            include_str!("../../../../engines/pi/extensions/lib/verification.ts"),
        ),
        (
            "lib/executionLimits.ts",
            include_str!("../../../../engines/pi/extensions/lib/executionLimits.ts"),
        ),
        (
            "lib/contextReport.ts",
            include_str!("../../../../engines/pi/extensions/lib/contextReport.ts"),
        ),
        (
            "lib/responseStyle.ts",
            include_str!("../../../../engines/pi/extensions/lib/responseStyle.ts"),
        ),
        (
            "lib/foreignReasoning.ts",
            include_str!("../../../../engines/pi/extensions/lib/foreignReasoning.ts"),
        ),
        (
            "lib/loopGuard.ts",
            include_str!("../../../../engines/pi/extensions/lib/loopGuard.ts"),
        ),
        (
            "lib/toolBatching.ts",
            include_str!("../../../../engines/pi/extensions/lib/toolBatching.ts"),
        ),
        (
            "lib/visibleBrowser.ts",
            include_str!("../../../../engines/pi/extensions/lib/visibleBrowser.ts"),
        ),
        (
            "LICENSE",
            include_str!("../../../../engines/pi/extensions/LICENSE"),
        ),
    ] {
        write_file(&home.join("extensions").join(name), source.as_bytes())?;
    }
    write_json(&home.join("extensions/lib/package.json"), &json!({"type":"module"}))?;
    clear_empty_auth(home)?;
    write_json(&home.join("models.json"), &models(registry))?;
    write_json(&home.join("mcp.json"), &mcp(graph))?;
    write_json(
        &home.join("settings.json"),
        &settings_value(registry, auto_compact),
    )?;
    let mut env = HashMap::new();
    env.insert(
        "PI_CODING_AGENT_DIR".into(),
        home.to_string_lossy().into_owned(),
    );
    env.insert("PI_TELEMETRY".into(), "0".into());
    // omp Auto QA posts tool-issue reports to qa.omp.sh; nothing leaves the machine unasked.
    env.insert("PI_AUTO_QA".into(), "0".into());
    env.insert("PI_SKIP_VERSION_CHECK".into(), "1".into());
    Ok(env)
}
// No file writes: this may outlive a cancelled startup while macOS awaits approval.
// Only the provider this session starts on must have a key; another enabled provider
// without one must not block the send.
pub(super) fn credentials(registry: &[ProviderEntry], keys: &dyn KeyStore, required: &str) -> Result<HashMap<String, String>, String> {
    let mut env = HashMap::new();
    for p in registry.iter().filter(|p| p.enabled && matches!(p.auth, ProviderAuth::ApiKey)) {
        match keys.get(&p.id)? {
            Some(key) => { env.insert(key_env(&p.id), key); }
            None if p.id == required => return Err(format!("Save an API key for {} in Settings", p.name)),
            None => {}
        }
    }
    Ok(env)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn role_effort_is_clamped_to_the_role_model_and_absent_when_unset() {
        let registry: Vec<ProviderEntry> = vec![serde_json::from_value(json!({"id":"local","name":"Local","kind":"openai-compatible","auth":{"type":"apiKey"},"enabled":true,"baseUrl":"http://localhost:1234/v1","models":[{"id":"large","enabled":true,"reasoning":{"supported":true,"levels":["low","high","max"],"default":"high","control":"effort","source":"api","detectedAt":0}}]})).unwrap()];
        let mut policy = AgentPolicy::default();
        let roles = &mut policy.subagents.roles;
        roles[0].model = Some(ModelRef { provider_id: "local".into(), model_id: "large".into() });
        roles[0].reasoning_effort = Some("medium".into());
        roles[1].reasoning_effort = Some("medium".into());
        let value = policy_value(&registry, &policy).unwrap();
        let cap = registry[0].models[0].reasoning.as_ref().unwrap();
        let expected = crate::shared::reasoning::clamp(cap, Some("medium"));
        assert!(matches!(expected.as_deref(), Some("low" | "high")));
        assert_eq!(value["roles"][0]["reasoningEffort"], json!(expected));
        assert_eq!(value["roles"][1]["reasoningEffort"], "medium");
        assert!(value["roles"][2].get("reasoningEffort").is_none());
    }
}
