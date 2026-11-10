use super::*;
use crate::shared::{engines::EngineBackend, pi::PiEngine};

struct Fixture {
    root: PathBuf,
    service: Arc<Imports>,
    ws: HashMap<String, WorkspaceEntry>,
    settings: AppSettings,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("import-{}", uuid::Uuid::new_v4()));
        let cwd = root.join("project");
        fs::create_dir_all(&cwd).unwrap();
        let roots = Roots {
            codex: root.join("source/codex"),
            claude: root.join("source/claude"),
            desktop: root.join("source/desktop"),
            trash: root.join("trash"),
        };
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/import");
        for (source, destination) in [
            (
                "codex/rollout.jsonl",
                roots.codex.join("sessions/2026/10/24/rollout-clock.jsonl"),
            ),
            ("codex/config.toml", roots.codex.join("config.toml")),
            (
                "claude/local_code.json",
                roots
                    .desktop
                    .join("claude-code-sessions/acct/org/local_code.json"),
            ),
            (
                "claude/transcript.jsonl",
                roots
                    .claude
                    .join("projects/encoded/22222222-2222-4222-8222-222222222222.jsonl"),
            ),
            (
                "claude/claude_desktop_config.json",
                roots.desktop.join("claude_desktop_config.json"),
            ),
            (
                "cowork/local_task.json",
                roots
                    .desktop
                    .join("local-agent-mode-sessions/acct/org/local_task.json"),
            ),
            (
                "cowork/audit.jsonl",
                roots
                    .desktop
                    .join("local-agent-mode-sessions/acct/org/local_task/audit.jsonl"),
            ),
            (
                "cowork/outputs/report.txt",
                roots
                    .desktop
                    .join("local-agent-mode-sessions/acct/org/local_task/outputs/report.txt"),
            ),
        ] {
            fs::create_dir_all(destination.parent().unwrap()).unwrap();
            fs::write(
                &destination,
                fs::read_to_string(fixture.join(source))
                    .unwrap()
                    .replace("@CWD@", cwd.to_str().unwrap()),
            )
            .unwrap();
            idle(&destination);
        }
        for path in [
            roots.codex.join("auth.json"),
            roots.claude.join(".credentials.json"),
            roots.desktop.join("buddy-tokens.json"),
            roots.desktop.join("Cookies"),
            roots.desktop.join("config.json"),
        ] {
            fs::write(path, "credential-sentinel").unwrap();
        }
        // Database created in the test, never shipped as an opaque binary fixture.
        let sql = format!("CREATE TABLE projects(id TEXT,name TEXT,metadata TEXT,position INTEGER,created_at_ms INTEGER,updated_at_ms INTEGER); CREATE TABLE project_roots(project_id TEXT,position INTEGER,path TEXT); CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT,cwd TEXT,title TEXT,name TEXT,created_at_ms INTEGER,updated_at_ms INTEGER,archived INTEGER,model TEXT,model_provider TEXT,project_id TEXT,first_user_message TEXT,preview TEXT,source TEXT,thread_source TEXT,originator TEXT,attached_thread_parent_id TEXT); INSERT INTO projects VALUES('p','Clock project','{{}}',0,0,0); INSERT INTO project_roots VALUES('p',0,'{}'); INSERT INTO project_roots VALUES('p',1,'/synthetic-missing-root'); INSERT INTO threads(id,cwd,title,archived,project_id,source) VALUES('11111111-1111-4111-8111-111111111111','{}','Database title',0,'p','cli');",cwd.display(),cwd.display());
        assert!(std::process::Command::new("sqlite3")
            .arg(roots.codex.join("state_5.sqlite"))
            .arg(sql)
            .status()
            .unwrap()
            .success());
        let rollout=roots.codex.join("sessions/2026/10/24/rollout-clock.jsonl").to_string_lossy().replace('\'',"''");
        assert!(std::process::Command::new("sqlite3").arg(roots.codex.join("state_5.sqlite")).arg(format!("UPDATE threads SET rollout_path='{rollout}'")).status().unwrap().success());
        let service = Imports::with_roots(root.join("app"), roots);
        Self {
            root,
            service,
            ws: HashMap::new(),
            settings: AppSettings::default(),
        }
    }
    fn call(&mut self, action: &str, params: Value) -> Value {
        self.service
            .perform(action, params, &mut self.ws, &mut self.settings)
            .unwrap()
    }
    fn detect_and_import(&mut self) -> Value {
        let detected = self.call("detect", json!({}));
        self.call("run",json!({"keys":detected["entries"].as_array().unwrap().iter().map(|e|e["key"].clone()).collect::<Vec<_>>()}))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[derive(Clone)]
struct WorkSink;
impl crate::backend::events::EventSink for WorkSink {
    fn emit_app_server_event(&self, _: crate::backend::events::AppServerEvent) {}
    fn emit_terminal_output(&self, _: crate::backend::events::TerminalOutput) {}
    fn emit_terminal_exit(&self, _: crate::backend::events::TerminalExit) {}
}

#[tokio::test]
async fn cowork_imports_link_existing_work_spaces_copies_transcripts_and_undo() {
    let mut f = Fixture::new();
    let upload = f.service.roots.desktop.join("local-agent-mode-sessions/acct/org/local_task/uploads/notes.txt");
    fs::create_dir_all(upload.parent().unwrap()).unwrap();
    fs::write(&upload, "Synthetic uploaded notes").unwrap();
    let work = crate::shared::work::Work::new(f.service.data.clone(), WorkSink);
    let space = work.request(&f.settings, "add-space", json!({"path":f.root.join("project"),"readOnlyFolders":[]})).await.unwrap();
    let log = f.detect_and_import();
    let list = work.request(&f.settings, "list", json!({})).await.unwrap();
    assert_eq!(list["spaces"].as_array().unwrap().len(), 1);
    assert_eq!(list["tasks"].as_array().unwrap().len(), 1);
    let task = &list["tasks"][0];
    assert_eq!(task["spaceId"], space["id"]);
    assert_eq!(task["status"], "done");
    assert_eq!(task["outputs"].as_array().unwrap().len(), 2);
    let read = work.request(&f.settings, "read", json!({"taskId":task["id"]})).await.unwrap();
    assert!(read.to_string().contains("Report completed"));
    for name in ["outputs/report.txt", "uploads/notes.txt"] {
        let copy = work.output(&f.settings, task["id"].as_str().unwrap(), name).await.unwrap();
        assert!(copy.starts_with(f.service.data.canonicalize().unwrap().join("imports/attachments")));
        assert!(fs::read_to_string(copy).unwrap().contains("Synthetic"));
    }
    assert!(work.output(&f.settings, task["id"].as_str().unwrap(), "../escape").await.is_err());
    #[cfg(unix)] {
        let copies = f.service.data.join("imports/attachments").join(task["importId"].as_str().unwrap());
        let outside = f.root.join("outside-copies");
        fs::rename(&copies, &outside).unwrap();
        std::os::unix::fs::symlink(&outside, &copies).unwrap();
        assert!(work.output(&f.settings, task["id"].as_str().unwrap(), "outputs/report.txt").await.is_err());
        fs::remove_file(&copies).unwrap();
        fs::rename(outside, copies).unwrap();
    }
    assert!(work.request(&f.settings, "checkpoint", json!({"taskId":task["id"],"request":{"action":"undo"}})).await.is_err());
    // An existing M4e copy without the new status field also appears after restart.
    let history_path = f.service.data.join("imports/history").join(format!("{}.json", task["importId"].as_str().unwrap()));
    let mut history = storage::read_thread_metadata(&history_path).unwrap();
    history.as_object_mut().unwrap().remove("status");
    storage::write_thread_metadata(&history_path, &history).unwrap();
    let restarted = crate::shared::work::Work::new(f.service.data.clone(), WorkSink);
    assert_eq!(restarted.request(&f.settings, "list", json!({})).await.unwrap()["tasks"][0]["status"], "done");
    f.call("undo", json!({"logId":log["id"],"confirmChanged":true}));
    let list = work.request(&f.settings, "list", json!({})).await.unwrap();
    assert!(list["tasks"].as_array().unwrap().is_empty());
    assert_eq!(list["spaces"][0]["id"], space["id"]);
}

#[tokio::test]
async fn cowork_missing_and_incomplete_tasks_are_read_only_and_undoable() {
    let mut f = Fixture::new();
    let metadata = f.service.roots.desktop.join("local-agent-mode-sessions/acct/org/local_task.json");
    let mut value = io::json(&metadata, &AtomicBool::new(false)).unwrap();
    value["status"] = json!("running");
    fs::write(metadata, serde_json::to_vec(&value).unwrap()).unwrap();
    fs::remove_dir(f.root.join("project")).unwrap();
    let log = f.detect_and_import();
    let work = crate::shared::work::Work::new(f.service.data.clone(), WorkSink);
    let list = work.request(&f.settings, "list", json!({})).await.unwrap();
    assert_eq!(list["tasks"][0]["status"], "stopped");
    assert_eq!(list["spaces"][0]["name"], "Imported (folder missing)");
    assert_eq!(list["spaces"][0]["readOnly"], true);
    assert!(work.request(&f.settings, "continue", json!({"taskId":list["tasks"][0]["id"],"model":"local/test"})).await.unwrap_err().contains("available folder"));
    assert!(work.attachment(&f.settings, "imported-missing", &f.root.join("nonexistent")).await.unwrap_err().contains("read-only"));
    f.call("undo", json!({"logId":log["id"]}));
    let list = work.request(&f.settings, "list", json!({})).await.unwrap();
    assert!(list["tasks"].as_array().unwrap().is_empty());
    assert!(list["spaces"].as_array().unwrap().is_empty());
}

