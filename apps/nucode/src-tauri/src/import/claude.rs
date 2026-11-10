use super::{convert::{self, Builder}, io, migrate::Session, Roots};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, path::Path, sync::atomic::AtomicBool};

pub(super) fn clean(text: &str) -> String {
    let mut text = text.to_string();
    for tag in ["system-reminder", "local-command-caveat", "local-command-stdout"] {
        let open = format!("<{tag}>"); let close = format!("</{tag}>");
        while let Some(start) = text.find(&open) {
            let end = text[start..].find(&close).map(|n| start+n+close.len()).unwrap_or(text.len());
            text.replace_range(start..end, "");
        }
    }
    for tag in ["command-name", "command-message", "command-args"] {
        text = text.replace(&format!("<{tag}>"), "").replace(&format!("</{tag}>"), "");
    }
    text.trim().to_owned()
}
fn prompt(row: &Value) -> String {
    if row["type"] != "user" || row["isMeta"] == true || row["isCompactSummary"] == true { return String::new(); }
    clean(&convert::text(&row["message"]["content"]))
}
pub(super) fn scan(roots: &Roots, cancel: &AtomicBool, cache: &super::migrate::ScanCache) -> Result<Vec<Session>, String> {
    let mut metadata = HashMap::new();
    for path in io::files(&roots.desktop.join("claude-code-sessions"), 16, cancel)? {
        if !path.file_name().and_then(|s| s.to_str()).is_some_and(|s| s.starts_with("local_") && s.ends_with(".json")) { continue; }
        if let Ok(v) = io::json(&path, cancel) {
            if let Some(id) = v["cliSessionId"].as_str().or_else(|| v["sessionId"].as_str()) {
                metadata.insert(id.to_owned(), (v.clone(), path));
            }
        }
    }
    let mut sessions = vec![];
    let projects = super::parse::codex_projects(&roots.codex, cancel).unwrap_or_default();
    io::check(cancel)?;
    for path in io::files(&roots.claude.join("projects"), 1, cancel)? {
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") { continue; }
        let Some(mut s) = super::migrate::cached_session(cache, &path, || {
            let mut s = Session::new("claude", &path)?;
            s.id = path.file_stem().unwrap_or_default().to_string_lossy().into();
            let mut summary = String::new(); let mut first = String::new();
            io::stream(&path, cancel, |r| {
                s.observe(&r);
                if r["isSidechain"] == true { return; }
                if r["type"] == "custom-title" { s.custom_title = r["customTitle"].as_str().unwrap_or_default().into(); }
                if r["type"] == "summary" { summary = r["summary"].as_str().unwrap_or_default().into(); }
                let p = prompt(&r);
                if !p.is_empty() { s.empty = false; if first.is_empty() { first = p.lines().next().unwrap_or_default().chars().take(80).collect(); } }
            })?;
            s.title = [summary.as_str(), first.as_str()].into_iter().find(|s| !s.is_empty()).unwrap_or("Claude Code chat").to_owned();
            s.finish(); Ok(Some(s))
        })? else { continue; };
        let desktop = metadata.get(&s.id);
        s.archived = desktop.is_some_and(|(v, _)| v["isArchived"] == true);
        s.metadata = desktop.map(|(_, p)| p.clone());
        let title = [desktop.and_then(|(v, _)| v["title"].as_str()).unwrap_or_default(), s.custom_title.as_str(), s.title.as_str()].into_iter().find(|s| !s.is_empty()).unwrap_or("Claude Code chat").to_owned();
        s.title = title;
        s.project_roots = projects.clone();
        s.finish(); sessions.push(s);
    }
    Ok(sessions)
}
pub(super) fn convert(path: &Path, cancel: &AtomicBool, builder: &mut Builder) -> Result<(), String> {
    // First pass retains only the branch topology, never message payloads.
    let mut parents = HashMap::new(); let mut leaf = String::new(); let mut preferred = None; let mut position = 0;
    io::stream(path, cancel, |r| {
        position += 1;
        if r["isSidechain"] == true { return; }
        if r["type"] == "last-prompt" { preferred = r["leafUuid"].as_str().map(str::to_owned); }
        if let Some(id) = r["uuid"].as_str() {
            // Compaction cuts the physical chain; Claude keeps its original branch
            // in logicalParentUuid so history before the summary is still recoverable.
            let parent = r["parentUuid"].as_str().or_else(|| if r["subtype"] == "compact_boundary" { r["logicalParentUuid"].as_str() } else { None });
            parents.insert(id.to_owned(), (parent.map(str::to_owned), position)); leaf = id.into();
        }
    })?;
    if let Some(id) = preferred.filter(|id| parents.contains_key(id)) { leaf = id; }
    let mut branch = HashSet::new();
    while !leaf.is_empty() && branch.insert(leaf.clone()) { leaf = parents.get(&leaf).and_then(|(parent,_)| parent.clone()).unwrap_or_default(); }
    let mut last_message = String::new();
    position = 0;
    io::stream(path, cancel, |r| {
        position += 1;
        if r["isSidechain"] == true || r["uuid"].as_str().is_some_and(|id| !branch.contains(id) || parents.get(id).is_some_and(|(_,last)| *last != position)) { return; }
        let time = r["timestamp"].as_str().unwrap_or_default();
        let content = &r["message"]["content"];
        if r["type"] == "user" {
            last_message.clear();
            if r["isCompactSummary"] == true { builder.compact(&convert::text(content)); return; }
            if r["isMeta"] == true { return; }
            if let Some(blocks) = content.as_array() {
                for b in blocks.iter().filter(|b| b["type"] == "tool_result") {
                    builder.result(b["tool_use_id"].as_str().unwrap_or_default(), &convert::text(&b["content"]), b["is_error"] == true, time);
                }
            }
            builder.user(&prompt(&r), time);
        } else if r["type"] == "assistant" {
            let id = r["message"]["id"].as_str().unwrap_or_default();
            let mut blocks = vec![];
            if let Some(s) = content.as_str() { blocks.push(json!({"type":"text","text":s})); }
            for b in content.as_array().into_iter().flatten() {
                match b["type"].as_str() {
                    Some("text") => blocks.push(json!({"type":"text","text":clean(b["text"].as_str().unwrap_or_default())})),
                    Some("image") => blocks.push(json!({"type":"text","text":"[image]"})),
                    Some("tool_use") => { let (name, args) = tool(b["name"].as_str().unwrap_or("tool"), &b["input"]); blocks.push(json!({"type":"toolCall","id":b["id"],"name":name,"arguments":args})); }
                    _ => (),
                }
            }
            builder.assistant(blocks, r["message"]["model"].as_str().unwrap_or("claude"), time, !id.is_empty() && id == last_message);
            last_message = id.into();
        }
    })
}
fn tool<'a>(name: &'a str, a: &Value) -> (&'a str, Value) {
    match name {
        "Bash" => ("bash", json!({"command":a["command"]})),
        "Read" => { let mut v = json!({"path":a["file_path"]}); for k in ["offset", "limit"] { if !a[k].is_null() { v[k] = a[k].clone(); } } ("read", v) },
        "Write" => ("write", json!({"path":a["file_path"],"content":a["content"]})),
        "Edit" => ("edit", json!({"path":a["file_path"],"edits":[{"oldText":a["old_string"],"newText":a["new_string"]}]})),
        "MultiEdit" => ("edit", json!({"path":a["file_path"],"edits":a["edits"].as_array().into_iter().flatten().map(|e| json!({"oldText":e["old_string"],"newText":e["new_string"]})).collect::<Vec<_>>()})),
        "Grep" => ("grep", a.clone()), "Glob" => ("find", a.clone()), "LS" => ("ls", a.clone()),
        _ => (name, a.clone()),
    }
}
