use super::{io, Entry, Roots};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

pub(super) fn text(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        return s.into();
    }
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| p.as_str().or_else(|| p["text"].as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}
pub(super) fn messages(entries: &[Value]) -> Vec<Value> {
    entries
        .iter()
        .filter_map(|v| {
            let m = if v["message"].is_object() {
                &v["message"]
            } else if v["payload"].is_object() {
                &v["payload"]
            } else {
                v
            };
            let role = m["role"].as_str().or_else(|| v["type"].as_str())?;
            if !["user", "assistant"].contains(&role) {
                return None;
            }
            let content = text(&m["content"]);
            let content = if content.is_empty() {
                text(&m["text"])
            } else {
                content
            };
            if content.is_empty() {
                None
            } else {
                Some(json!({"role":role,"text":content}))
            }
        })
        .collect()
}

pub(super) fn exports(value: Value) -> Result<Vec<Entry>, String> {
    let mut result = vec![];
    for chat in value
        .as_array()
        .ok_or("Expected a conversations.json array")?
    {
        let claude = chat["chat_messages"].is_array();
        let source = if claude { "claude.ai" } else { "chatgpt" };
        let id = chat[if claude { "uuid" } else { "id" }]
            .as_str()
            .ok_or("Conversation has no ID")?;
        let mut entry = Entry::new(
            source,
            id,
            "chat",
            chat[if claude { "name" } else { "title" }]
                .as_str()
                .unwrap_or("Imported chat"),
            "Chats",
            "",
        );
        let mut turns = vec![];
        if claude {
            for m in chat["chat_messages"].as_array().unwrap() {
                let role = match m["sender"].as_str() {
                    Some("human") => "user",
                    Some("assistant") => "assistant",
                    _ => continue,
                };
                let blocks = text(&m["content"]);
                turns.push(json!({"role":role,"text":if blocks.is_empty() {text(&m["text"])} else {blocks}}));
            }
        } else {
            let mut current = chat["current_node"].as_str();
            let mut seen = HashSet::new();
            while let Some(id) = current {
                if !seen.insert(id) {
                    return Err("Cyclic ChatGPT branch".into());
                }
                let node = chat["mapping"]
                    .get(id)
                    .ok_or("Missing ChatGPT branch node")?;
                let m = &node["message"];
                if let Some(role @ ("user" | "assistant" | "system")) = m["author"]["role"].as_str()
                {
                    turns.push(json!({"role":role,"text":text(&m["content"]["parts"])}));
                }
                current = node["parent"].as_str();
            }
            turns.reverse();
        }
        entry.messages = turns;
        result.push(entry);
    }
    Ok(result)
}

fn command(program: &str, args: &[&str], cancel: &AtomicBool) -> Result<Vec<u8>, String> {
    use std::{
        io::Read,
        process::{Command, Stdio},
    };
    io::check(cancel)?;
    let mut child = Command::new(program)
        .args(args)
        .env_remove("UNZIP")
        .env_remove("UNZIPOPT")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let result = (|| {
        let mut out = child.stdout.take().ok_or("Missing command output")?;
        let mut bytes = vec![];
        let mut chunk = [0; 65536];
        loop {
            io::check(cancel)?;
            let n = out.read(&mut chunk).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            if bytes.len() as u64 + n as u64 > io::LIMIT {
                return Err("Export exceeds 200 MB".into());
            }
            bytes.extend_from_slice(&chunk[..n]);
        }
        Ok(bytes)
    })();
    if result.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() && result.is_ok() {
        return Err(format!("{program} could not read the source"));
    }
    result
}
pub(super) fn export_file(path: &Path, cancel: &AtomicBool) -> Result<Vec<Entry>, String> {
    if !path.is_absolute() {
        return Err("Choose an absolute export path".into());
    }
    io::safe(path)?;
    let bytes = if path.extension().and_then(|s| s.to_str()) == Some("zip") {
        // Stream only this member. Never extract paths or execute export contents.
        command(
            "unzip",
            &[
                "-p",
                path.to_str().ok_or("Invalid export path")?,
                "conversations.json",
            ],
            cancel,
        )?
    } else if path.file_name().and_then(|s| s.to_str()) == Some("conversations.json") {
        io::read(path, cancel)?
    } else {
        return Err("Choose a .zip or conversations.json".into());
    };
    let mut value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    io::scrub(&mut value);
    exports(value)
}