#[test]
fn cowork_completion_respects_archive_and_explicit_status() {
    let mut f = Fixture::new();
    let path = f.service.roots.desktop.join("local-agent-mode-sessions/acct/org/local_task.json");
    let mut metadata = io::json(&path, &AtomicBool::new(false)).unwrap();
    for (archived, status, expected) in [(false, "completed", "done"), (true, "completed", "stopped"), (false, "running", "stopped"), (false, "failed", "stopped")] {
        metadata["isArchived"] = json!(archived);
        metadata["status"] = json!(status);
        fs::write(&path, serde_json::to_vec(&metadata).unwrap()).unwrap();
        f.call("detect", json!({}));
        let catalog = f.service.catalog.lock().unwrap();
        assert_eq!(catalog.iter().find(|e| e.kind == "work").unwrap().work_status.as_deref(), Some(expected));
    }
}

#[test]
fn synthetic_sources_are_allowlisted_sanitized_idempotent_and_undoable() {
    let mut f = Fixture::new();
    io::OPENS.with(|v| v.borrow_mut().clear());
    let before = fs::read(
        f.service
            .roots
            .codex
            .join("sessions/2026/10/24/rollout-clock.jsonl"),
    )
    .unwrap();
    let log = f.detect_and_import();
    assert_eq!(f.ws.len(), 1);
    assert!(log["skipped"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v.as_str().unwrap().contains("Missing root")));
    let opens = io::OPENS.with(|v| v.borrow().clone());
    assert!(opens.iter().all(|p| ![
        "auth.json",
        ".credentials.json",
        "buddy-tokens.json",
        "Cookies",
        "config.json"
    ]
    .contains(&p.file_name().unwrap().to_str().unwrap())));
    assert!(opens.iter().all(|p| p.starts_with(&f.root)));
    let receipt: Log = serde_json::from_value(log.clone()).unwrap();
    let mut output = String::new();
    for r in &receipt.created {
        for file in r.files.keys() {
            output.push_str(&String::from_utf8_lossy(
                &fs::read(f.service.data.join(file)).unwrap(),
            ));
        }
    }
    output.push_str(&serde_json::to_string(&f.settings.mcp_servers).unwrap());
    assert!(!output.contains("private-user"));
    assert!(!output.contains("private-account"));
    assert!(!output.contains("private@example"));
    assert!(!output.contains("never-copy"));
    assert!(output.contains("Keep this unknown kind"));
    assert!(output.contains("Synthetic clock report"));
    let imported: Vec<_> = f
        .settings
        .mcp_servers
        .iter()
        .filter(|c| c.id.starts_with("import-"))
        .collect();
    assert_eq!(imported.len(), 3);
    assert!(imported.iter().all(|c| !c.enabled));
    assert!(serde_json::to_string(&imported)
        .unwrap()
        .contains("\"secret\":true"));
    assert!(serde_json::to_string(&imported)
        .unwrap()
        .contains("\"USER\":{\"secret\":true}"));
    assert_eq!(
        f.detect_and_import()["created"].as_array().unwrap().len(),
        0
    );
    let undone = f.call("undo", json!({"logId":log["id"]}));
    assert_eq!(undone["undone"], true);
    assert!(f.ws.is_empty());
    for r in receipt.created {
        for file in r.files.keys() {
            assert!(!f.service.data.join(file).exists());
        }
    }
    assert_eq!(
        fs::read(
            f.service
                .roots
                .codex
                .join("sessions/2026/10/24/rollout-clock.jsonl")
        )
        .unwrap(),
        before
    );
    assert!(!f.detect_and_import()["created"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[test]
fn missing_cwd_recovers_project_and_changed_files_require_confirmation() {
    let mut f = Fixture::new();
    fs::remove_dir(f.root.join("project")).unwrap();
    let log = f.detect_and_import();
    assert!(!f.ws.is_empty());
    let receipt: Log = serde_json::from_value(log.clone()).unwrap();
    let chat = receipt.created.iter().find(|r| r.key.starts_with("claude:")).unwrap();
    let file = chat.files.keys().find(|p| p.ends_with(".jsonl")).unwrap();
    assert!(file.starts_with("pi/sessions/"));
    let path = f.service.data.join(file);
    let thread = crate::shared::pi::read_imported_session(&path, &[]).unwrap();
    assert!(Path::new(thread["cwd"].as_str().unwrap()).is_dir());
    use std::io::Write;
    writeln!(fs::OpenOptions::new().append(true).open(&path).unwrap(), "{}", json!({"type":"message","id":"continued","message":{"role":"user","content":[{"type":"text","text":"continue"}]}})).unwrap();
    assert!(f.call("undo", json!({"logId":log["id"]}))["needsConfirmation"].is_array());
    f.call("undo", json!({"logId":log["id"],"confirmChanged":true}));
    assert!(!path.exists());
}

#[tokio::test]
async fn exports_follow_main_branch_and_are_readable_by_pi_chat() {
    let mut f = Fixture::new();
    for source in ["claude-ai", "chatgpt"] {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(format!("tests/fixtures/import/{source}/conversations.json"));
        let detection = f.call("export", json!({"path":path}));
        let log = f.call("run", json!({"keys":[detection["entries"][0]["key"]]}));
        let id = log["created"][0]["threadId"].as_str().unwrap();
        let engine = PiEngine::chat(f.service.data.clone(), Arc::new(|_, _| {}));
        let response = engine
            .request("chats", "thread/read", json!({"threadId":id}))
            .await
            .unwrap();
        let text = response.to_string();
        assert!(text.contains(if source == "chatgpt" {
            "Chosen answer"
        } else {
            "Preferred text blocks"
        }));
        assert!(!text.contains("Never import this branch"));
        let bytes = fs::read_to_string(
            f.service
                .data
                .join(format!("chats/sessions/chats/{id}.jsonl")),
        )
        .unwrap();
        assert!(bytes.contains("imported/"));
    }
    assert!(parse::exports(
        json!([{"id":"cycle","current_node":"x","mapping":{"x":{"parent":"x"}}}])
    )
    .is_err());
}

#[test]
fn limits_symlinks_cancellation_and_utf8_summary() {
    let f = Fixture::new();
    let huge = f.root.join("oversized.jsonl");
    fs::File::create(&huge)
        .unwrap()
        .set_len(io::LIMIT + 1)
        .unwrap();
    assert!(io::read(&huge, &f.service.cancel)
        .unwrap_err()
        .contains("200 MB"));
    #[cfg(unix)]
    {
        let link = f.root.join("link.jsonl");
        std::os::unix::fs::symlink(f.service.roots.codex.join("auth.json"), &link).unwrap();
        assert!(io::read(&link, &f.service.cancel).is_err());
    }
    f.service.cancel.store(true, Ordering::Relaxed);
    assert!(parse::detect(&f.service.roots, &f.service.cancel, &f.service.scan_cache)
        .unwrap_err()
        .contains("cancelled"));
    let mut messages = vec![json!({"role":"user","text":"界".repeat(10000)})];
    for i in 0..10 {
        messages.push(json!({"role":"assistant","text":format!("last {i}")}));
    }
    let context = continuation(&messages);
    assert!(context.len() < 8500);
    assert!(context.contains("[Middle omitted]"));
    assert!(context.ends_with("last 9"));
}

#[test]
fn zip_ingress_and_invalid_state_database_are_synthetic() {
    let mut f = Fixture::new();
    let exports = f.root.join("export");
    fs::create_dir_all(&exports).unwrap();
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/import/chatgpt/conversations.json"),
        exports.join("conversations.json"),
    )
    .unwrap();
    // A credential member is never extracted or opened.
    fs::write(exports.join("auth.json"), "never-read-this-member").unwrap();
    let zip = f.root.join("export.zip");
    assert!(std::process::Command::new("zip")
        .current_dir(&exports)
        .args(["-q"])
        .arg(&zip)
        .args(["conversations.json", "auth.json"])
        .status()
        .unwrap()
        .success());
    let detection = f.call("export", json!({"path":zip}));
    assert_eq!(detection["entries"][0]["source"], "chatgpt");
    assert!(!f.service.data.join("auth.json").exists());
    fs::write(
        f.service.roots.codex.join("state_99.sqlite"),
        "unknown schema",
    )
    .unwrap();
    fs::remove_file(
        f.service
            .roots
            .desktop
            .join("claude-code-sessions/acct/org/local_code.json"),
    )
    .unwrap();
    let detection = f.call("detect", json!({}));
    let entries = detection["entries"].as_array().unwrap();
    assert!(entries.iter().any(|e| e["source"] == "claude"));
    assert!(!entries.iter().any(|e| e["source"] == "codex"));
    assert!(!detection["warnings"].as_array().unwrap().is_empty());
    assert!(!entries.iter().any(|e| e["source"] == "codex-project"));
}

#[test]
fn imported_claude_loads_as_pi_without_starting_an_engine() {
    let mut f = Fixture::new();
    let log: Log = serde_json::from_value(f.detect_and_import()).unwrap();
    let receipt = log.created.iter().find(|r| r.key.starts_with("claude:")).unwrap();
    let file = receipt.files.keys().find(|p| p.ends_with(".jsonl")).unwrap();
    let thread = crate::shared::pi::read_imported_session(&f.service.data.join(file), &[]).unwrap();
    assert_eq!(thread["engine"], "pi");
    assert!(thread.to_string().contains("Clocks measure time"));
    assert!(!f.service.data.join("claude").exists());
}

#[test]
fn interrupted_index_recovery_and_repeated_undo_preserve_new_imports() {
    let mut f = Fixture::new();
    let first = f.detect_and_import();
    fs::remove_file(f.service.data.join("imports/index.json")).unwrap();
    assert_eq!(
        f.detect_and_import()["created"].as_array().unwrap().len(),
        0
    );
    f.call("undo", json!({"logId":first["id"]}));
    let second = f.detect_and_import();
    f.call("undo", json!({"logId":first["id"]}));
    let receipt: Log = serde_json::from_value(second).unwrap();
    for r in receipt.created {
        for path in r.files.keys() {
            assert!(f.service.data.join(path).exists());
        }
    }
}

#[cfg(target_os = "macos")]
#[test]
fn system_alias_ancestors_are_allowed_but_source_symlinks_are_not() {
    // /tmp is a root-owned link to /private/tmp; a link inside the source is still refused.
    assert!(io::safe(Path::new("/tmp")).is_ok());
    let f = Fixture::new();
    let dir = f.root.join("alias-test");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("a.txt"), "x").unwrap();
    std::os::unix::fs::symlink(dir.join("a.txt"), dir.join("link.txt")).unwrap();
    assert!(io::safe(&dir.join("a.txt")).is_ok());
    assert_eq!(io::safe(&dir.join("link.txt")).unwrap_err(), "Source symlinks are not importable");
    fs::remove_dir_all(dir).unwrap();
}

fn idle(path: &Path) {
    fs::File::open(path).unwrap().set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000)).unwrap();
}

