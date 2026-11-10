use super::{convert::{self, Builder}, io, migrate::Session};
use serde_json::{json, Value};
use std::{path::Path, sync::atomic::AtomicBool};

pub(super) fn clean_codex_prompt(text: &str) -> String {
    let mut text = text.to_owned();
    for tag in ["in-app-browser-context", "environment_context"] {
        let opening = format!("<{tag}"); let closing = format!("</{tag}>");
        while let Some(start) = text.find(&opening) {
            let boundary = text.as_bytes().get(start + opening.len());
            if !boundary.is_some_and(|c| *c == b'>' || c.is_ascii_whitespace()) { break; }
            let end = text[start..].find(&closing).map_or(text.len(), |n| start+n+closing.len());
            text.replace_range(start..end, "");
        }
    }
    if let Some(files_start) = text.find("# Files mentioned by the user:") {
        // Codex Desktop writes "## My request for Codex:" or, in newer builds, "## My request:".
        let header = ["## My request for Codex:", "## My request:"].into_iter()
            .find_map(|h| text[files_start..].find(h).map(|n| (files_start + n, h.len())));
        if let Some((request_start, header_len)) = header {
            // Only "## name: path" lines are files; boilerplate such as "Image attachment: true" is dropped.
            let files: Vec<_> = text[files_start..request_start].lines().filter_map(|line| {
                let (name, path) = line.trim().strip_prefix("## ")?.split_once(": ")?;
                Some((name.trim().to_owned(), path.trim().to_owned()))
            }).collect();
            let request = text[request_start + header_len..].trim();
            let listed = files.iter().map(|(name, path)| format!("{name} ({path})")).collect::<Vec<_>>().join(", ");
            return if files.is_empty() { request.into() }
                // An attachment-only message (e.g. a screenshot) is named after what was attached.
                else if request.is_empty() { format!("Attached {}\n\nFiles: {listed}", files.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>().join(", ")) }
                else { format!("{request}\n\nFiles: {listed}") };
        }
    }
    // Newer builds write the request header even when no files are mentioned.
    let text = text.trim();
    ["## My request for Codex:", "## My request:"].into_iter()
        .find_map(|header| text.strip_prefix(header)).unwrap_or(text).trim().into()
}
pub(super) fn subagent(source: &Value, thread_source: &Value) -> bool {
    source.get("subagent").is_some() || source == "subagent" || thread_source == "subagent"
        || source.as_str().and_then(|s| serde_json::from_str::<Value>(s).ok()).is_some_and(|v| v.get("subagent").is_some())
}
pub(super) fn desktop(meta: &Value) -> bool {
    matches!(meta["source"].as_str(), Some("vscode" | "cli")) && !subagent(&meta["source"], &meta["thread_source"])
        // Side chats attached to another thread live inside that thread, not in Codex's sidebar.
        && meta["attached_thread_parent_id"].as_str().is_none_or(str::is_empty)
        && match meta["originator"].as_str().unwrap_or_default() {
            "" | "Codex Desktop" | "codex_work_desktop" => true,
            "codex_cli_rs" => meta["source"] == "cli",
            _ => false,
        }
}
pub(super) fn archived(meta: &Value) -> bool { meta["archived"] == true || meta["archived"] == 1 }
fn prompt(r: &Value) -> String {
    if r["type"] != "event_msg" { return String::new(); }
    let p = &r["payload"];
    if p["type"] == "user_message" {
        let mut text = convert::text(&p["message"]);
        for _ in p["images"].as_array().into_iter().flatten().chain(p["local_images"].as_array().into_iter().flatten()) { text.push_str("\n[image]"); }
        return clean_codex_prompt(&text);
    }
    if p["type"] == "item_completed" && p["item"]["type"] == "UserMessage" {
        return clean_codex_prompt(&convert::text(p["item"].get("content").or_else(|| p["item"].get("text")).unwrap_or(&Value::Null)));
    }
    String::new()
}
pub(super) fn scan_file(path: &Path, cancel: &AtomicBool, cache: &super::migrate::ScanCache) -> Result<Option<Session>, String> {
    super::migrate::cached_session(cache, path, || {
    let mut s = Session::new("codex", path)?;
    let mut subagent = false;
    io::stream(path, cancel, |r| {
        s.observe(&r);
        if r["type"] == "session_meta" {
            let p = &r["payload"];
            s.id = p["id"].as_str().unwrap_or_default().into();
            s.cwd = p["cwd"].as_str().unwrap_or_default().into();
            subagent = self::subagent(&p["source"], &p["thread_source"]);
            s.codex_desktop = desktop(p);
        }
        let p = prompt(&r);
        if !p.is_empty() { s.empty = false; if s.title.is_empty() { s.title = p.lines().next().unwrap_or_default().chars().take(80).collect(); } }
    })?;
    if subagent { return Ok(None); }
    if s.id.is_empty() { return Err("Rollout missing session_meta ID".into()); }
    if s.title.is_empty() { s.title = "Codex chat".into(); }
    s.finish(); Ok(Some(s))
    })
}
fn shell(command: &Value) -> String {
    if let Some(s) = command.as_str() { return s.into(); }
    let parts: Vec<_> = command.as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    if parts.len() == 3 && matches!(parts[0], "bash" | "sh" | "zsh") && matches!(parts[1], "-lc" | "-c") { return parts[2].into(); }
    parts.into_iter().map(quote).collect::<Vec<_>>().join(" ")
}
fn quote(s: &str) -> String { format!("'{}'", s.replace('\'', "'\\''")) }
fn call(id: &str, name: &str, args: Value) -> Value { json!({"type":"toolCall","id":id,"name":name,"arguments":args}) }
fn patch(id: &str, input: &str) -> Vec<Value> {
    let mut calls = vec![];
    let lines: Vec<_> = input.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i]; i += 1;
        let Some((kind, path)) = ["Add", "Update", "Delete"].into_iter().find_map(|k| line.strip_prefix(&format!("*** {k} File: ")).map(|p| (k, p))) else { continue; };
        let start = i;
        while i < lines.len() && !lines[i].starts_with("*** ") { i += 1; }
        match kind {
            "Add" => calls.push(call(id, "write", json!({"path":path,"content":lines[start..i].iter().filter_map(|l| l.strip_prefix('+')).map(|l| format!("{l}\n")).collect::<String>()}))),
            "Delete" => calls.push(call(id, "bash", json!({"command":format!("rm {}",quote(path))}))),
            _ => {
                let mut edits = vec![]; let mut old = String::new(); let mut new = String::new();
                for line in lines[start..i].iter().chain(std::iter::once(&"@@")) {
                    if line.starts_with("@@") {
                        if !old.is_empty() || !new.is_empty() { edits.push(json!({"oldText":old,"newText":new})); old.clear(); new.clear(); }
                    } else if let Some(s) = line.strip_prefix('-') { old.push_str(s); old.push('\n'); }
                    else if let Some(s) = line.strip_prefix('+') { new.push_str(s); new.push('\n'); }
                    else if let Some(s) = line.strip_prefix(' ') { old.push_str(s); old.push('\n'); new.push_str(s); new.push('\n'); }
                }
                calls.push(call(id, "edit", json!({"path":path,"edits":edits})));
            }
        }
    }
    if calls.is_empty() { calls.push(call(id, "apply_patch", json!({"input":input}))); }
    calls
}
pub(super) fn convert(path: &Path, cancel: &AtomicBool, b: &mut Builder) -> Result<(), String> {
    let mut last_prompt = String::new();
    let mut model = "codex".to_owned();
    io::stream(path, cancel, |r| {
        let time = r["timestamp"].as_str().unwrap_or_default();
        let p = &r["payload"];
        if let Some(m) = p["model"].as_str() { model = m.into(); }
        let user = prompt(&r);
        if !user.is_empty() { if user != last_prompt { b.user(&user, time); last_prompt = user; } return; }
        if r["type"] == "compacted" { b.compact(&convert::text(&p["message"])); return; }
        if r["type"] != "response_item" { return; }
        match p["type"].as_str() {
            Some("message") if p["role"] == "assistant" => {
                last_prompt.clear();
                let blocks = p["content"].as_array().into_iter().flatten().filter_map(|v| match v["type"].as_str() {
                    Some("output_text") => Some(json!({"type":"text","text":v["text"]})),
                    Some("image" | "input_image" | "output_image") => Some(json!({"type":"text","text":"[image]"})),
                    _ => None,
                }).collect();
                b.assistant(blocks, &model, time, true);
            }
            Some("function_call" | "custom_tool_call" | "local_shell_call") => {
                last_prompt.clear();
                let id = p["call_id"].as_str().or_else(|| p["id"].as_str()).unwrap_or("call");
                let name = p["name"].as_str().unwrap_or("local_shell_call");
                let args = p["arguments"].as_str().and_then(|s| serde_json::from_str::<Value>(s).ok()).unwrap_or_else(|| if p["arguments"].is_object() { p["arguments"].clone() } else if p["type"] == "local_shell_call" { p["action"].clone() } else { json!({"input":p["input"]}) });
                let calls = match name {
                    "exec_command" => vec![call(id, "bash", json!({"command":args["cmd"]}))],
                    "shell" | "container.exec" | "local_shell_call" => vec![call(id, "bash", json!({"command":shell(args.get("command").or_else(|| args.get("cmd")).unwrap_or(&Value::Null))}))],
                    "apply_patch" => patch(id, p["input"].as_str().or_else(|| args["input"].as_str()).or_else(|| args["patch"].as_str()).unwrap_or_default()),
                    _ => vec![call(id, name, args)],
                };
                b.assistant(calls, &model, time, true);
            }
            Some("function_call_output" | "custom_tool_call_output") => {
                let output = &p["output"];
                let parsed = output.as_str().and_then(|s| serde_json::from_str::<Value>(s).ok());
                let output = parsed.as_ref().and_then(|v| v.get("output")).unwrap_or(output);
                b.result(p["call_id"].as_str().unwrap_or_default(), &convert::text(output), false, time);
            }
            Some(name @ ("web_search_call" | "view_image")) => {
                last_prompt.clear();
                let id = p["id"].as_str().unwrap_or(name);
                let action = p.get("action").cloned().unwrap_or_else(|| json!({"input":p["input"]}));
                b.assistant(vec![call(id, name, action.clone())], &model, time, true);
                let summary = if name == "web_search_call" {
                    format!("Searched: {}", action["query"].as_str().map(str::to_owned).unwrap_or_else(|| action.to_string()))
                } else { "Viewed image (imported).".into() };
                b.result(id, &summary, false, time);
            }
            _ => (),
        }
    })
}