fn connector(source: &str, name: &str, value: &Value) -> Option<Entry> {
    if name.starts_with("mcp-oauth") {
        return None;
    }
    let mut entry = Entry::new(source, name, "connector", name, "MCP servers", "");
    let keys = |v: &Value| -> Value {
        json!(v
            .as_object()
            .map(|m| m
                .keys()
                .map(|k| (k.clone(), json!({"secret":true})))
                .collect::<serde_json::Map<_, _>>())
            .unwrap_or_default())
    };
    let transport = if value["command"].is_string() {
        json!({"type":"stdio","command":value["command"],"args":value["args"].as_array().cloned().unwrap_or_default(),"env":keys(&value["env"]),"cwd":null})
    } else if value["url"].is_string() {
        let mut headers = keys(&value["headers"]);
        for field in ["http_headers", "env_http_headers"] {
            if let Some(m) = keys(&value[field]).as_object() {
                headers.as_object_mut().unwrap().extend(m.clone());
            }
        }
        json!({"type":"http","url":value["url"],"headers":headers,"bearer":if value["bearer_token_env_var"].is_string() {json!({"secret":true})} else {Value::Null}})
    } else {
        return None;
    };
    entry.needs_secrets = transport["env"].as_object().is_some_and(|m| !m.is_empty())
        || transport["headers"]
            .as_object()
            .is_some_and(|m| !m.is_empty())
        || !transport["bearer"].is_null();
    entry.payload = transport;
    Some(entry)
}

pub(super) fn detect(
    roots: &Roots,
    cancel: &AtomicBool,
    cache: &super::migrate::ScanCache,
) -> Result<(Vec<Entry>, Vec<String>), String> {
    let mut entries = vec![];
    let mut warnings = vec![];
    let mut attempt = |label: &str, result: Result<Vec<Entry>, String>| match result {
        Ok(items) => entries.extend(items),
        Err(e) => warnings.push(format!("{label}: {e}")),
    };
    attempt("Codex", codex(&roots.codex, cancel, cache, true));
    attempt("Claude", claude(roots, cancel, cache));
    let config = roots.desktop.join("claude_desktop_config.json");
    if config.exists() {
        attempt(
            "Claude MCP",
            io::read(&config, cancel)
                .and_then(|bytes| {
                    serde_json::from_slice::<Value>(&bytes).map_err(|e| e.to_string())
                })
                .map(|v| {
                    v["mcpServers"]
                        .as_object()
                        .map(|m| {
                            m.iter()
                                .filter_map(|(k, v)| connector("claude-mcp", k, v))
                                .collect()
                        })
                        .unwrap_or_default()
                }),
        );
    }
    let config = roots.codex.join("config.toml");
    if config.exists() {
        let result = (|| {
            let bytes = io::read(&config, cancel)?;
            let doc = std::str::from_utf8(&bytes)
                .map_err(|e| e.to_string())?
                .parse::<toml_edit::Document>()
                .map_err(|_| "Invalid Codex config.toml")?;
            let mut result = vec![];
            if let Some(servers) = doc.get("mcp_servers").and_then(|s| s.as_table_like()) {
                for (name, server) in servers.iter() {
                    if name.starts_with("mcp-oauth") {
                        continue;
                    }
                    let mut value = json!({});
                    for field in ["command", "url", "bearer_token_env_var"] {
                        if let Some(s) = server.get(field).and_then(|s| s.as_str()) {
                            value[field] = json!(s);
                        }
                    }
                    value["args"] = json!(server
                        .get("args")
                        .and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|s| s.as_str()).collect::<Vec<_>>())
                        .unwrap_or_default());
                    for field in ["env", "http_headers", "env_http_headers"] {
                        if let Some(table) = server.get(field).and_then(|v| v.as_table_like()) {
                            value[field] = json!(table
                                .iter()
                                .map(|(k, _)| (k.to_string(), Value::Null))
                                .collect::<serde_json::Map<_, _>>());
                        }
                    }
                    if let Some(entry) = connector("codex-mcp", name, &value) {
                        result.push(entry);
                    }
                }
            }
            Ok(result)
        })();
        attempt("Codex MCP", result);
    }
    io::check(cancel)?;
    let mut seen = HashSet::new();
    entries.retain(|e| seen.insert(e.key.clone()));
    Ok((entries, warnings))
}