fn migration_source(f: &Fixture, source: &str, rows: &[Value]) -> PathBuf {
    let path = if source == "claude" { f.service.roots.claude.join("projects/migration/m10.jsonl") } else { f.service.roots.codex.join("sessions/rollout-m10.jsonl") };
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut rows=rows.to_vec();
    if source=="codex" {
        for row in &mut rows { if row["type"]=="session_meta" && row["payload"].get("source").is_none() { row["payload"]["source"]=json!("cli"); } }
    }
    fs::write(&path, io::lines(&rows)).unwrap(); idle(&path);
    if source=="codex" && f.service.roots.codex.join("state_5.sqlite").exists() {
        let meta=&rows.iter().find(|r|r["type"]=="session_meta").unwrap()["payload"];
        let q=|s:&str|s.replace('\'',"''");
        let src=meta["source"].as_str().map(str::to_owned).unwrap_or_else(||meta["source"].to_string());
        let first=rows.iter().filter_map(|r|r["timestamp"].as_str()).map(convert::timestamp).find(|n|*n!=0).unwrap_or(1_700_000_000_000);
        let last=rows.iter().filter_map(|r|r["timestamp"].as_str()).map(convert::timestamp).filter(|n|*n!=0).last().unwrap_or(first);
        codex_sql(f,&format!("INSERT INTO threads(id,rollout_path,cwd,source,originator,thread_source,created_at_ms,updated_at_ms) VALUES('{}','{}','{}','{}','{}','{}',{first},{last}) ON CONFLICT(id) DO UPDATE SET rollout_path=excluded.rollout_path,cwd=excluded.cwd,source=excluded.source,originator=excluded.originator,thread_source=excluded.thread_source,updated_at_ms=excluded.updated_at_ms",
            q(meta["id"].as_str().unwrap()),q(&path.to_string_lossy()),q(meta["cwd"].as_str().unwrap_or_default()),q(&src),q(meta["originator"].as_str().unwrap_or_default()),q(meta["thread_source"].as_str().unwrap_or_default())));
    }
    path
}
fn migrate_fixture(f: &mut Fixture, source: &str, mode: &str) -> Log {
    f.call("scan", json!({"sources":[source]}));
    serde_json::from_value(f.call("migrate", json!({"mode":mode,"sources":[source],"keys":[format!("{source}:m10")]}))).unwrap()
}
fn imported_rows(f: &Fixture, log: &Log) -> (PathBuf, Vec<Value>, Value) {
    assert_eq!(log.created.len(), 1, "{:?}", log.skipped);
    let path = f.service.data.join(log.created[0].files.keys().find(|p| p.ends_with(".jsonl")).unwrap());
    let rows = io::jsonl(&path, &AtomicBool::new(false), false).unwrap();
    let thread = crate::shared::pi::read_imported_session(&path, &[]).unwrap();
    (path, rows, thread)
}

#[test]
fn claude_branch_merging_tools_title_and_compaction_are_native() {
    let mut f = Fixture::new();
    let time = "2026-01-02T03:04:05Z";
    let path = migration_source(&f, "claude", &[
        json!({"type":"user","uuid":"u","cwd":f.root.join("project"),"timestamp":time,"message":{"content":"<system-reminder>secret instruction</system-reminder><command-name>/review</command-name> clocks"}}),
        json!({"type":"assistant","uuid":"abandoned","parentUuid":"u","message":{"content":[{"type":"text","text":"abandoned answer"}]}}),
        json!({"type":"api-request-blob","message":{"role":"assistant","content":"blob duplicate"}}),
        json!({"type":"attachment","message":{"content":"attachment duplicate"}}),
        json!({"type":"assistant","uuid":"a1","parentUuid":"u","timestamp":time,"message":{"id":"answer","model":"sonnet","content":[{"type":"text","text":"Reviewing"},{"type":"thinking","thinking":"private thinking"}]}}),
        json!({"type":"assistant","uuid":"a2","parentUuid":"a1","message":{"id":"answer","content":[{"type":"tool_use","id":"bash.id","name":"Bash","input":{"command":"ls"}},{"type":"tool_use","id":"edit","name":"Edit","input":{"file_path":"a.ts","old_string":"old","new_string":"new"}},{"type":"tool_use","id":"write","name":"Write","input":{"file_path":"b.ts","content":"hello"}}]}}),
        json!({"type":"user","uuid":"r","parentUuid":"a2","message":{"content":[{"type":"tool_result","tool_use_id":"bash.id","content":"listed"},{"type":"tool_result","tool_use_id":"edit","content":"edited"},{"type":"tool_result","tool_use_id":"write","content":"written"},{"type":"tool_result","tool_use_id":"orphan","content":"orphan result"}]}}),
        json!({"type":"user","uuid":"meta","parentUuid":"r","isMeta":true,"message":{"content":"meta instruction"}}),
        json!({"type":"user","uuid":"summary","parentUuid":"meta","isCompactSummary":true,"message":{"content":"Earlier work summarized"}}),
        json!({"type":"user","uuid":"last","parentUuid":"summary","timestamp":time,"message":{"content":"Continue the review"}}),
        json!({"type":"assistant","uuid":"side","parentUuid":"last","isSidechain":true,"message":{"content":"sidechain"}}),
        json!({"type":"last-prompt","leafUuid":"last"}),
        json!({"type":"custom-title","customTitle":"Clock review","timestamp":time}),
    ]);
    io::OPENS.with(|v| v.borrow_mut().clear());
    let scan = f.call("scan", json!({"sources":["claude"]}));
    assert!(scan["sessions"].as_array().unwrap().iter().any(|s| s["title"] == "Clock review"));
    assert!(!io::OPENS.with(|v| v.borrow().contains(&path)));
    assert!(f.service.scanned.lock().unwrap().as_ref().unwrap().iter().all(|s| !json!(s).to_string().contains("Reviewing")));
    let log = migrate_fixture(&mut f, "claude", "copy");
    let (_, rows, thread) = imported_rows(&f, &log);
    assert_eq!(thread["name"], "Clock review"); assert_eq!(thread["preview"], "/review clocks");
    assert_eq!(thread["cwd"], json!(f.root.join("project")));
    assert_eq!(thread["updatedAt"], convert::timestamp(time)/1000);
    let assistants: Vec<_> = rows.iter().filter(|r| r["message"]["role"] == "assistant").collect();
    assert_eq!(assistants.len(),1); assert_eq!(assistants[0]["message"]["content"].as_array().unwrap().len(),4);
    assert_eq!(rows.iter().filter(|r| r["message"]["role"] == "toolResult").count(),3);
    let serialized = json!(rows).to_string();
    for absent in ["abandoned answer","blob duplicate","attachment duplicate","private thinking","meta instruction","secret instruction","orphan result","sidechain"] { assert!(!serialized.contains(absent), "{absent}"); }
    assert!(thread.to_string().contains("commandExecution")); assert!(thread.to_string().contains("fileChange"));
    assert_eq!(rows.last().unwrap()["type"],"compaction");
    let kept = &rows.last().unwrap()["firstKeptEntryId"];
    assert!(rows.iter().any(|r| &r["id"] == kept && r["message"]["role"] == "user"));
    assert!(rows.last().unwrap()["summary"].as_str().unwrap().contains("Earlier work summarized"));
    for (n, row) in rows.iter().enumerate().skip(1) {
        assert_eq!(row["id"].as_str().unwrap().len(),8);
        assert_eq!(row["parentId"], if n == 1 { Value::Null } else { rows[n-1]["id"].clone() });
    }
}

#[test]
fn codex_events_patch_outputs_and_subagents() {
    let mut f = Fixture::new();
    migration_source(&f,"codex", &[
        json!({"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{"id":"m10","cwd":f.root.join("project")}}),
        json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"AGENTS.md environment injected"}]}}),
        json!({"type":"event_msg","payload":{"type":"user_message","message":"Fix the files"}}),
        json!({"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage","content":[{"type":"text","text":"Fix the files"}]}}}),
        json!({"type":"response_item","payload":{"type":"reasoning","summary":"secret reasoning"}}),
        json!({"type":"response_item","payload":{"type":"function_call","call_id":"exec","name":"exec_command","arguments":"{\"cmd\":\"ls\"}"}}),
        json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"exec","output":"{\"output\":\"command output\"}"}}),
        json!({"type":"response_item","payload":{"type":"custom_tool_call","call_id":"patch","name":"apply_patch","input":"*** Begin Patch\n*** Add File: new.txt\n+new\n*** Update File: old.txt\n@@\n context\n-old\n+new\n*** Delete File: gone.txt\n*** End Patch"}}),
        json!({"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"patch","output":[{"type":"input_text","text":"patch output"}]}}),
        json!({"type":"compacted","payload":{"message":"Source summary"}}),
    ]);
    let sub = f.service.roots.codex.join("sessions/rollout-sub.jsonl");
    fs::write(&sub,io::lines(&[json!({"type":"session_meta","payload":{"id":"sub","source":{"subagent":{}},"cwd":f.root.join("project")}})])).unwrap();
    let scan = f.call("scan", json!({"sources":["codex"]}));
    assert!(!scan["sessions"].to_string().contains("codex:sub"));
    let log = migrate_fixture(&mut f,"codex","copy");
    let (_,rows,thread) = imported_rows(&f,&log);
    assert_eq!(thread["preview"],"Fix the files");
    assert_eq!(rows.iter().filter(|r| r["message"]["role"] == "user").count(),1);
    let output = json!(rows).to_string();
    assert!(!output.contains("AGENTS.md")); assert!(!output.contains("secret reasoning"));
    assert_eq!(rows.iter().filter(|r| r["message"]["role"] == "toolResult").count(),4);
    assert!(output.contains("command output")); assert_eq!(output.matches("patch output").count(),3);
    assert!(thread.to_string().contains("commandExecution")); assert!(thread.to_string().contains("fileChange"));
    assert_eq!(rows.last().unwrap()["type"],"compaction");
}

