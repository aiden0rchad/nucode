use crate::{shared::{engine_registry, providers}, types::*};
use super::config;
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path};

#[derive(Clone)]
pub(crate) struct EngineProfile { pub definition: EngineDefinition }
impl Default for EngineProfile {
    fn default() -> Self { Self { definition: engine_registry::registry(&AppSettings::default()).remove(0) } }
}
impl EngineProfile {
    pub fn id(&self) -> &str { &self.definition.id }
    pub fn omp(&self) -> bool { self.id() == "omp" }
    pub fn custom(&self) -> bool { !self.definition.built_in }
    pub fn mcp_config(&self, mut config: Value) -> Value {
        // Pi's MCP timeout is seconds; OMP's identically named field is milliseconds.
        if self.omp() {
            for server in config["mcpServers"].as_object_mut().into_iter().flat_map(|s| s.values_mut()) {
                if let Some(seconds) = server["timeout"].as_u64() {
                    server["timeout"] = json!(seconds.saturating_mul(1000));
                }
            }
        }
        config
    }
    pub fn prepare(&self, home: &Path, registry: &[ProviderEntry], features: &Features, auto_compact: &AutoCompact, env: &mut HashMap<String,String>) -> Result<(), String> {
        if let Some(key) = &self.definition.config_dir_env { env.insert(key.clone(), home.to_string_lossy().into()); }
        env.extend(self.definition.env.clone());
        if self.omp() {
            env.insert("PI_CONFIG_DIR".into(), home.to_string_lossy().into());
            env.insert("NUCODE_OMP".into(), "1".into());
            env.insert("OTEL_SDK_DISABLED".into(), "true".into());
            // JSON is a YAML subset, avoiding a serializer dependency.
            config::write_json(&home.join("models.yml"), &omp_models(registry))?;
            let mut compaction = json!({"enabled": auto_compact.enabled});
            if let Some(percent) = auto_compact.percent { compaction["thresholdPercent"] = json!(percent); }
            config::write_json(&home.join("config.yml"), &json!({"compaction":compaction,"startup":{"checkUpdate":false,"setupWizard":false},"marketplace":{"autoUpdate":false},"telemetry":{"otlpExportEnabled":false},"mcp":{"enableProjectConfig":false},"browser":{"enabled":false},"tools":{"xdevDocs":"builtins","xdevInlineDevices":["mcp__nucode_browser_*"]},"lsp":{"enabled":true,"lazy":true},"task":{"maxRecursionDepth":0}}))?;
            let origins: Vec<_> = registry.iter().filter(|p| p.enabled).filter_map(|p| reqwest::Url::parse(&providers::base_url(p)).ok().map(|url|url.origin().ascii_serialization())).collect();
            config::write_json(&home.join("nucode/network.json"), &json!(origins))?;
            // The gate uses the compatible tool_call API; only explicitly gated
            // tools are enabled. Native task/browser tools bypass nucode policy.
            let gate = include_str!("../../../../engines/pi/extensions/nucode-gate.ts");
            std::fs::write(home.join("extensions/nucode-gate.ts"), gate).map_err(|e| e.to_string())?;
        }
        env.insert("NUCODE_AUTOCOMPACT".into(), json!({"enabled":auto_compact.enabled,"percent":auto_compact.percent}).to_string());
        env.insert("NUCODE_FEATURES".into(), serde_json::to_string(features).map_err(|e|e.to_string())?);
        Ok(())
    }
}
pub(crate) fn omp_models(registry: &[ProviderEntry]) -> Value {
    let mut result = config::models(registry);
    for provider in registry.iter().filter(|p| p.enabled) {
        let entry = &mut result["providers"][config::provider_id(provider, registry)];
        entry.as_object_mut().unwrap().remove("name");
        entry["baseUrl"] = json!(providers::base_url(provider));
        entry["api"] = json!(match provider.kind {
            ProviderKind::Anthropic => "anthropic-messages", ProviderKind::Google => "google-generative-ai",
            ProviderKind::Openai => "openai-responses", _ if provider.api_style == Some(ApiStyle::Responses) => "openai-responses", _ => "openai-completions",
        });
        if matches!(provider.auth, ProviderAuth::None) { entry["auth"] = json!("none"); entry.as_object_mut().unwrap().remove("apiKey"); }
        else if let Some(key) = entry["apiKey"].as_str() { entry["apiKey"] = json!(key.trim_start_matches('$')); }
        for model in entry["models"].as_array_mut().unwrap() {
            model.as_object_mut().unwrap().remove("thinkingLevelMap");
            if let Some(cap) = provider.models.iter().find(|m| model["id"] == m.id).and_then(|m| m.reasoning.as_ref()).filter(|cap| cap.supported) {
                let efforts: Vec<_> = cap.levels.iter().filter(|level| level.as_str() != "off").collect();
                if !efforts.is_empty() { model["thinking"] = json!({"mode": match cap.control.as_str() { "adaptive" => "anthropic-adaptive", "budget" => "budget", _ => "effort" }, "efforts": efforts}); }
            }
        }
    }
    result
}
