use crate::types::{AppSettings, EngineDefinition, EngineProtocol, Features};
use serde_json::{json, Value};
use std::{collections::HashMap, path::{Path, PathBuf}, time::Duration};
use tokio::{io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader}, process::Command};

/// A CLI that speaks ACP, signs in on its own and owns its model list. nucode runs no login flow for it.
pub(crate) struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub binaries: &'static [&'static str],
    pub signin: &'static str,
    pub install: &'static str,
    pub no_browser: bool,
}
pub(crate) const PRESETS: [Preset; 3] = [
    Preset { id: "antigravity", name: "Antigravity", binaries: &["agy"], signin: "agy", install: "Install Google's Antigravity CLI (`agy`)", no_browser: true },
    Preset { id: "opencode", name: "OpenCode", binaries: &["opencode"], signin: "opencode auth login", install: "Install with `npm i -g opencode-ai` or from opencode.ai", no_browser: false },
    Preset { id: "cursor", name: "Cursor", binaries: &["cursor-agent", "agent"], signin: "cursor-agent login", install: "Install the Cursor CLI from cursor.com/cli", no_browser: false },
];
pub(crate) fn preset(id: &str) -> Option<&'static Preset> { PRESETS.iter().find(|p| p.id == id) }
impl Preset {
    pub fn signin_error(&self) -> String { format!("{} isn't signed in. Run `{}` in Terminal, then try again.", self.name, self.signin) }
}
pub(crate) fn registry(settings: &AppSettings) -> Vec<EngineDefinition> {
    let mut engines: Vec<_> = [("pi", "pi", EngineProtocol::PiRpc), ("omp", "oh-my-pi", EngineProtocol::PiRpc), ("codex", "Codex", EngineProtocol::CodexAppServer), ("claude", "Claude Code", EngineProtocol::Acp)].into_iter()
        .map(|(id, name, protocol)| (id, name.to_owned(), protocol))
        .chain(PRESETS.iter().map(|p| (p.id, p.name.to_owned(), EngineProtocol::Acp))).map(|(id, name, protocol)| EngineDefinition {
        id: id.into(), name, protocol, built_in: true,
        enabled: settings.engines.iter().find(|e| e.id == id).map_or(id != "omp" && preset(id).is_none(), |e| e.enabled),
        command: None, args: if preset(id).is_some() { vec!["acp".into()] } else { vec![] }, env: HashMap::new(), config_dir_env: None, description: None,
    }).collect();
    engines.extend(settings.engines.iter().filter(|e| !engines_id(&e.id)).cloned());
    engines
}
fn engines_id(id: &str) -> bool { matches!(id, "pi" | "omp" | "codex" | "claude") || preset(id).is_some() }
fn is_executable_file(p: &Path) -> bool {
    p.is_file() && {
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; p.metadata().is_ok_and(|m| m.permissions().mode() & 0o111 != 0) }
        #[cfg(not(unix))] { true }
    }
}
/// PATH plus the directories a GUI launch usually lacks.
pub(crate) fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    for extra in crate::backend::app_server::extra_path_dirs(None) { if !dirs.contains(&extra) { dirs.push(extra); } }
    dirs
}
/// The first candidate binary found. The generic name `agent` only counts when it really is Cursor's.
pub(crate) fn find_binary(preset: &Preset, dirs: &[PathBuf]) -> Option<PathBuf> {
    preset.binaries.iter().find_map(|name| dirs.iter().map(|d| d.join(name)).find(|p| is_executable_file(p) && (*name != "agent" || p.canonicalize().is_ok_and(|c| c.to_string_lossy().to_ascii_lowercase().contains("cursor")))))
}
pub(crate) fn resolve_preset_binary(preset: &Preset) -> Result<PathBuf, String> {
    find_binary(preset, &search_dirs()).ok_or_else(|| format!("Not installed. {}", preset.install))
}
/// Environment for a self-signed-in agent: the user's real HOME and nothing else secret.
pub(crate) fn own_login_environment(parent: impl IntoIterator<Item=(String, String)>, path: &std::ffi::OsStr, preset: &Preset) -> HashMap<String, String> {
    let mut env: HashMap<_, _> = parent.into_iter().filter(|(key, _)| {
        let upper = key.to_ascii_uppercase();
        let allowed = matches!(upper.as_str(), "HOME" | "USER" | "LOGNAME" | "SHELL" | "LANG" | "TMPDIR" | "TERM" | "SYSTEMROOT" | "WINDIR" | "USERPROFILE" | "APPDATA" | "LOCALAPPDATA") || upper.starts_with("LC_") || upper.starts_with("XDG_");
        allowed && !upper.starts_with("OMP_AUTH_") && !["KEY", "TOKEN", "SECRET", "PASSWORD"].iter().any(|part| upper.contains(part))
    }).collect();
    env.insert("PATH".into(), path.to_string_lossy().into());
    env.insert("OTEL_SDK_DISABLED".into(), "true".into());
    if preset.no_browser { env.insert("NO_BROWSER".into(), "true".into()); }
    env
}
pub(crate) fn own_login_path() -> std::ffi::OsString { std::env::join_paths(search_dirs()).unwrap_or_default() }
/// Antigravity before 1.5.0 has no steering and rejects what nucode sends. Unparsable versions pass.
pub(crate) fn antigravity_version_error(version: Option<&str>) -> Option<&'static str> {
    let parts: Vec<u32> = version?.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).take(2).filter_map(|s| s.parse().ok()).collect();
    (version?.starts_with(|c: char| c.is_ascii_digit()) && parts.len() == 2 && (parts[0], parts[1]) < (1, 5)).then_some("Update the Antigravity CLI to 1.5 or newer")
}
pub(crate) fn resolve(settings: &AppSettings, id: &str) -> Result<(EngineDefinition, Option<String>), String> {
    let engines = registry(settings);
    if let Some(engine) = engines.iter().find(|e| e.id == id) { return Ok((engine.clone(), None)); }
    let engine = engines.iter().find(|e| e.id == settings.agent_policy.default_engine && e.enabled)
        .or_else(|| engines.iter().find(|e| e.id == "pi" && e.enabled))
        .or_else(|| engines.iter().find(|e| e.enabled)).ok_or("Enable an engine in Settings")?.clone();
    let notice = format!("Unknown engine {id}; using {}.", engine.name);
    Ok((engine, Some(notice)))
}
pub(crate) fn settings(data: Option<&Path>) -> AppSettings {
    data.and_then(|p| crate::storage::read_settings(&p.join("settings.json")).ok()).unwrap_or_default()
}
pub(crate) fn features(data: Option<&Path>) -> Features { settings(data).features() }
pub(crate) fn executable(command: &str) -> Result<PathBuf, String> {
    let candidates = if Path::new(command).components().count() > 1 { vec![PathBuf::from(command)] }
        else { std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).map(|p| p.join(command)).collect() };
    candidates.into_iter().find(|p| is_executable_file(p)).ok_or_else(|| format!("Command must exist and be executable: {command}"))
}
fn env_name(key: &str) -> bool {
    !key.is_empty() && !key.as_bytes()[0].is_ascii_digit() && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
pub(crate) fn validate(engine: &EngineDefinition) -> Result<(), String> {
    if engine.id.is_empty() || !engine.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') || engine.name.trim().is_empty() { return Err("Engine needs a name and a safe, unique ID".into()); }
    if engines_id(&engine.id) { return Ok(()); }
    if engine.built_in || engine.protocol == EngineProtocol::CodexAppServer { return Err("Custom engines must use ACP or pi-RPC".into()); }
    executable(engine.command.as_deref().filter(|s| !s.is_empty()).ok_or("Missing engine command")?)?;
    for key in engine.env.keys() {
        let upper = key.to_ascii_uppercase();
        if ["KEY", "TOKEN", "SECRET", "PASSWORD"].iter().any(|part| upper.contains(part)) { return Err(format!("{key}: use a provider instead")); }
        if !env_name(key) || matches!(upper.as_str(), "HOME" | "PATH" | "NODE_OPTIONS" | "BUN_OPTIONS" | "LD_PRELOAD" | "DYLD_INSERT_LIBRARIES" | "PI_CODING_AGENT_DIR" | "PI_CONFIG_DIR") || upper.starts_with("OTEL_") || upper.starts_with("OMP_AUTH_") { return Err(format!("Reserved environment variable: {key}")); }
    }
    if engine.config_dir_env.as_ref().is_some_and(|key| !env_name(key)) { return Err("Invalid config-dir environment variable name".into()); }
    Ok(())
}
pub(crate) fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    for engine in &settings.engines { validate(engine)?; if !ids.insert(&engine.id) { return Err("Duplicate engine ID".into()); } }
    if settings.auto_compact.percent.is_some_and(|p| !(50..=95).contains(&p)) { return Err("Auto-compact percent must be between 50 and 95".into()); }
    if settings.providers.iter().flat_map(|p| &p.models).any(|m| m.context_window.is_some_and(|n| !(8_000..=10_000_000).contains(&n))) { return Err("Context size must be between 8,000 and 10,000,000 tokens".into()); }
    if settings.providers.iter().flat_map(|p| &p.models).any(|m| m.compact_at.is_some_and(|n| n < 1_000 || n >= m.window())) { return Err("The auto-compact point must be at least 1,000 tokens and below the context size".into()); }
    if !registry(settings).iter().any(|e| e.enabled) { return Err("Keep at least one engine enabled".into()); }
    Ok(())
}
pub(crate) fn environment(parent: impl IntoIterator<Item=(String, String)>, home: &Path) -> HashMap<String, String> {
    let mut env: HashMap<_, _> = parent.into_iter().filter(|(key, _)| matches!(key.as_str(), "PATH" | "LANG" | "TMPDIR" | "SYSTEMROOT" | "WINDIR" | "TERM")).collect();
    env.insert("HOME".into(), home.to_string_lossy().into());
    env.insert("XDG_CONFIG_HOME".into(), home.to_string_lossy().into());
    env.insert("OTEL_SDK_DISABLED".into(), "true".into());
    env
}
pub(crate) async fn test(data: &Path, engine: &EngineDefinition) -> Result<Value, String> {
    match preset(&engine.id) {
        Some(preset) => test_own_login(engine, preset, &search_dirs(), std::env::vars().collect()).await,
        None => test_isolated(data, engine).await,
    }
}
/// Handshake with a self-signed-in agent: real HOME, `initialize` only, never a session.
pub(crate) async fn test_own_login(engine: &EngineDefinition, preset: &Preset, dirs: &[PathBuf], parent: Vec<(String, String)>) -> Result<Value, String> {
    let program = find_binary(preset, dirs).ok_or_else(|| format!("Not installed. {}", preset.install))?;
    let mut command = Command::new(program);
    command.args(["acp"]).env_clear().envs(own_login_environment(parent, &std::env::join_paths(dirs).unwrap_or_default(), preset))
        .current_dir(std::env::temp_dir()).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
    let result = handshake(engine, command).await?;
    if preset.id == "antigravity" {
        if let Some(error) = antigravity_version_error(result["version"].as_str()) { return Err(error.into()); }
    }
    Ok(result)
}
async fn test_isolated(data: &Path, engine: &EngineDefinition) -> Result<Value, String> {
    validate(engine)?;
    let home = data.join("engine-tests").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    let result = async {
        let mut command = Command::new(executable(engine.command.as_deref().ok_or("Missing engine command")?)?);
        command.args(&engine.args).env_clear().envs(environment(std::env::vars(), &home)).envs(&engine.env)
            .env(engine.config_dir_env.as_deref().unwrap_or("PI_CODING_AGENT_DIR"), &home)
            .current_dir(&home).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).kill_on_drop(true);
        if engine.protocol == EngineProtocol::PiRpc { command.args(["--mode", "rpc"]); }
        handshake(engine, command).await
    }.await;
    let _ = std::fs::remove_dir_all(home);
    result
}
async fn handshake(engine: &EngineDefinition, mut command: Command) -> Result<Value, String> {
    {
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let mut stderr = child.stderr.take().ok_or("Missing stderr")?;
        let mut diagnostics = tokio::spawn(async move {
            let mut excerpt = Vec::new();
            let mut buffer = [0; 1024];
            while let Ok(count) = stderr.read(&mut buffer).await {
                if count == 0 { break; }
                excerpt.extend_from_slice(&buffer[..count]);
                if excerpt.len() > 4096 { excerpt.drain(..excerpt.len() - 4096); }
            }
            String::from_utf8_lossy(&excerpt).trim().to_owned()
        });
        let request = match engine.protocol {
            EngineProtocol::Acp => json!({"jsonrpc":"2.0","id":"nucode-test","method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"nucode","version":"1"}}}),
            EngineProtocol::PiRpc => json!({"id":"nucode-test","type":"get_state"}),
            _ => return Err("Custom engines must use ACP or pi-RPC".into()),
        };
        let mut input = child.stdin.take().ok_or("Missing stdin")?;
        input.write_all(format!("{request}\n").as_bytes()).await.map_err(|e| e.to_string())?;
        let mut lines = BufReader::new(child.stdout.take().ok_or("Missing stdout")?).lines();
        let result = tokio::time::timeout(Duration::from_secs(15), async {
            while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
                let value: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
                if value["id"] == "nucode-test" {
                    if value.get("error").is_some() || value["success"] == false { return Err("Engine rejected the protocol handshake".into()); }
                    if engine.protocol == EngineProtocol::Acp && !value["result"]["protocolVersion"].is_number() { return Err("Invalid ACP initialize response".into()); }
                    if engine.protocol == EngineProtocol::PiRpc && (value["type"] != "response" || value["success"] != true || !value["data"].is_object()) { return Err("Invalid pi-RPC get_state response".into()); }
                    let version = value.pointer("/result/agentInfo/version").or_else(|| value.pointer("/data/version")).and_then(Value::as_str);
                    let message = version.map_or_else(|| "Protocol handshake passed (version not reported)".to_owned(), |version| format!("Protocol handshake passed · v{version}"));
                    return Ok(json!({"engine":engine.id,"state":"ready","message":message,"version":version}));
                }
            }
            Err("Engine exited before handshake".into())
        }).await.unwrap_or_else(|_| Err("Engine handshake timed out".into()));
        let _ = child.kill().await;
        let _ = child.wait().await;
        let excerpt = tokio::time::timeout(Duration::from_millis(200), &mut diagnostics).await.ok().and_then(Result::ok).unwrap_or_default();
        diagnostics.abort();
        result.map_err(|error| if excerpt.is_empty() { error } else { format!("{error}\nStderr: {excerpt}") })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn migration_and_resolution() {
        let settings: AppSettings = serde_json::from_value(json!({})).unwrap();
        assert_eq!(settings.features(), Features::default());
        for id in ["pi", "codex", "claude"] { assert_eq!(serde_json::from_value::<crate::types::EngineKind>(json!(id)).unwrap(), id); assert!(resolve(&settings,id).unwrap().1.is_none()); }
        assert_eq!(resolve(&settings,"missing").unwrap().0.id,"pi");
        assert!(resolve(&settings,"missing").unwrap().1.is_some());
        assert_eq!(resolve(&settings,"omp").unwrap().0.protocol,EngineProtocol::PiRpc);
    }
    #[test] fn environment_is_isolated() {
        let env = environment([("OMP_AUTH_BROKER_TOKEN".into(),"secret".into()),("OTEL_EXPORTER_OTLP_ENDPOINT".into(),"bad".into()),("HOME".into(),"user".into())],Path::new("/isolated"));
        assert_eq!(env["HOME"],"/isolated"); assert_eq!(env["OTEL_SDK_DISABLED"],"true"); assert_eq!(env.len(),3);
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    fn custom(protocol: EngineProtocol) -> EngineDefinition {
        EngineDefinition { id: "custom".into(), name: "Test".into(), protocol, built_in: false, command: Some("python3".into()), args: vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/engine_handshake.py").to_string_lossy().into(), if protocol == EngineProtocol::Acp { "acp" } else { "pi" }.into()], env: HashMap::new(), config_dir_env: Some("TEST_CONFIG_DIR".into()), enabled: true, description: None }
    }
    #[test] fn custom_validation_and_disabled_resolution() {
        let mut definition = custom(EngineProtocol::PiRpc);
        validate(&definition).unwrap();
        definition.env.insert("access_TOKEN".into(), "do-not-store".into());
        assert!(validate(&definition).unwrap_err().contains("use a provider instead"));
        definition.env.clear(); definition.command = Some("/no/such/command".into());
        assert!(validate(&definition).is_err());
        let mut settings = AppSettings::default();
        let mut pi = resolve(&settings,"pi").unwrap().0; pi.enabled = false; settings.engines.push(pi);
        assert!(!resolve(&settings,"pi").unwrap().0.enabled);
    }
    #[tokio::test] async fn custom_protocol_handshakes() {
        let data = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        for protocol in [EngineProtocol::Acp, EngineProtocol::PiRpc] {
            let response = test(&data,&custom(protocol)).await.unwrap();
            assert_eq!(response["state"], "ready");
            assert_eq!(response["version"], "1.2.3");
        }
        let mut broken = custom(EngineProtocol::Acp);
        broken.args[1] = "fail".into();
        assert!(test(&data, &broken).await.unwrap_err().contains("Stderr: fixture startup failed"));
        std::fs::remove_dir_all(data).unwrap();
    }
    #[test] fn feature_tool_filtering_is_shared_by_all_transports() {
        let mut settings = AppSettings::default(); settings.computer.enabled = true;
        settings.features.browser = false; settings.features.computer_use = false;
        let entries = crate::shared::connectors::effective(&settings, &Default::default(), None).unwrap();
        assert!(entries.iter().filter(|e| matches!(e.id.as_str(),"nucode-browser"|"nucode-computer")).all(|e| !e.enabled));
        settings.features.connectors = false;
        let entries = crate::shared::connectors::effective(&settings, &Default::default(), None).unwrap();
        assert!(entries.iter().all(|e| !e.enabled));
        settings.features.git = false;
        assert!(!settings.features().worktrees); assert!(settings.features().checkpoints);
        let policy = crate::shared::engines::feature_policy(settings.agent_policy, &Features { subagents: false, ..Features::default() });
        assert!(!policy.subagents.enabled); assert_eq!(policy.subagents.max_concurrent,0);
    }
}

