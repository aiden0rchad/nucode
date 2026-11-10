use super::{io, migrate::Session, AppSettings};
use serde_json::{json, Value};
use std::{collections::HashSet, path::Path};

pub(super) fn cap(text: &str, limit: usize) -> String {
    if text.len() <= limit { return text.into(); }
    let mut head = limit * 3 / 4 - 64;
    let mut tail = text.len() - limit / 4;
    while !text.is_char_boundary(head) { head -= 1; }
    while !text.is_char_boundary(tail) { tail += 1; }
    format!("{}\n[… {} characters omitted …]\n{}", &text[..head], text[head..tail].chars().count(), &text[tail..])
}
pub(super) fn text(value: &Value) -> String {
    if let Some(s) = value.as_str() { return s.into(); }
    value.as_array().map(|blocks| blocks.iter().filter_map(|b| {
        if matches!(b["type"].as_str(), Some("image" | "input_image")) { Some("[image]") }
        else { b.as_str().or_else(|| b["text"].as_str()) }
    }).collect::<Vec<_>>().join("\n")).unwrap_or_default()
}
fn cap_args(value: &mut Value) {
    match value {
        Value::String(s) => *s = cap(s, 64 * 1024),
        Value::Array(a) => a.iter_mut().for_each(cap_args),
        Value::Object(m) => m.values_mut().for_each(cap_args),
        _ => (),
    }
}
pub(super) fn timestamp(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s).map(|t| t.timestamp_millis()).unwrap_or(0)
}

pub(super) struct Builder {
    rows: Vec<Value>,
    calls: HashSet<String>,
    pending: Vec<(String, String, String)>,
    summary: String,
    summary_at: usize,
    last_time: String,
}
impl Builder {
    pub fn new(session: &Session, id: &str, cwd: &Path, profile: &str, settings: &AppSettings) -> Self {
        let mut header = json!({"type":"session","version":3,"id":id,"cwd":cwd,"timestamp":session.first_time,"engine":profile,"title":session.title,"importedFrom":{"source":session.source,"sessionId":session.id,"path":session.path,"cwd":session.cwd}});
        if let Some(model) = &settings.agent_policy.default_model {
            header["modelProvider"] = json!(model.provider_id); header["model"] = json!(model.model_id);
        }
        Self { rows: vec![header], calls: HashSet::new(), pending: vec![], summary: String::new(), summary_at: 1, last_time: session.first_time.clone() }
    }
    fn push(&mut self, mut entry: Value, time: &str) {
        let time = if timestamp(time) != 0 { time } else { &self.last_time }.to_owned();
        entry["id"] = json!(format!("{:08x}", self.rows.len()));
        entry["parentId"] = self.rows.last().filter(|r| r["type"] != "session").map(|r| r["id"].clone()).unwrap_or(Value::Null);
        entry["timestamp"] = json!(time);
        if entry["type"] == "message" { entry["message"]["timestamp"] = json!(timestamp(&time)); }
        self.last_time = time;
        self.rows.push(entry);
    }
    pub fn flush(&mut self) {
        for (_, id, name) in std::mem::take(&mut self.pending) {
            self.push(json!({"type":"message","message":{"role":"toolResult","toolCallId":id,"toolName":name,"content":[{"type":"text","text":"No result was recorded for this call (imported)."}],"details":{},"isError":true}}), &self.last_time.clone());
        }
    }
    pub fn user(&mut self, text: &str, time: &str) {
        if text.trim().is_empty() { return; }
        self.flush();
        self.push(json!({"type":"message","message":{"role":"user","content":[{"type":"text","text":cap(text,256*1024)}]}}), time);
    }
    pub fn assistant(&mut self, mut blocks: Vec<Value>, model: &str, time: &str, merge: bool) {
        if blocks.is_empty() { return; }
        let merge = merge && self.rows.last().is_some_and(|e| e["message"]["role"] == "assistant");
        if !merge { self.flush(); }
        for block in &mut blocks {
            if block["type"] == "text" { block["text"] = json!(cap(block["text"].as_str().unwrap_or_default(), 256*1024)); }
            if block["type"] == "toolCall" {
                let source = block["id"].as_str().unwrap_or("call").to_string();
                let base: String = source.chars().take(64).map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
                let mut id = if base.is_empty() { "call".into() } else { base.clone() };
                let mut n = 1;
                while !self.calls.insert(id.clone()) { let suffix = format!("_{n}"); id = format!("{}{}", &base[..base.len().min(64-suffix.len())], suffix); n += 1; }
                block["id"] = json!(id);
                cap_args(&mut block["arguments"]);
                self.pending.push((source, id, block["name"].as_str().unwrap_or("tool").into()));
            }
        }
        if merge {
            let message = &mut self.rows.last_mut().unwrap()["message"];
            message["content"].as_array_mut().unwrap().extend(blocks);
            if !self.pending.is_empty() { message["stopReason"] = json!("toolUse"); }
        } else {
            self.push(json!({"type":"message","message":{"role":"assistant","content":blocks,"api":"openai-responses","provider":"imported","model":format!("imported/{model}"),"usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":if self.pending.is_empty() {"stop"} else {"toolUse"}}}), time);
        }
    }
    pub fn result(&mut self, source: &str, output: &str, error: bool, time: &str) {
        while let Some(n) = self.pending.iter().position(|(s, _, _)| s == source) {
            let (_, id, name) = self.pending.remove(n);
            self.push(json!({"type":"message","message":{"role":"toolResult","toolCallId":id,"toolName":name,"content":[{"type":"text","text":cap(output,16*1024)}],"details":{},"isError":error}}), time);
        }
    }
    pub fn compact(&mut self, summary: &str) { self.summary = cap(summary, 12000); self.summary_at = self.rows.len(); }
    pub fn finish(mut self, source: &str) -> Vec<u8> {
        self.flush();
        let sizes: Vec<_> = self.rows.iter().map(|e| e["message"].to_string().chars().count()).collect();
        let total: usize = sizes.iter().sum();
        if total > 400_000 || !self.summary.is_empty() {
            let mut tail = 0;
            let mut keep = self.rows.iter().rposition(|e| e["message"]["role"] == "user").unwrap_or(1);
            for i in (1..self.rows.len()).rev() {
                tail += sizes[i];
                if tail > 240_000 { break; }
                if self.rows[i]["message"]["role"] == "user" { keep = i; }
            }
            if keep < self.rows.len() {
                let digest = self.rows[self.summary_at.min(keep)..keep].iter().map(|e| format!("{}: {}", e["message"]["role"].as_str().unwrap_or("entry"), text(&e["message"]["content"]))).collect::<Vec<_>>().join("\n");
                let summary = cap(&format!("Imported from {}. Summary of the earlier conversation:\n{}\n{}", if source == "claude" { "Claude Code" } else { "Codex" }, self.summary, cap(&digest, 12000)), 24000);
                self.push(json!({"type":"compaction","summary":summary,"firstKeptEntryId":self.rows[keep]["id"],"tokensBefore":total/4}), &self.last_time.clone());
            }
        }
        io::lines(&self.rows)
    }
}