pub(super) fn sqlite_uri(path: &Path) -> Result<String, String> {
    io::safe(path)?;
    Ok(format!("{}?mode=ro&immutable=1", reqwest::Url::from_file_path(path).map_err(|_| "Invalid SQLite path")?))
}
pub(super) fn sqlite(path: &Path, sql: &str, cancel: &AtomicBool) -> Result<Vec<Value>, String> {
    let bytes = command("sqlite3", &["-init", "/dev/null", "-readonly", "-json", &sqlite_uri(path)?, &format!("PRAGMA trusted_schema=OFF; {sql}")], cancel)?;
    if bytes.is_empty() { return Ok(vec![]); }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn codex_metadata(root: &Path, cancel: &AtomicBool) -> Result<(Vec<Entry>, HashMap<String, Value>, Option<PathBuf>), String> {
    let mut result = vec![];
    let mut threads = HashMap::new();
    let mut projects = HashMap::new();
    let files = io::files(root, 0, cancel)?;
    let db = files
        .iter()
        .filter_map(|p| {
            p.file_name()?
                .to_str()?
                .strip_prefix("state_")?
                .strip_suffix(".sqlite")?
                .parse::<u32>()
                .ok()
                .map(|n| (n, p))
        })
        .max_by_key(|(n, _)| *n);
    let database = db.map(|(_,path)| path.clone());
    if let Some(db) = &database {
        io::safe(db)?;
        let query = |sql: &str| sqlite(db, sql, cancel);
        if let (Ok(ps), Ok(rs)) = (
            query("SELECT id,name FROM projects"),
            query("SELECT project_id,path FROM project_roots ORDER BY position"),
        ) {
            for p in ps {
                projects.insert(
                    p["id"].as_str().unwrap_or_default().to_owned(),
                    p["name"].as_str().unwrap_or("Imported project").to_owned(),
                );
            }
            for r in rs {
                let id = r["project_id"].as_str().unwrap_or_default();
                let path = r["path"].as_str().unwrap_or_default();
                result.push(Entry::new(
                    "codex-project",
                    &format!("{id}:{path}"),
                    "project",
                    projects
                        .get(id)
                        .map(String::as_str)
                        .unwrap_or("Imported project"),
                    "Projects",
                    path,
                ));
            }
        }
        let columns = query("PRAGMA table_info(threads)")?;
        let fields: Vec<_> = ["id", "rollout_path", "source", "originator", "thread_source", "archived", "cwd", "name", "title", "first_user_message", "created_at_ms", "updated_at_ms", "model", "attached_thread_parent_id"].into_iter().filter(|field| columns.iter().any(|c| c["name"] == *field)).collect();
        let ts = query(&format!("SELECT {} FROM threads", fields.join(",")))?;
        {
            for t in ts {
                if let Some(id) = t["id"].as_str() { threads.insert(id.to_owned(), t); }
            }
        }
    }
    Ok((result, threads, database))
}
pub(super) fn codex_projects(root: &Path, cancel: &AtomicBool) -> Result<Vec<(PathBuf, String)>, String> {
    Ok(codex_metadata(root, cancel)?.0.into_iter().map(|e| (PathBuf::from(e.cwd), e.title)).collect())
}
pub(super) fn codex(root: &Path, cancel: &AtomicBool, cache: &super::migrate::ScanCache, include_archived: bool) -> Result<Vec<Entry>, String> {
    let (mut result, threads, database) = codex_metadata(root, cancel)?;
    let projects: Vec<_> = result.iter().map(|e| (PathBuf::from(&e.cwd), e.title.clone())).collect();
    let mut names = HashMap::new();
    if root.join("session_index.jsonl").exists() {
        io::stream(&root.join("session_index.jsonl"), cancel, |row| {
            if let (Some(id), Some(name)) = (row["id"].as_str(), row["thread_name"].as_str()) {
                names.insert(id.to_owned(), name.to_owned());
            }
        })?;
    }
    if let Some(database) = database {
        let history = root.join("thread_history_1.sqlite");
        let (counts, users) = super::codex::history_counts(&history, cancel)?;
        for row in threads.values().filter(|r| super::codex::desktop(r) && (include_archived || !super::codex::archived(r))) {
            let id = row["id"].as_str().ok_or("Codex thread has no ID")?;
            let rollout = row["rollout_path"].as_str().filter(|p| !p.is_empty()).map(PathBuf::from).map(|p| if p.is_absolute() { p } else { root.join(p) });
            let mut session = if let Some(path) = rollout.filter(|p| p.exists()) {
                match super::codex::scan_file(&path, cancel, cache) {
                    Ok(Some(s)) if s.id == id => s,
                    Ok(_) => { result.push(Entry::failed("codex", &path, "Rollout ID does not match its Desktop thread")); continue; }
                    Err(e) => { result.push(Entry::failed("codex", &path, &e)); continue; }
                }
            } else {
                let mut session = super::migrate::Session::new("codex", &database)?;
                session.id = id.into();
                session.path = history.clone();
                session.history = true;
                session.size = counts.get(id).copied().unwrap_or(0);
                session.mtime = row["updated_at_ms"].as_u64().unwrap_or(0);
                session.empty = users.get(id).copied().unwrap_or(0) == 0;
                session
            };
            session.codex_desktop = true;
            session.codex_db = Some(database.clone());
            if let Some(cwd) = row["cwd"].as_str() { session.cwd = cwd.into(); }
            let fallback = ["first_user_message", "title"].into_iter().filter_map(|key| row[key].as_str()).map(super::codex::clean_codex_prompt).find(|s| !s.is_empty());
            session.title = row["name"].as_str().filter(|s| !s.trim().is_empty())
                .or_else(|| names.get(id).map(String::as_str).filter(|s| !s.trim().is_empty()))
                .map(str::to_owned).or_else(|| fallback.map(|s| s.lines().next().unwrap_or_default().chars().take(80).collect()))
                .unwrap_or_else(|| if session.title.is_empty() { "Codex chat".into() } else { session.title.clone() });
            if let Some(ms) = row["created_at_ms"].as_i64().and_then(chrono::DateTime::from_timestamp_millis) { session.first_time = ms.to_rfc3339(); }
            if let Some(ms) = row["updated_at_ms"].as_i64() { session.updated_at = ms/1000; }
            session.project_roots = projects.clone();
            session.archived = super::codex::archived(row);
            session.finish();
            result.push(session.entry());
        }
    } else {
        for folder in ["sessions", "archived_sessions"] {
            if folder == "archived_sessions" && !include_archived { continue; }
            for path in io::files(&root.join(folder), 16, cancel)? {
                if !path.file_name().and_then(|p| p.to_str()).is_some_and(|p| p.starts_with("rollout-") && p.ends_with(".jsonl")) { continue; }
                let mut session = match super::codex::scan_file(&path, cancel, cache) {
                    Ok(Some(s)) if s.codex_desktop => s,
                    Ok(_) => continue,
                    Err(e) => { result.push(Entry::failed("codex", &path, &e)); continue; }
                };
                if let Some(title) = names.get(&session.id).filter(|s| !s.trim().is_empty()) { session.title = title.clone(); }
                session.archived = folder == "archived_sessions";
                result.push(session.entry());
            }
        }
    }
    Ok(result)
}

fn claude(roots: &Roots, cancel: &AtomicBool, cache: &super::migrate::ScanCache) -> Result<Vec<Entry>, String> {
    let mut result = vec![];
    for (folder, source, kind) in [
        ("local-agent-mode-sessions", "cowork", "work"),
    ] {
        for path in io::files(&roots.desktop.join(folder), 2, cancel)? {
            if !path
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.starts_with("local_") && s.ends_with(".json"))
            {
                continue;
            }
            let value = match io::json(&path, cancel) {
                Ok(v) => v,
                Err(e) => {
                    result.push(Entry::failed(source, &path, &e));
                    continue;
                }
            };
            let Some(id) = value["cliSessionId"]
                .as_str()
                .or_else(|| value["sessionId"].as_str())
            else {
                result.push(Entry::failed(source, &path, "Missing Claude session ID"));
                continue;
            };
            let cwd = if kind == "work" {
                value["userSelectedFolders"][0].as_str().unwrap_or_default()
            } else {
                value["cwd"].as_str().unwrap_or_default()
            };
            let mut entry = Entry::new(
                source,
                id,
                kind,
                value["title"].as_str().unwrap_or("Imported Claude session"),
                cwd,
                cwd,
            );
            entry.archived = value["isArchived"] == true;
            let transcript = Some(path.with_extension("").join("audit.jsonl"));
            if let Some(file) = transcript.filter(|p| p.exists()) {
                match io::jsonl(&file, cancel, kind == "work") {
                    Ok(rows) => {
                        entry.messages = messages(&rows);
                        entry.payload = json!(rows);
                    }
                    Err(e) => entry.warning = Some(e),
                }
            } else {
                entry.warning = Some("Transcript is missing; metadata only".into());
            }
            if kind == "work" {
                let completed = value["status"].as_str().map_or_else(
                    || entry.messages.last().is_some_and(|m| m["role"] == "assistant"),
                    |status| matches!(status, "completed" | "done"),
                );
                entry.work_status = Some(if entry.archived || entry.warning.is_some() || !completed { "stopped" } else { "done" }.into());
                for folder in ["uploads", "outputs"] {
                    let base = path.with_extension("").join(folder);
                    for file in io::files(&base, 16, cancel)? {
                        if io::safe(&file).is_ok() {
                            entry.attachments.push((
                                format!("{folder}/{}", file.strip_prefix(&base).unwrap().display()),
                                file,
                            ));
                        }
                    }
                }
            }
            result.push(entry);
        }
    }
    result.extend(super::claude::scan(roots, cancel, cache)?.into_iter().map(|s| s.entry()));
    Ok(result)
}