#[cfg(test)]
mod own_login_tests {
    use super::*;
    fn script(dir: &Path, name: &str, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        let file = dir.join(name);
        std::fs::write(&file, format!("#!/usr/bin/env python3\n{body}")).unwrap();
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap(); }
    }
    fn builtin(id: &str) -> EngineDefinition { registry(&AppSettings::default()).into_iter().find(|e| e.id == id).unwrap() }
    #[test] fn built_ins_are_listed_disabled_and_valid() {
        let settings = AppSettings::default();
        for (id, name) in [("antigravity", "Antigravity"), ("opencode", "OpenCode"), ("cursor", "Cursor")] {
            let engine = builtin(id);
            assert_eq!((engine.name.as_str(), engine.enabled, engine.built_in, engine.protocol, engine.args.as_slice()), (name, false, true, EngineProtocol::Acp, ["acp".to_string()].as_slice()));
            validate(&engine).unwrap();
            assert_eq!(registry(&settings).iter().filter(|e| e.id == id).count(), 1);
        }
        let mut saved = AppSettings::default();
        saved.engines.push(EngineDefinition { enabled: true, ..builtin("opencode") });
        assert!(registry(&saved).iter().find(|e| e.id == "opencode").unwrap().enabled);
        assert_eq!(registry(&saved).iter().filter(|e| e.id == "opencode").count(), 1);
        validate_settings(&saved).unwrap();
    }
    #[tokio::test] async fn handshake_uses_the_real_home_and_reports_missing_binaries() {
        let root = std::env::temp_dir().join(format!("nucode-own-{}", uuid::Uuid::new_v4()));
        let dirs = vec![root.clone(), "/usr/bin".into(), "/bin".into(), "/usr/local/bin".into(), "/opt/homebrew/bin".into()];
        let parent = vec![("HOME".to_string(), "/home/real".to_string()), ("OPENAI_API_KEY".into(), "k".into()), ("PATH".into(), "/ambient".into())];
        let opencode = preset("opencode").unwrap();
        let missing = test_own_login(&builtin("opencode"), opencode, &dirs, parent.clone()).await.unwrap_err();
        assert_eq!(missing, "Not installed. Install with `npm i -g opencode-ai` or from opencode.ai");
        assert_eq!(test_own_login(&builtin("cursor"), preset("cursor").unwrap(), &dirs, parent.clone()).await.unwrap_err(), "Not installed. Install the Cursor CLI from cursor.com/cli");
        let reply = |version: &str| format!("import json, os, sys\nassert sys.argv[1:] == ['acp']\nassert os.environ['HOME'] == '/home/real' and 'OPENAI_API_KEY' not in os.environ and 'XDG_CONFIG_HOME' not in os.environ\nrequest = json.loads(sys.stdin.readline())\nassert request['method'] == 'initialize'\nprint(json.dumps({{'jsonrpc':'2.0','id':request['id'],'result':{{'protocolVersion':1,'agentInfo':{{'version':'{version}'}}}}}}), flush=True)\nfor line in sys.stdin:\n    raise SystemExit('only initialize may be sent: ' + line)\n");
        script(&root, "opencode", &reply("0.9.1"));
        let ok = test_own_login(&builtin("opencode"), opencode, &dirs, parent.clone()).await.unwrap();
        assert_eq!((ok["state"].as_str(), ok["version"].as_str()), (Some("ready"), Some("0.9.1")));
        script(&root, "agy", &reply("1.4.2"));
        assert_eq!(test_own_login(&builtin("antigravity"), preset("antigravity").unwrap(), &dirs, parent.clone()).await.unwrap_err(), "Update the Antigravity CLI to 1.5 or newer");
        script(&root, "agy", &reply("1.5.3"));
        assert_eq!(test_own_login(&builtin("antigravity"), preset("antigravity").unwrap(), &dirs, parent).await.unwrap()["version"], "1.5.3");
        std::fs::remove_dir_all(root).unwrap();
    }
}