#[test]
fn context_budget_caps_and_missing_results() {
    let mut f = Fixture::new();
    let mut rows = vec![];
    for i in 0..8 { rows.push(json!({"type":"user","cwd":f.root.join("project"),"message":{"content":format!("{i} {}","界".repeat(60000))}})); }
    rows.push(json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"missing!","name":"Write","input":{"file_path":"a","content":"x".repeat(100000)}}]}}));
    migration_source(&f,"claude",&rows);
    let log = migrate_fixture(&mut f,"claude","copy");
    let (_,rows,_) = imported_rows(&f,&log);
    let compaction = rows.last().unwrap();
    assert_eq!(compaction["type"],"compaction"); assert!(compaction["tokensBefore"].as_u64().unwrap()>100000);
    assert!(compaction["summary"].as_str().unwrap().chars().count()<=24000);
    assert!(rows.iter().any(|r| r["id"] == compaction["firstKeptEntryId"] && r["message"]["role"] == "user"));
    let tool = rows.iter().find(|r| r["message"]["role"] == "assistant").unwrap();
    assert!(tool["message"]["content"][0]["arguments"]["content"].as_str().unwrap().len()<=65536);
    assert!(rows.iter().any(|r| r["message"]["role"] == "toolResult" && r["message"]["isError"] == true));
}

#[test]
fn migration_updates_idempotently_preserves_continuations_and_restores_moves() {
    let mut f = Fixture::new();
    let path = migration_source(&f,"claude",&[json!({"type":"user","cwd":f.root.join("project"),"message":{"content":"First"}})]);
    let sidecar = path.with_extension(""); fs::create_dir_all(&sidecar).unwrap(); fs::write(sidecar.join("data"),"sidecar").unwrap();
    let first = migrate_fixture(&mut f,"claude","copy");
    let (destination,_,_) = imported_rows(&f,&first);
    assert!(migrate_fixture(&mut f,"claude","copy").created.is_empty());
    use std::io::Write;
    writeln!(fs::OpenOptions::new().append(true).open(&path).unwrap(),"{}",json!({"type":"assistant","message":{"content":"A new reply"}})).unwrap(); idle(&path);
    let updated = migrate_fixture(&mut f,"claude","copy");
    assert_eq!(first.created[0].thread_id,updated.created[0].thread_id);
    assert!(fs::read_to_string(&destination).unwrap().contains("A new reply"));
    writeln!(fs::OpenOptions::new().append(true).open(&destination).unwrap(),"{}",json!({"type":"message","id":"local","message":{"role":"user","content":[]}})).unwrap();
    writeln!(fs::OpenOptions::new().append(true).open(&path).unwrap(),"{}",json!({"type":"user","message":{"content":"Another prompt"}})).unwrap(); idle(&path);
    let continued = migrate_fixture(&mut f,"claude","copy");
    assert!(continued.created.is_empty()); assert!(continued.skipped[0].contains("continued in nucode"));
    f.call("undo",json!({"logId":updated.id,"confirmChanged":true}));
    let moved = migrate_fixture(&mut f,"claude","move");
    assert!(!path.exists()); assert!(!sidecar.exists()); assert_eq!(moved.created[0].trashed.len(),2);
    f.call("undo",json!({"logId":moved.id}));
    assert!(path.exists()); assert_eq!(fs::read_to_string(sidecar.join("data")).unwrap(),"sidecar");
    assert!(!f.service.data.join(moved.created[0].files.keys().next().unwrap()).exists());
    fs::File::open(&path).unwrap().set_modified(std::time::SystemTime::now()).unwrap();
    let active = migrate_fixture(&mut f,"claude","move"); assert!(active.created.is_empty()); assert!(active.skipped[0].contains("in use")); assert!(path.exists());
}

#[test]
fn workspace_ancestor_exact_created_home_and_missing_targets() {
    for kind in ["exact","ancestor","created","home","missing"] {
        let mut f = Fixture::new();
        let cwd = match kind { "home" => PathBuf::from(std::env::var("HOME").unwrap()), "missing" => f.root.join("missing"), _ => f.root.join("project/sub") };
        if !matches!(kind,"home"|"missing") { fs::create_dir_all(&cwd).unwrap(); }
        if matches!(kind,"exact"|"ancestor") {
            for (id,path) in [("outer",f.root.clone()),("ancestor",f.root.join("project"))] { let ws: WorkspaceEntry = serde_json::from_value(json!({"id":id,"name":id,"path":path,"settings":{"agentPolicy":{"defaultEngine":"omp"}}})).unwrap(); f.ws.insert(id.into(),ws); }
            if kind == "exact" { let ws: WorkspaceEntry = serde_json::from_value(json!({"id":"exact","name":"exact","path":cwd,"settings":{}})).unwrap(); f.ws.insert("exact".into(),ws); }
        }
        migration_source(&f,"claude",&[json!({"type":"user","cwd":cwd,"message":{"content":"hello"}})]);
        let log=migrate_fixture(&mut f,"claude","copy"); let (path,_,thread)=imported_rows(&f,&log);
        match kind {
            "exact" => assert_eq!(log.created[0].workspace_id.as_deref(),Some("exact")),
            "ancestor" => { assert_eq!(log.created[0].workspace_id.as_deref(),Some("ancestor")); assert_eq!(thread["engine"],"omp"); },
            "created" => assert!(f.ws.values().any(|w| Path::new(&w.path)==f.root.join("project") && w.name=="Clock project")),
            _ => { assert!(path.starts_with(f.service.data.join("pi/sessions"))); assert!(Path::new(thread["cwd"].as_str().unwrap()).is_dir()); },
        }
    }
}

#[test]
fn streaming_skips_bad_and_oversized_lines_without_whole_file_reader() {
    let f = Fixture::new(); let path=f.root.join("stream.jsonl");
    use std::io::Write;
    let mut file=fs::File::create(&path).unwrap();
    file.write_all(b"bad json\n").unwrap();
    for _ in 0..65 { file.write_all(&vec![b'x';1024*1024]).unwrap(); }
    file.write_all(b"\n{\"ok\":true}\n{\"last\":true}").unwrap(); drop(file);
    io::OPENS.with(|v|v.borrow_mut().clear()); let mut count=0;
    io::stream(&path,&f.service.cancel,|_|count+=1).unwrap(); assert_eq!(count,2);
    assert!(io::OPENS.with(|v|v.borrow().is_empty()));
}

#[test]
fn duplicate_selection_archival_metadata_and_current_move_undo() {
    let mut f=Fixture::new();
    let path=migration_source(&f,"claude",&[json!({"type":"user","cwd":f.root.join("project"),"message":{"content":"Original prompt"}})]);
    let metadata=f.service.roots.desktop.join("claude-code-sessions/acct/org/local_m10.json");
    fs::write(&metadata,serde_json::to_vec(&json!({"cliSessionId":"m10","title":"Desktop name","isArchived":true})).unwrap()).unwrap();
    migration_source(&f,"codex",&[json!({"type":"session_meta","payload":{"id":"m10","cwd":f.root.join("project")}}),json!({"type":"event_msg","payload":{"type":"user_message","message":"Duplicated prompt"}})]);
    fs::write(f.service.roots.codex.join("external_agent_session_imports.json"),serde_json::to_vec(&json!({"imports":[{"imported_thread_id":"m10","source_path":path}]})).unwrap()).unwrap();
    let scan=f.call("scan",json!({"includeArchived":true}));
    let rows=scan["sessions"].as_array().unwrap();
    assert!(rows.iter().any(|r|r["key"]=="claude:m10" && r["title"]=="Desktop name"));
    assert!(rows.iter().any(|r|r["key"]=="codex:m10" && r["state"]=="duplicate"));
    let scan=f.call("scan",json!({"sources":["codex"]}));
    assert!(scan["sessions"].as_array().unwrap().iter().any(|r|r["key"]=="codex:m10" && r["state"]=="new"));
    let scan=f.call("scan",json!({}));
    assert!(!scan["sessions"].as_array().unwrap().iter().any(|r|r["key"]=="claude:m10"));
    f.call("scan",json!({"sources":["claude"],"includeArchived":true}));
    let copy:Log=serde_json::from_value(f.call("migrate",json!({"mode":"copy","includeArchived":true,"keys":["claude:m10"]}))).unwrap();
    let (destination,_,_)=imported_rows(&f,&copy);
    f.call("scan",json!({"sources":["claude"],"includeArchived":true}));
    let moved:Log=serde_json::from_value(f.call("migrate",json!({"mode":"move","includeArchived":true,"keys":["claude:m10"]}))).unwrap();
    assert!(!path.exists()); assert!(!metadata.exists());
    fs::write(&path,"source app replacement").unwrap();
    assert!(f.service.perform("undo",json!({"logId":moved.id}),&mut f.ws,&mut f.settings).unwrap_err().contains("occupied"));
    assert_eq!(fs::read_to_string(&path).unwrap(),"source app replacement");
    fs::remove_file(&path).unwrap();
    f.call("undo",json!({"logId":moved.id}));
    assert!(path.exists()); assert!(metadata.exists()); assert!(destination.exists());
}