fn history_id(id: &str) -> Result<(), String> {
    if id.len() == 36 && id.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c) || c == b'-') { Ok(()) }
    else { Err("Invalid Codex history thread ID".into()) }
}
pub(super) fn history_counts(path: &Path, cancel: &AtomicBool) -> Result<(std::collections::HashMap<String,u64>, std::collections::HashMap<String,u64>),String> {
    if !path.exists() { return Ok(Default::default()); }
    let counts = |sql| -> Result<std::collections::HashMap<String,u64>,String> {
        Ok(super::parse::sqlite(path,sql,cancel)?.into_iter().filter_map(|r| Some((r["thread_id"].as_str()?.to_owned(),r["count"].as_u64()?))).collect())
    };
    Ok((counts("SELECT thread_id, count(*) AS count FROM thread_items GROUP BY thread_id")?,
        counts("SELECT thread_id, count(*) AS count FROM thread_items WHERE item_type = 'userMessage' GROUP BY thread_id")?))
}
pub(super) fn history_version(s: &Session, cancel: &AtomicBool) -> Result<(u64,u64),String> {
    history_id(&s.id)?;
    let rows=super::parse::sqlite(s.codex_db.as_ref().ok_or("Missing Codex state database")?,&format!("SELECT updated_at_ms,source,originator,thread_source FROM threads WHERE id='{}'",s.id),cancel)?;
    let row=rows.first().filter(|r|desktop(r)).ok_or("Thread is no longer in Codex Desktop")?;
    let count=super::parse::sqlite(&s.path,&format!("SELECT count(*) AS count FROM thread_items WHERE thread_id='{}'",s.id),cancel)?;
    Ok((count.first().and_then(|r|r["count"].as_u64()).unwrap_or(0),row["updated_at_ms"].as_u64().unwrap_or(0)))
}
pub(super) fn history_items(s: &Session, cancel: &AtomicBool, limit: u64, mut item: impl FnMut(Value,i64) -> Result<(),String>) -> Result<(),String> {
    use std::{io::{BufRead,Read}, process::{Command,Stdio}};
    history_id(&s.id)?;
    io::check(cancel)?;
    let sql=format!("PRAGMA trusted_schema=OFF; SELECT json_object('item',item_json,'time',created_at_ms) FROM thread_items WHERE thread_id='{}' ORDER BY rollout_ordinal,updated_at_ordinal",s.id);
    let mut child=Command::new("sqlite3").args(["-init","/dev/null","-readonly","-batch","-noheader",&super::parse::sqlite_uri(&s.path)?,&sql])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e|e.to_string())?;
    let result=(|| {
        let stdout=child.stdout.take().ok_or("Missing Codex history output")?;
        let mut reader=std::io::BufReader::new(stdout.take(limit+1));
        let mut line=vec![]; let mut total=0;
        loop {
            io::check(cancel)?;
            line.clear();
            let n=reader.read_until(b'\n',&mut line).map_err(|e|e.to_string())?;
            if n==0 { break; }
            total+=n as u64;
            if total>limit { return Err("Codex thread history exceeds 200 MB; skipped".into()); }
            let row:Value=serde_json::from_slice(&line).map_err(|e|format!("Invalid Codex history row: {e}"))?;
            let value=serde_json::from_str(row["item"].as_str().ok_or("Missing Codex history item")?).map_err(|e|format!("Invalid Codex history item: {e}"))?;
            item(value,row["time"].as_i64().unwrap_or(0))?;
        }
        Ok(())
    })();
    if result.is_err() { let _=child.kill(); }
    let status=child.wait().map_err(|e|e.to_string())?;
    if result.is_ok() && !status.success() { return Err("Could not read Codex thread history".into()); }
    result
}
fn history_text(value: &Value) -> String {
    if let Some(parts)=value.as_array() {
        return parts.iter().filter_map(|p| {
            if p["type"].as_str().is_some_and(|t|t.to_ascii_lowercase().contains("image")) { Some("[image]") }
            else { p.as_str().or_else(||p["text"].as_str()) }
        }).collect::<Vec<_>>().join("\n");
    }
    convert::text(value)
}
fn history_command(command: &str) -> String {
    for program in ["/bin/zsh","/bin/bash","/bin/sh","zsh","bash","sh"] {
        for flag in ["-lc","-c"] {
            if let Some(command)=command.strip_prefix(&format!("{program} {flag} ")) {
                let command=command.trim();
                if let Some(quoted)=command.strip_prefix('\'').and_then(|s|s.strip_suffix('\'')) { return quoted.replace("'\\''","'"); }
                if let Some(quoted)=command.strip_prefix('"').and_then(|s|s.strip_suffix('"')) {
                    return serde_json::from_str::<String>(command).unwrap_or_else(|_|quoted.replace("\\\"","\"").replace("\\\\","\\"));
                }
                return command.into();
            }
        }
    }
    command.into()
}
pub(super) fn convert_history(s: &Session, cancel: &AtomicBool, b: &mut Builder) -> Result<(),String> {
    history_items(s,cancel,io::LIMIT,|item,ms| {
        let time=chrono::DateTime::from_timestamp_millis(ms).filter(|_|ms!=0).map(|t|t.to_rfc3339()).unwrap_or_else(||s.first_time.clone());
        let id=item["id"].as_str().unwrap_or("history-tool");
        let mut calls=vec![]; let mut output=String::new(); let mut error=false;
        match item["type"].as_str() {
            Some("userMessage") => b.user(&clean_codex_prompt(&history_text(&item["content"])),&time),
            Some("agentMessage") => b.assistant(vec![json!({"type":"text","text":item["text"]})],"codex",&time,true),
            Some("commandExecution") => {
                calls.push(call(id,"bash",json!({"command":history_command(item["command"].as_str().unwrap_or_default())})));
                output=history_text(&item["aggregatedOutput"]);
                error=item["exitCode"].as_i64().is_some_and(|code|code!=0) || matches!(item["status"].as_str(),Some("failed"|"declined"));
            }
            Some("fileChange") => {
                for change in item["changes"].as_array().into_iter().flatten() {
                    let kind=change["kind"].as_str().or_else(||change["kind"]["type"].as_str()).unwrap_or("update");
                    let action=match kind { "add" => "Add", "delete" => "Delete", _ => "Update" };
                    let diff=change["diff"].as_str().unwrap_or_default().lines().filter(|l|l.starts_with("@@") || !l.starts_with("---") && !l.starts_with("+++") && matches!(l.chars().next(),Some(' '|'-'|'+'))).collect::<Vec<_>>().join("\n");
                    calls.extend(patch(id,&format!("*** {action} File: {}\n{diff}\n*** End Patch",change["path"].as_str().unwrap_or_default())));
                }
                output="Imported file changes.".into();
            }
            Some("mcpToolCall") => {
                calls.push(call(id,&format!("mcp__{}__{}",item["server"].as_str().unwrap_or("server"),item["tool"].as_str().unwrap_or("tool")),item["arguments"].clone()));
                error=!item["error"].is_null();
                output=if error { item["error"]["message"].as_str().unwrap_or("Tool failed in Codex").into() } else { history_text(&item["result"]["content"]) };
            }
            Some("webSearch") => {
                calls.push(call(id,"web_search",json!({"query":item["query"]})));
                output=format!("Searched: {}",item["query"].as_str().unwrap_or_default());
            }
            Some("dynamicToolCall") => {
                calls.push(call(id,item["tool"].as_str().or_else(||item["name"].as_str()).unwrap_or("tool"),item["arguments"].clone()));
                output=history_text(&item["contentItems"]);
                error=item["success"]==false;
            }
            Some(name @ ("imageView"|"imageGeneration")) => { calls.push(call(id,name,json!({"path":item["path"]}))); output="[image]".into(); }
            Some("contextCompaction") => {
                if let Some(summary)=item["summary"].as_str().or_else(||item["text"].as_str()).filter(|s|!s.is_empty()) { b.compact(summary); }
            }
            _ => (),
        }
        if !calls.is_empty() { b.assistant(calls,"codex",&time,true); b.result(id,&output,error,&time); }
        Ok(())
    })
}