#[tokio::test]
async fn auto_import_is_opt_in_local_and_respects_features_and_idle_sources() {
    let f=Fixture::new();
    migration_source(&f,"claude",&[json!({"type":"user","cwd":f.root.join("project"),"message":{"content":"Auto"}})]);
    let ws=tokio::sync::Mutex::new(f.ws.clone());
    let settings=tokio::sync::Mutex::new(f.settings.clone());
    assert!(f.service.request("auto",json!({}),&ws,&settings).await.unwrap().is_null());
    { let mut s=settings.lock().await; s.chat_import.auto=true; s.chat_import.sources=vec!["claude".into()]; s.features.import_tools=false; }
    assert!(f.service.request("auto",json!({}),&ws,&settings).await.unwrap().is_null());
    { let mut s=settings.lock().await; s.features.import_tools=true; s.backend_mode=serde_json::from_value(json!("remote")).unwrap(); }
    assert!(f.service.request("auto",json!({}),&ws,&settings).await.unwrap().is_null());
    settings.lock().await.backend_mode=serde_json::from_value(json!("local")).unwrap();
    let result=f.service.request("auto",json!({}),&ws,&settings).await.unwrap();
    assert!(!result["created"].as_array().unwrap().is_empty());
    let status=f.service.request("autoStatus",json!({}),&ws,&settings).await.unwrap();
    assert!(status["lastRunAt"].as_u64().unwrap()>0); assert!(status["error"].is_null());
    assert!(f.service.request("auto",json!({}),&ws,&settings).await.unwrap().is_null());
}

#[test]
fn claude_compaction_keeps_the_logical_branch_and_original_prompt() {
    let mut f=Fixture::new();
    migration_source(&f,"claude",&[
        json!({"type":"user","uuid":"u","cwd":f.root.join("project"),"message":{"content":"Original question"}}),
        json!({"type":"assistant","uuid":"a","parentUuid":"u","message":{"content":"Earlier reply"}}),
        json!({"type":"assistant","uuid":"abandoned","parentUuid":"u","message":{"content":"Abandoned branch"}}),
        json!({"type":"system","uuid":"boundary","parentUuid":null,"logicalParentUuid":"a","subtype":"compact_boundary"}),
        json!({"type":"user","uuid":"summary","parentUuid":"boundary","isCompactSummary":true,"message":{"content":"Earlier context"}}),
        json!({"type":"assistant","uuid":"tail","parentUuid":"summary","message":{"content":"Latest reply"}}),
    ]);
    let log=migrate_fixture(&mut f,"claude","copy"); let (_,rows,thread)=imported_rows(&f,&log);
    assert_eq!(thread["preview"],"Original question"); assert!(!json!(rows).to_string().contains("Abandoned branch"));
    assert_eq!(rows.last().unwrap()["type"],"compaction");
}

#[tokio::test]
async fn scans_wait_for_each_other_without_import_or_registry_locks() {
    let f=Fixture::new();
    let ws=tokio::sync::Mutex::new(f.ws.clone());
    let settings=tokio::sync::Mutex::new(f.settings.clone());
    let _operation=f.service.operation.lock().await;
    let _workspaces=ws.lock().await;
    let _settings=settings.lock().await;
    let scan=f.service.scan_operation.lock().await;
    let first=f.service.request("scan",json!({}),&ws,&settings);
    tokio::pin!(first);
    assert!(tokio::time::timeout(std::time::Duration::from_millis(20),first.as_mut()).await.is_err());
    drop(scan);
    let second=f.service.request("scan",json!({"sources":["claude"]}),&ws,&settings);
    let results=tokio::time::timeout(std::time::Duration::from_secs(5),async { tokio::join!(first,second) }).await.unwrap();
    assert!(results.0.unwrap()["sessions"].is_array());
    assert_eq!(results.1.unwrap()["sources"].as_array().unwrap().len(),1);
}

#[tokio::test]
async fn auto_skips_disabled_or_busy_runs_and_only_locks_registry_for_pending_chats() {
    let f=Fixture::new();
    let ws=tokio::sync::Mutex::new(f.ws.clone());
    let settings=tokio::sync::Mutex::new(f.settings.clone());
    let _workspaces=ws.lock().await;
    let scan=f.service.scan_operation.lock().await;
    let operation=f.service.operation.lock().await;
    let timeout=std::time::Duration::from_secs(2);
    assert!(tokio::time::timeout(timeout,f.service.request("auto",json!({}),&ws,&settings)).await.unwrap().unwrap().is_null());
    drop(scan);
    { let mut s=settings.lock().await; s.chat_import.auto=true; s.chat_import.sources=vec!["claude".into()]; }
    // A pending scan completes even with a mutation and workspace registry locked.
    assert!(tokio::time::timeout(timeout,f.service.request("auto",json!({}),&ws,&settings)).await.unwrap().unwrap().is_null());
    assert!(f.service.auto_status.lock().unwrap()["error"].is_null());
    assert!(!f.service.data.join("imports").exists());
    drop(operation);
    // Active-only sources never acquire the workspace lock for migration.
    for path in io::files(&f.service.roots.claude.join("projects"),1,&AtomicBool::new(false)).unwrap() {
        fs::File::open(path).unwrap().set_modified(std::time::SystemTime::now()).unwrap();
    }
    assert!(tokio::time::timeout(timeout,f.service.request("auto",json!({}),&ws,&settings)).await.unwrap().unwrap().is_null());
    assert!(!f.service.data.join("imports").exists());
}

#[test]
fn cached_scans_refresh_titles_archive_states_and_only_stream_changed_transcripts() {
    let mut f=Fixture::new();
    let claude=migration_source(&f,"claude",&[json!({"type":"user","cwd":f.root.join("project"),"message":{"content":"Original"}})]);
    let codex=migration_source(&f,"codex",&[json!({"type":"session_meta","payload":{"id":"m10","cwd":f.root.join("project")}}),json!({"type":"event_msg","payload":{"type":"user_message","message":"Codex prompt"}})]);
    let sub=f.service.roots.codex.join("sessions/rollout-sub.jsonl");
    fs::write(&sub,io::lines(&[json!({"type":"session_meta","payload":{"id":"sub","source":{"subagent":{}}}})])).unwrap();
    let desktop=f.service.roots.desktop.join("claude-code-sessions/acct/org/local_m10.json");
    fs::write(&desktop,serde_json::to_vec(&json!({"cliSessionId":"m10","title":"Desktop title"})).unwrap()).unwrap();
    let index=f.service.roots.codex.join("session_index.jsonl");
    fs::write(&index,io::lines(&[json!({"id":"m10","thread_name":"Indexed title"})])).unwrap();
    io::STREAMS.with(|v|v.borrow_mut().clear());
    let first=f.call("scan",json!({"includeArchived":true}));
    let opened=io::STREAMS.with(|v|v.borrow().clone());
    assert!([&claude,&codex].iter().all(|p|opened.contains(p)));
    assert!(!opened.contains(&sub));
    assert!(first["sessions"].as_array().unwrap().iter().any(|s|s["key"]=="codex:m10" && s["title"]=="Indexed title"));
    fs::write(&desktop,serde_json::to_vec(&json!({"cliSessionId":"m10","title":"Renamed desktop","isArchived":true})).unwrap()).unwrap();
    fs::write(&index,io::lines(&[json!({"id":"m10","thread_name":"Renamed index"})])).unwrap();
    io::STREAMS.with(|v|v.borrow_mut().clear());
    let second=f.call("scan",json!({"includeArchived":true}));
    let opened=io::STREAMS.with(|v|v.borrow().clone());
    let transcripts:HashSet<_>=f.service.scan_cache.lock().unwrap().keys().cloned().collect();
    assert!(!opened.iter().any(|p|transcripts.contains(p)),"{opened:?}");
    assert!(second["sessions"].as_array().unwrap().iter().any(|s|s["key"]=="claude:m10" && s["title"]=="Renamed desktop" && s["archived"]==true));
    assert!(second["sessions"].as_array().unwrap().iter().any(|s|s["key"]=="codex:m10" && s["title"]=="Renamed index"));
    assert!(!f.service.scan_cache.lock().unwrap().contains_key(&sub));
    assert!(std::process::Command::new("sqlite3").arg(f.service.roots.codex.join("state_5.sqlite")).arg("UPDATE threads SET title='Raw prompt',name='Database rename',archived=1,source='cli' WHERE id='m10'").status().unwrap().success());
    fs::write(&claude,io::lines(&[json!({"type":"user","cwd":f.root.join("project"),"message":{"content":"Updated and longer"}})])).unwrap();
    io::STREAMS.with(|v|v.borrow_mut().clear());
    let third=f.call("scan",json!({"includeArchived":true}));
    let opened=io::STREAMS.with(|v|v.borrow().clone());
    assert!(opened.contains(&claude)); assert!(!opened.contains(&codex)); assert!(!opened.contains(&sub));
    assert!(third["sessions"].as_array().unwrap().iter().any(|s|s["key"]=="claude:m10" && s["state"]=="active"));
    assert!(third["sessions"].as_array().unwrap().iter().any(|s|s["key"]=="codex:m10" && s["title"]=="Database rename" && s["archived"]==true));
    fs::remove_file(desktop).unwrap();
    assert!(f.call("scan",json!({"sources":["claude"]}))["sessions"].as_array().unwrap().iter().any(|s|s["key"]=="claude:m10" && s["title"]=="Updated and longer" && s["archived"]==false));
}

#[test]
fn undo_preserves_a_created_workspace_with_new_omp_history() {
    let mut f=Fixture::new(); f.settings.agent_policy.default_engine="omp".into();
    migration_source(&f,"claude",&[json!({"type":"user","cwd":f.root.join("project"),"message":{"content":"Import"}})]);
    let log=migrate_fixture(&mut f,"claude","copy");
    let id=log.created[0].workspace_id.as_ref().unwrap();
    let extra=f.service.data.join("omp/sessions").join(id).join("new-thread.jsonl");
    fs::write(&extra,"{}\n").unwrap();
    f.call("undo",json!({"logId":log.id}));
    assert!(f.ws.contains_key(id)); assert!(extra.exists());
}

#[test]
fn codex_searches_have_success_results_but_missing_shell_outputs_are_errors() {
    let mut f=Fixture::new();
    migration_source(&f,"codex",&[
        json!({"type":"session_meta","payload":{"id":"m10","cwd":f.root.join("project")}}),
        json!({"type":"event_msg","payload":{"type":"user_message","message":"Search"}}),
        json!({"type":"response_item","payload":{"type":"web_search_call","id":"search","action":{"type":"search","query":"rust jsonl"}}}),
        json!({"type":"response_item","payload":{"type":"function_call","call_id":"shell","name":"exec_command","arguments":"{\"cmd\":\"pwd\"}"}}),
    ]);
    let log=migrate_fixture(&mut f,"codex","copy"); let (_,rows,_)=imported_rows(&f,&log);
    let results:Vec<_>=rows.iter().filter(|r|r["message"]["role"]=="toolResult").map(|r|&r["message"]).collect();
    assert_eq!(results.len(),2);
    assert!(results.iter().any(|r|r["toolCallId"]=="search" && r["isError"]==false && r["content"][0]["text"]=="Searched: rust jsonl"));
    assert!(results.iter().any(|r|r["toolCallId"]=="shell" && r["isError"]==true));
}

#[test]
fn undo_accepts_volume_trash_and_rejects_missing_or_symlinked_sources() {
    let f=Fixture::new();
    let original=f.service.roots.claude.join("projects/volume/restored.jsonl");
    let trashed=f.root.join("volume/.Trashes/501/restored.jsonl");
    fs::create_dir_all(trashed.parent().unwrap()).unwrap(); fs::write(&trashed,"transcript").unwrap();
    let log=Log{created:vec![Receipt{trashed:HashMap::from([(original.to_string_lossy().into(),trashed.to_string_lossy().into())]),..Receipt::default()}],..Log::default()};
    f.service.restore_migrations(&log).unwrap(); assert!(original.exists()); assert!(!trashed.exists());
    fs::remove_file(&original).unwrap();
    assert!(f.service.restore_migrations(&log).unwrap_err().contains("Cannot restore"));
    #[cfg(unix)] {
        let target=f.root.join("target"); fs::write(&target,"keep").unwrap();
        std::os::unix::fs::symlink(&target,&trashed).unwrap();
        assert!(f.service.restore_migrations(&log).unwrap_err().contains("symlinks"));
        assert_eq!(fs::read_to_string(target).unwrap(),"keep"); assert!(!original.exists());
    }
}

#[test]
#[ignore = "Reads real chat sources; opt in with NUCODE_IMPORT_REAL=1"]
fn real_sources_dry_run() {
    if std::env::var("NUCODE_IMPORT_REAL").as_deref()!=Ok("1") { return; }
    let root=std::env::temp_dir().join(format!("import-real-{}",uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let mut roots=Roots::local(); roots.trash=root.join("trash");
    let service=Imports::with_roots(root.join("data"),roots);
    let mut f=Fixture{root,service,ws:HashMap::new(),settings:AppSettings::default()};
    let start=std::time::Instant::now();
    let scan=f.call("scan",json!({"includeArchived":true}));
    println!("Sources: {}\nWarnings: {}\nScan time: {:?}",scan["sources"],scan["warnings"],start.elapsed());
    io::STREAMS.with(|v|v.borrow_mut().clear());
    let start=std::time::Instant::now();
    f.call("scan",json!({"includeArchived":true}));
    println!("Cached scan time: {:?}",start.elapsed());
    // Live sources (this very conversation, for one) may grow between scans; only idle ones must hit the cache.
    let idle=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64-600_000;
    let transcripts:HashSet<_>=f.service.scan_cache.lock().unwrap().iter().filter(|(_,(_,mtime,_))|*mtime<idle).map(|(path,_)|path.clone()).collect();
    assert!(!io::STREAMS.with(|v|v.borrow().iter().any(|p|transcripts.contains(p))));
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    let keys:Vec<_>=f.service.scanned.lock().unwrap().as_ref().unwrap().iter().filter(|s|now.saturating_sub(s.mtime)>=600_000).map(|s|s.key.clone()).collect();
    let start=std::time::Instant::now();
    let log:Log=serde_json::from_value(f.call("migrate",json!({"mode":"copy","includeArchived":true,"keys":keys}))).unwrap();
    println!("Migrate time: {:?}",start.elapsed());
    let mut reasons=std::collections::BTreeMap::<&str,usize>::new();
    for skipped in &log.skipped { *reasons.entry(skipped.rsplit_once(": ").map_or(skipped.as_str(),|(_,reason)|reason)).or_default()+=1; }
    println!("Skipped reasons: {reasons:?}");
    // Placement and titles, to compare against the Codex and Claude sidebars.
    let mut placed=std::collections::BTreeMap::<String,(usize,Vec<String>)>::new();
    for receipt in &log.created {
        let project=receipt.workspace_id.as_ref().and_then(|id|f.ws.get(id)).map_or("Chat mode".into(),|w|format!("{} ({})",w.name,w.path));
        let entry=placed.entry(project).or_default(); entry.0+=1;
        if entry.1.len()<4 { entry.1.push(format!("{} [{}]",receipt.title,receipt.key.split(':').next().unwrap_or(""))); }
    }
    for (project,(count,titles)) in &placed { println!("  {count:>3}  {project}: {}",titles.join(" | ")); }
    let mut files=vec![];
    for receipt in &log.created {
        assert!(receipt.trashed.is_empty());
        for file in receipt.files.keys() {
            let path=f.service.data.join(file); assert!(path.starts_with(&f.root));
            crate::shared::pi::read_imported_session(&path,&[]).unwrap();
            let mut entries=0; io::stream(&path,&AtomicBool::new(false),|_|entries+=1).unwrap();
            files.push((fs::metadata(&path).unwrap().len(),file.clone(),entries));
        }
    }
    files.sort_by_key(|(bytes,_,_)|std::cmp::Reverse(*bytes));
    println!("Total bytes written: {}",files.iter().map(|(bytes,_,_)|bytes).sum::<u64>());
    println!("Five largest generated files (bytes, path, entries): {:?}",&files[..files.len().min(5)]);
}

fn codex_sql(f: &Fixture, sql: &str) {
    assert!(std::process::Command::new("sqlite3").arg(f.service.roots.codex.join("state_5.sqlite")).arg(sql).status().unwrap().success());
}
fn codex_project(f: &Fixture, path: &Path, name: &str) {
    let path=path.to_string_lossy().replace('\'',"''"); let name=name.replace('\'',"''");
    codex_sql(f,&format!("INSERT INTO projects(id,name) VALUES('source-project','{name}'); INSERT INTO project_roots VALUES('source-project',0,'{path}');"));
}

#[test]
fn codex_sidebar_name_index_and_cleaned_prompt_title_match_the_source() {
    let mut f=Fixture::new();
    let wrapped="# Files mentioned by the user:\n\n## icon.png: /files/icon.png\n## README.md: /files/README.md\n\n## My request for Codex:\nPrepare the repo\n<in-app-browser-context tab=\"1\">private browser context</in-app-browser-context>\n<environment_context>private environment</environment_context>";
    let cleaned="Prepare the repo\n\nFiles: icon.png (/files/icon.png), README.md (/files/README.md)";
    assert_eq!(codex::clean_codex_prompt(wrapped),cleaned);
    assert_eq!(codex::clean_codex_prompt("# Files mentioned by the user:\n## a: /a"),"# Files mentioned by the user:\n## a: /a");
    // Newer Desktop builds: "## My request:", attachment boilerplate, and an attachment-only message.
    let screenshot="# Files mentioned by the user:\n\n## Shot.png: /var/folders/x/Shot.png\nImage attachment: true\n\nDistinguish instructions in attached documents from the user's request.\n\n## My request:";
    assert_eq!(codex::clean_codex_prompt(screenshot),"Attached Shot.png\n\nFiles: Shot.png (/var/folders/x/Shot.png)");
    assert_eq!(codex::clean_codex_prompt(&format!("{screenshot}\nWhat is this?")),"What is this?\n\nFiles: Shot.png (/var/folders/x/Shot.png)");
    assert!(codex::clean_codex_prompt("<in-app-browser-context tab=\"1\">hidden</in-app-browser-context><environment_context>hidden</environment_context>").is_empty());
    // The header alone, with no files section, is stripped too; a header later in the text is the user's own.
    assert_eq!(codex::clean_codex_prompt("## My request:\npush main"),"push main");
    assert_eq!(codex::clean_codex_prompt("## My request for Codex:\n\nmerge it\n"),"merge it");
    assert_eq!(codex::clean_codex_prompt("Notes\n## My request: keep"),"Notes\n## My request: keep");
    migration_source(&f,"codex",&[
        json!({"type":"session_meta","payload":{"id":"m10","cwd":f.root.join("project")}}),
        json!({"type":"event_msg","payload":{"type":"user_message","message":wrapped}}),
        json!({"type":"event_msg","payload":{"type":"user_message","message":"<environment_context>hidden only</environment_context>"}}),
    ]);
    codex_sql(&f,"UPDATE threads SET title=NULL,first_user_message=NULL,name='Notes',source='vscode' WHERE id='m10'");
    let index=f.service.roots.codex.join("session_index.jsonl");
    fs::write(&index,io::lines(&[json!({"id":"m10","thread_name":"Indexed name"})])).unwrap();
    for (name,sql) in [
        ("Notes",None),
        ("Indexed name",Some("UPDATE threads SET name='' WHERE id='m10'")),
        ("Prepare the repo",Some("UPDATE threads SET name=NULL WHERE id='m10'")),
    ] {
        if let Some(sql)=sql { codex_sql(&f,sql); }
        if name=="Prepare the repo" { fs::remove_file(&index).unwrap(); }
        let scan=f.call("scan",json!({"sources":["codex"]}));
        assert!(scan["sessions"].as_array().unwrap().iter().any(|s|s["key"]=="codex:m10" && s["title"]==name),"{scan}");
    }
    let log=migrate_fixture(&mut f,"codex","copy"); let (_,rows,thread)=imported_rows(&f,&log);
    assert_eq!(thread["name"],"Prepare the repo"); assert_eq!(thread["preview"],cleaned);
    assert_eq!(rows.iter().filter(|r|r["message"]["role"]=="user").count(),1);
}

#[test]
fn home_is_a_code_project_and_does_not_swallow_other_projects() {
    let mut f=Fixture::new(); let home=PathBuf::from(std::env::var_os("HOME").unwrap());
    codex_project(&f,&home,"Codex home project");
    migration_source(&f,"codex",&[
        json!({"type":"session_meta","payload":{"id":"m10","source":"vscode","cwd":home}}),
        json!({"type":"event_msg","payload":{"type":"user_message","message":"Home project"}}),
    ]);
    let home_log=migrate_fixture(&mut f,"codex","copy"); let (file,_,thread)=imported_rows(&f,&home_log);
    let home_id=home_log.created[0].workspace_id.as_ref().unwrap();
    assert_eq!(f.ws[home_id].name,"Codex home project"); assert_eq!(Path::new(&f.ws[home_id].path),home);
    assert!(file.starts_with(f.service.data.join("pi/sessions"))); assert_eq!(thread["cwd"],json!(home));
    let project=f.root.join("separate-project"); fs::create_dir_all(&project).unwrap();
    migration_source(&f,"claude",&[json!({"type":"user","cwd":project,"message":{"content":"Separate project"}})]);
    let other=migrate_fixture(&mut f,"claude","copy");
    assert_ne!(other.created[0].workspace_id.as_ref(),Some(home_id));
    assert_eq!(Path::new(&f.ws[other.created[0].workspace_id.as_ref().unwrap()].path),project);
    // The filesystem root also matches only exactly.
    let root:WorkspaceEntry=serde_json::from_value(json!({"id":"root","name":"Root","path":"/","settings":{}})).unwrap();
    f.ws.insert("root".into(),root);
    let isolated=f.root.join("isolated"); fs::create_dir_all(&isolated).unwrap();
    migration_source(&f,"claude",&[json!({"type":"user","cwd":isolated,"message":{"content":"Another project"}})]);
    let mut session=f.service.scan_cache.lock().unwrap().values().filter_map(|(_,_,s)|s.as_ref()).find(|s|s.source=="claude" && s.id=="m10").unwrap().clone();
    session.cwd=isolated.to_string_lossy().into();
    assert_eq!(session.root(&f.ws),Some(isolated));
}

#[test]
fn deleted_worktrees_use_the_source_project_and_preserve_the_original_cwd() {
    for source in ["codex","claude"] {
        let mut f=Fixture::new(); let project=f.root.join("codex-project"); fs::create_dir_all(&project).unwrap();
        codex_project(&f,&project,"Source project name");
        let cwd=project.join("deleted/worktree");
        let rows=if source=="codex" { vec![json!({"type":"session_meta","payload":{"id":"m10","source":"cli","cwd":cwd}}),json!({"type":"event_msg","payload":{"type":"user_message","message":"Recover project"}})] }
            else { vec![json!({"type":"user","cwd":cwd,"message":{"content":"Recover project"}})] };
        migration_source(&f,source,&rows);
        let scan=f.call("scan",json!({"sources":[source]}));
        assert!(scan["sessions"].as_array().unwrap().iter().any(|s|s["key"]==format!("{source}:m10") && s["project"]=="Source project name" && s["state"]=="new"));
        let log=migrate_fixture(&mut f,source,"copy"); let (_,rows,thread)=imported_rows(&f,&log);
        assert_eq!(thread["cwd"],json!(project)); assert_eq!(rows[0]["importedFrom"]["cwd"],json!(cwd));
        let ws=&f.ws[log.created[0].workspace_id.as_ref().unwrap()];
        assert_eq!(ws.name,"Source project name"); assert_eq!(Path::new(&ws.path),project);
    }
}

#[test]
fn claude_desktop_title_overrides_custom_title_and_cached_metadata() {
    let mut f=Fixture::new();
    migration_source(&f,"claude",&[
        json!({"type":"user","cwd":f.root.join("project"),"message":{"content":"Prompt fallback"}}),
        json!({"type":"summary","summary":"Summary fallback"}),
        json!({"type":"custom-title","customTitle":"Custom title"}),
    ]);
    let metadata=f.service.roots.desktop.join("claude-code-sessions/acct/org/local_m10.json");
    fs::write(&metadata,serde_json::to_vec(&json!({"cliSessionId":"m10","title":"Desktop title"})).unwrap()).unwrap();
    let log=migrate_fixture(&mut f,"claude","copy"); let (_,_,thread)=imported_rows(&f,&log);
    assert_eq!(thread["name"],"Desktop title");
    fs::remove_file(metadata).unwrap();
    let scan=f.call("scan",json!({"sources":["claude"]}));
    assert!(scan["sessions"].as_array().unwrap().iter().any(|s|s["key"]=="claude:m10" && s["title"]=="Custom title"));
}

fn desktop_id(n: u64) -> String { format!("11111111-1111-4111-8111-{n:012x}") }
fn history_sql(f: &Fixture, sql: &str) {
    assert!(std::process::Command::new("sqlite3").arg(f.service.roots.codex.join("thread_history_1.sqlite")).arg(sql).status().unwrap().success());
}
fn history_fixture() -> Fixture {
    let f=Fixture::new();
    codex_sql(&f,"DELETE FROM threads");
    history_sql(&f,"CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,updated_at_ordinal INTEGER,created_at_ms INTEGER,item_json TEXT,item_type TEXT); CREATE INDEX users ON thread_items(thread_id) WHERE item_type='userMessage';");
    f
}
fn desktop_row(f: &Fixture, n: u64, source: &str, originator: Option<&str>, thread_source: &str, archived: bool, rollout: Option<&Path>) {
    let q=|s:&str|s.replace('\'',"''");
    let originator=originator.map(|o|format!("'{}'",q(o))).unwrap_or_else(||"NULL".into());
    let rollout=rollout.map(|p|format!("'{}'",q(&p.to_string_lossy()))).unwrap_or_else(||"NULL".into());
    codex_sql(f,&format!("INSERT INTO threads(id,rollout_path,cwd,name,title,first_user_message,source,originator,thread_source,archived,created_at_ms,updated_at_ms) VALUES('{}',{rollout},'{}','Desktop {n}','Raw title','First prompt','{}',{originator},'{}',{},1700000000000,1700000060000)",desktop_id(n),q(&f.root.join("project").to_string_lossy()),q(source),q(thread_source),u8::from(archived)));
}
fn history_item(f: &Fixture, n: u64, ordinal: u64, item: Value) {
    let item_type=item["type"].as_str().unwrap().replace('\'',"''");
    let text=item.to_string().replace('\'',"''");
    history_sql(f,&format!("INSERT INTO thread_items VALUES('{}','turn','item-{ordinal}',{ordinal},{ordinal},1700000000000,'{text}','{item_type}')",desktop_id(n)));
}
fn migrate_desktop(f: &mut Fixture, n: u64, mode: &str) -> Log {
    f.call("scan",json!({"sources":["codex"]}));
    serde_json::from_value(f.call("migrate",json!({"mode":mode,"sources":["codex"],"keys":[format!("codex:{}",desktop_id(n))]}))).unwrap()
}

#[test]
fn codex_database_is_the_desktop_list_and_workers_are_never_counted() {
    let mut f=history_fixture();
    let file=f.service.roots.codex.join("sessions/rollout-desktop.jsonl");
    fs::write(&file,io::lines(&[
        json!({"type":"session_meta","payload":{"id":desktop_id(1),"source":"vscode","originator":"Codex Desktop","cwd":f.root.join("project")}}),
        json!({"type":"event_msg","payload":{"type":"user_message","message":"File prompt"}}),
    ])).unwrap(); idle(&file);
    for (n,source,originator,thread_source,archived) in [
        (1,"vscode",Some("Codex Desktop"),"user",false),
        (2,"vscode",Some("codex_work_desktop"),"user",false),
        (3,"vscode",None,"user",false),
        (4,"exec",Some("codex_exec"),"user",false),
        (5,"mcp",Some("codex_sdk_ts"),"user",false),
        (6,"vscode",Some("nucode"),"user",false),
        (7,"{\"subagent\":{}}",Some("Codex Desktop"),"subagent",false),
        (8,"vscode",Some("Codex Desktop"),"user",true),
        (9,"cli",Some("codex_monitor"),"user",false),
        (10,"vscode",Some("codex_cli_rs"),"user",false),
        (11,"vscode",Some("Codex Desktop"),"user",false),
    ] {
        desktop_row(&f,n,source,originator,thread_source,archived,if n==1 {Some(&file)} else {None});
        if n!=1 { history_item(&f,n,1,json!({"id":"u","type":"userMessage","content":[{"type":"text","text":"History prompt"}]})); }
    }
    // A side chat attached to thread 1 shows inside it in Codex, not in the sidebar.
    codex_sql(&f,&format!("UPDATE threads SET attached_thread_parent_id='{}' WHERE id='{}'",desktop_id(1),desktop_id(11)));
    // Fixture::new leaves a rollout whose row was deleted; it must not come back.
    let scan=f.call("scan",json!({"sources":["codex"]}));
    assert_eq!(scan["sources"][0]["chats"],3); assert_eq!(scan["sources"][0]["pending"],3);
    assert_eq!(scan["sessions"].as_array().unwrap().len(),3);
    assert!(!scan.to_string().contains("automated"));
    let log:Log=serde_json::from_value(f.call("migrate",json!({"mode":"copy","sources":["codex"]}))).unwrap();
    assert_eq!(log.created.len(),3,"{:?}",log.skipped);
    for r in &log.created { for file in r.files.keys() { crate::shared::pi::read_imported_session(&f.service.data.join(file),&[]).unwrap(); } }
    let archived=f.call("scan",json!({"sources":["codex"],"includeArchived":true}));
    assert_eq!(archived["sources"][0]["chats"],4);
    let copied=f.call("migrate",json!({"mode":"copy","sources":["codex"],"includeArchived":true}));
    assert_eq!(copied["created"].as_array().unwrap().len(),1);
}

#[test]
fn history_only_desktop_threads_convert_native_messages_and_tool_cards() {
    let mut f=history_fixture(); desktop_row(&f,2,"vscode",Some("Codex Desktop"),"user",false,None);
    for (i,item) in [
        json!({"id":"u","type":"userMessage","content":[{"type":"text","text":"# Files mentioned by the user:\n## a: /a\n## My request for Codex:\nFix this"},{"type":"image","url":"never copied"}]}),
        json!({"id":"a","type":"agentMessage","text":"Working on it"}),
        json!({"id":"reason","type":"reasoning","text":"private reasoning"}),
        json!({"id":"cmd","type":"commandExecution","command":"/bin/zsh -lc \"echo hello\"","cwd":"/unused","aggregatedOutput":"hello\ncommand failed","exitCode":2,"status":"completed"}),
        json!({"id":"files","type":"fileChange","changes":[
            {"path":"a.rs","kind":{"type":"update"},"diff":"--- a/a.rs\n+++ b/a.rs\n@@ -1,2 +1,2 @@\n context\n-old\n+new"},
            {"path":"new.rs","kind":{"type":"add"},"diff":"--- /dev/null\n+++ b/new.rs\n@@ -0,0 +1 @@\n+hello"},
            {"path":"gone.rs","kind":{"type":"delete"},"diff":"-gone"}
        ]}),
        json!({"id":"mcp","type":"mcpToolCall","server":"docs","tool":"find","arguments":{"query":"Rust"},"result":{"content":[{"type":"text","text":"MCP result"}]},"error":null}),
        json!({"id":"mcp-error","type":"mcpToolCall","server":"docs","tool":"missing","arguments":{},"result":null,"error":{"message":"MCP failed"}}),
        json!({"id":"search","type":"webSearch","query":"Rust docs"}),
        json!({"id":"dyn","type":"dynamicToolCall","tool":"lookup","arguments":{"key":"x"},"contentItems":[{"type":"text","text":"Lookup result"}],"success":true}),
        json!({"id":"image","type":"imageView","path":"/image.png"}),
        json!({"id":"gen","type":"imageGeneration","path":"/output.png"}),
        json!({"id":"summary","type":"contextCompaction","summary":"Earlier work summarized"}),
        json!({"id":"worker","type":"subAgentActivity","text":"worker delegation"}),
        json!({"id":"out","type":"functionCallOutput","text":"duplicate output"}),
    ].into_iter().enumerate() { history_item(&f,2,i as u64,item); }
    let log=migrate_desktop(&mut f,2,"copy"); let (_,rows,thread)=imported_rows(&f,&log);
    assert_eq!(thread["name"],"Desktop 2"); assert_eq!(thread["createdAt"],1_700_000_000); assert_eq!(thread["updatedAt"],1_700_000_060);
    let rendered=thread.to_string(); assert!(rendered.contains("commandExecution")); assert!(rendered.contains("fileChange"));
    let serialized=json!(rows).to_string();
    for absent in ["private reasoning","worker delegation","duplicate output","never copied"] { assert!(!serialized.contains(absent),"{absent}"); }
    assert!(serialized.contains("Files: a (/a)")); assert!(serialized.contains("[image]")); assert!(serialized.contains("MCP result")); assert!(serialized.contains("Searched: Rust docs"));
    let calls:Vec<_>=rows.iter().flat_map(|r|r["message"]["content"].as_array().into_iter().flatten()).filter(|c|c["type"]=="toolCall").collect();
    assert!(calls.iter().any(|c|c["name"]=="bash" && c["arguments"]["command"]=="echo hello"));
    assert!(calls.iter().any(|c|c["name"]=="edit" && c["arguments"]["edits"][0]["oldText"]=="context\nold\n" && c["arguments"]["edits"][0]["newText"]=="context\nnew\n"));
    assert!(calls.iter().any(|c|c["name"]=="write" && c["arguments"]["content"]=="hello\n"));
    assert!(calls.iter().any(|c|c["name"]=="bash" && c["arguments"]["command"]=="rm 'gone.rs'"));
    let results:Vec<_>=rows.iter().map(|r|&r["message"]).filter(|m|m["role"]=="toolResult").collect();
    assert_eq!(results.len(),calls.len());
    assert!(results.iter().any(|r|r["toolCallId"]=="cmd" && r["isError"]==true));
    assert!(results.iter().any(|r|r["toolCallId"]=="mcp-error" && r["isError"]==true));
    assert_eq!(rows.last().unwrap()["type"],"compaction");
}

#[test]
fn history_change_detection_preserves_continued_threads_and_move_copies_only() {
    let mut f=history_fixture(); desktop_row(&f,2,"cli",Some("codex_cli_rs"),"user",false,None);
    history_item(&f,2,1,json!({"id":"u","type":"userMessage","content":[{"type":"text","text":"First prompt"}]}));
    let first=migrate_desktop(&mut f,2,"copy"); let (path,_,_)=imported_rows(&f,&first);
    assert!(migrate_desktop(&mut f,2,"copy").created.is_empty());
    history_item(&f,2,2,json!({"id":"a","type":"agentMessage","text":"New reply"}));
    codex_sql(&f,&format!("UPDATE threads SET updated_at_ms=1700000120000 WHERE id='{}'",desktop_id(2)));
    let updated=migrate_desktop(&mut f,2,"copy"); assert_eq!(updated.created[0].thread_id,first.created[0].thread_id);
    assert!(fs::read_to_string(&path).unwrap().contains("New reply"));
    let moved=migrate_desktop(&mut f,2,"move");
    assert!(moved.skipped.iter().any(|s|s.contains("stored in Codex's database; left in Codex")));
    assert!(f.service.roots.codex.join("thread_history_1.sqlite").exists());
    assert!(!f.service.roots.trash.exists());
    use std::io::Write;
    writeln!(fs::OpenOptions::new().append(true).open(&path).unwrap(),"{}",json!({"type":"message","id":"local","message":{"role":"user","content":[]}})).unwrap();
    history_item(&f,2,3,json!({"id":"a2","type":"agentMessage","text":"Must not replace local work"}));
    codex_sql(&f,&format!("UPDATE threads SET updated_at_ms=1700000180000 WHERE id='{}'",desktop_id(2)));
    let continued=migrate_desktop(&mut f,2,"copy"); assert!(continued.created.is_empty());
    assert!(continued.skipped[0].contains("continued in nucode"));
    assert!(!fs::read_to_string(path).unwrap().contains("Must not replace local work"));
    let mut fresh=history_fixture(); desktop_row(&fresh,3,"vscode",None,"user",false,None);
    history_item(&fresh,3,1,json!({"id":"u","type":"userMessage","content":[{"type":"text","text":"Fresh move"}]}));
    let moved=migrate_desktop(&mut fresh,3,"move"); imported_rows(&fresh,&moved);
    assert!(moved.created[0].trashed.is_empty()); assert!(moved.skipped[0].contains("stored in Codex's database; left in Codex"));
}

#[test]
fn no_database_fallback_uses_the_same_desktop_exclusions() {
    let mut f=Fixture::new(); fs::remove_file(f.service.roots.codex.join("state_5.sqlite")).unwrap();
    // Remove the old source-less fixture; absence of an originator alone is allowed, not absence of source.
    fs::remove_file(f.service.roots.codex.join("sessions/2026/10/24/rollout-clock.jsonl")).unwrap();
    for (n,source,originator,thread_source) in [
        (1,"vscode","Codex Desktop","user"),(2,"cli","codex_cli_rs","user"),(3,"vscode","","user"),
        (4,"exec","codex_exec","user"),(5,"mcp","codex_sdk_ts","user"),(6,"vscode","nucode","user"),
        (7,"vscode","codex_monitor","user"),(8,"vscode","Codex Desktop","subagent"),(9,"vscode","codex_cli_rs","user"),
    ] {
        let path=f.service.roots.codex.join(format!("sessions/rollout-{n}.jsonl"));
        fs::write(&path,io::lines(&[
            json!({"type":"session_meta","payload":{"id":desktop_id(n),"source":source,"originator":originator,"thread_source":thread_source,"cwd":f.root.join("project")}}),
            json!({"type":"event_msg","payload":{"type":"user_message","message":"Desktop prompt"}}),
        ])).unwrap(); idle(&path);
    }
    let scan=f.call("scan",json!({"sources":["codex"]})); assert_eq!(scan["sources"][0]["chats"],3);
    let log=f.call("migrate",json!({"sources":["codex"],"mode":"copy"})); assert_eq!(log["created"].as_array().unwrap().len(),3);
}

#[test]
fn history_streaming_limits_ids_and_empty_counts_are_enforced() {
    let mut f=history_fixture(); desktop_row(&f,2,"vscode",None,"user",false,None);
    desktop_row(&f,3,"vscode",None,"user",false,None);
    history_item(&f,2,1,json!({"id":"u","type":"userMessage","content":[{"type":"text","text":"A long prompt".repeat(100)}]}));
    history_item(&f,3,1,json!({"id":"a","type":"agentMessage","text":"No user prompt"}));
    let scan=f.call("scan",json!({"sources":["codex"]}));
    assert!(scan["sessions"].as_array().unwrap().iter().any(|s|s["key"]==format!("codex:{}",desktop_id(3)) && s["state"]=="empty"));
    let mut s=f.service.scanned.lock().unwrap().as_ref().unwrap().iter().find(|s|s.id==desktop_id(2)).unwrap().clone();
    let error=codex::history_items(&s,&AtomicBool::new(false),64,|_,_|Ok(())).unwrap_err();
    assert!(error.contains("exceeds 200 MB"));
    s.id="' OR 1=1; --".into();
    assert_eq!(codex::history_items(&s,&AtomicBool::new(false),io::LIMIT,|_,_|Ok(())).unwrap_err(),"Invalid Codex history thread ID");
    codex_sql(&f,&format!("UPDATE threads SET updated_at_ms={} WHERE id='{}'",chrono::Utc::now().timestamp_millis(),desktop_id(2)));
    let scan=f.call("scan",json!({"sources":["codex"]}));
    assert!(scan["sessions"].as_array().unwrap().iter().any(|s|s["key"]==format!("codex:{}",desktop_id(2)) && s["state"]=="active"));
}

#[test]
fn old_settings_ignore_the_removed_worker_run_option() {
    let mut value=json!(AppSettings::default());
    value["chatImport"]["includeAutomated"]=json!(true);
    let settings:AppSettings=serde_json::from_value(value).unwrap();
    assert_eq!(json!(settings)["chatImport"],json!({"auto":false,"sources":["claude","codex"],"includeArchived":false}));
}
