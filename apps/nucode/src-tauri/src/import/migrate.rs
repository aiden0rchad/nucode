use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Session {
    pub key: String,
    pub source: String,
    pub title: String,
    pub cwd: String,
    pub project: String,
    pub updated_at: i64,
    pub archived: bool,
    pub state: String,
    #[serde(skip)] pub id: String,
    #[serde(skip)] pub path: PathBuf,
    #[serde(skip)] pub metadata: Option<PathBuf>,
    #[serde(skip)] pub first_time: String,
    #[serde(skip)] pub size: u64,
    #[serde(skip)] pub mtime: u64,
    #[serde(skip)] pub empty: bool,
    #[serde(skip)] pub custom_title: String,
    #[serde(skip)] pub codex_desktop: bool,
    #[serde(skip)] pub codex_db: Option<PathBuf>,
    #[serde(skip)] pub history: bool,
    #[serde(skip)] pub project_roots: Vec<(PathBuf, String)>,
}
impl Session {
    pub fn new(source: &str, path: &Path) -> Result<Self, String> {
        io::safe(path)?;
        let (size, mtime) = fingerprint(path)?;
        Ok(Self { key: String::new(), source: source.into(), title: String::new(), cwd: String::new(), project: String::new(), updated_at: (mtime/1000) as i64, archived: false, state: "new".into(), id: String::new(), path: path.into(), metadata: None, first_time: String::new(), size, mtime, empty: true, custom_title: String::new(), codex_desktop: false, codex_db: None, history: false, project_roots: vec![] })
    }
    pub fn observe(&mut self, row: &Value) {
        if self.cwd.is_empty() { self.cwd = row["cwd"].as_str().unwrap_or_default().into(); }
        if let Some(t) = row["timestamp"].as_str().filter(|t| convert::timestamp(t) != 0) {
            if self.first_time.is_empty() { self.first_time = t.into(); }
            self.updated_at = convert::timestamp(t)/1000;
        }
    }
    pub fn finish(&mut self) {
        self.key = format!("{}:{}", self.source, self.id);
        self.project = Path::new(&self.cwd).file_name().unwrap_or_default().to_string_lossy().into();
        if self.first_time.is_empty() { self.first_time = chrono::DateTime::from_timestamp(self.updated_at, 0).unwrap_or_default().to_rfc3339(); }
    }
    pub fn entry(self) -> Entry {
        let mut e = Entry::new(&self.source, &self.id, "thread", &self.title, &self.project, &self.cwd);
        e.archived = self.archived; e.session = Some(self); e
    }
    fn chat(&self) -> bool {
        self.root(&HashMap::new()).is_none()
    }
    pub(super) fn root(&self, workspaces: &HashMap<String, WorkspaceEntry>) -> Option<PathBuf> {
        let cwd = Path::new(&self.cwd);
        if !cwd.is_absolute() { return None; }
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let ordinary = |path: &Path| path != Path::new("/") && home.as_deref() != Some(path);
        let registered: Vec<_> = workspaces.values().map(|w| PathBuf::from(&w.path)).collect();
        // Sessions run in temporary folders never become projects (tests keep their fixtures there).
        #[cfg(not(test))]
        if ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"].iter().any(|t| cwd.starts_with(t)) {
            return registered.iter().find(|p| p.as_path() == cwd).cloned();
        }
        let root = registered.iter().chain(self.project_roots.iter().map(|(p,_)| p))
            .filter(|p| p.is_dir() && (cwd == p.as_path() || ordinary(p) && cwd.starts_with(p)))
            .max_by_key(|p| p.components().count()).cloned();
        root.or_else(|| if cwd.is_dir() { Some(cwd.into()) }
            else { cwd.ancestors().skip(1).find(|p| ordinary(p) && p.is_dir()).map(Path::to_path_buf) })
    }
    fn fingerprint(&self, cancel: &AtomicBool) -> Result<(u64,u64),String> {
        if self.history { codex::history_version(self,cancel) } else { fingerprint(&self.path) }
    }
    fn active(&self) -> bool { now().saturating_sub(self.mtime) < 600_000 }
}
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn fingerprint(path: &Path) -> Result<(u64, u64), String> {
    io::safe(path)?;
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok((m.len(), m.modified().map_err(|e| e.to_string())?.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64))
}
pub(super) type ScanCache = Mutex<HashMap<PathBuf, (u64, u64, Option<Session>)>>;
pub(super) fn cached_session(cache: &ScanCache, path: &Path, read: impl FnOnce() -> Result<Option<Session>, String>) -> Result<Option<Session>, String> {
    let (size, mtime) = fingerprint(path)?;
    if let Some((old_size, old_mtime, session)) = cache.lock().unwrap().get(path) {
        if (*old_size, *old_mtime) == (size, mtime) { return Ok(session.clone()); }
    }
    let session = read()?;
    if fingerprint(path)? == (size, mtime) { cache.lock().unwrap().insert(path.into(), (size, mtime, session.clone())); }
    Ok(session)
}
pub(super) fn auto_enabled(settings: &AppSettings) -> bool {
    settings.chat_import.auto && settings.features.import_tools && json!(settings.backend_mode) != "remote"
}
fn file_hash(path: &Path) -> Result<String, String> {
    use std::io::Read;
    io::safe(path)?;
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new(); let mut buffer = [0; 65536];
    loop { let n = file.read(&mut buffer).map_err(|e| e.to_string())?; if n == 0 { break; } digest.update(&buffer[..n]); }
    Ok(format!("{:x}", digest.finalize()))
}
fn sources(params: &Value) -> Result<Vec<String>, String> {
    let Some(value) = params.get("sources") else { return Ok(vec!["claude".into(), "codex".into()]); };
    value.as_array().ok_or("Invalid chat sources")?.iter().map(|v| match v.as_str() { Some(s @ ("claude" | "codex")) => Ok(s.to_owned()), _ => Err("Invalid chat source".into()) }).collect()
}
impl Imports {
    pub(super) async fn auto_request(self: &Arc<Self>, workspaces: &tokio::sync::Mutex<HashMap<String, WorkspaceEntry>>, settings: &tokio::sync::Mutex<AppSettings>) -> Result<Value, String> {
        let mut params = {
            let settings = settings.lock().await;
            if !auto_enabled(&settings) { return Ok(Value::Null); }
            json!({"mode":"copy","sources":settings.chat_import.sources,"includeArchived":settings.chat_import.include_archived})
        };
        let result = match self.scan_request(params.clone()).await {
            Ok((_, sessions)) => {
                let keys: Vec<_> = sessions.iter().filter(|s| matches!(s.state.as_str(), "new" | "updated" | "chatMode") && !s.active()).map(|s| s.key.clone()).collect();
                if keys.is_empty() { Ok(Value::Null) } else {
                    params["keys"] = json!(keys);
                    match self.mutate_request("migrate", params, workspaces, settings, Some(sessions)).await {
                        Err(error) if error == "An import operation is already running" => return Ok(Value::Null),
                        result => result,
                    }
                }
            }
            Err(error) => Err(error),
        };
        let imported = result.as_ref().ok().and_then(|v| v["created"].as_array()).map_or(0, Vec::len);
        let skipped = result.as_ref().ok().and_then(|v| v["skipped"].as_array()).map_or(0, Vec::len);
        *self.auto_status.lock().unwrap() = json!({"lastRunAt":now(),"imported":imported,"skipped":skipped,"error":result.as_ref().err()});
        result
    }
    fn migrations(&self) -> Result<Value, String> { storage::read_thread_metadata(&self.data.join("imports/migrations.json")) }
    fn save_migrations(&self, value: &Value) -> Result<(), String> { storage::write_thread_metadata(&self.data.join("imports/migrations.json"), value) }
    fn migration_state(&self, s: &Session, records: &Value) -> String {
        if s.empty { return "empty".into(); }
        if let Some(r) = records.get(&s.key) {
            if file_hash(&self.data.join(r["file"].as_str().unwrap_or_default())).ok().as_deref() != r["fileHash"].as_str() { return "continued".into(); }
            if r["sourceSize"] == s.size && r["sourceMtime"] == s.mtime { return "current".into(); }
            return if s.active() { "active" } else { "updated" }.into();
        }
        if s.active() { "active" } else if s.chat() { "chatMode" } else { "new" }.into()
    }
    pub(super) fn scan(&self, params: &Value) -> Result<Value, String> {
        let selected = sources(params)?;
        let mut sessions = vec![]; let mut warnings = vec![];
        if selected.iter().any(|s| s == "claude") {
            match claude::scan(&self.roots, &self.scan_cancel, &self.scan_cache) { Ok(v) => sessions.extend(v), Err(e) => warnings.push(format!("Claude: {e}")) }
        }
        if selected.iter().any(|s| s == "codex") {
            match parse::codex(&self.roots.codex, &self.scan_cancel, &self.scan_cache, params["includeArchived"] == true) { Ok(v) => sessions.extend(v.into_iter().filter_map(|e| e.session)), Err(e) => warnings.push(format!("Codex: {e}")) }
        }
        io::check(&self.scan_cancel)?;
        let records = self.migrations()?;
        let duplicate_file = self.roots.codex.join("external_agent_session_imports.json");
        let duplicates = if duplicate_file.exists() { io::json(&duplicate_file, &self.scan_cancel).unwrap_or(Value::Null) } else { Value::Null };
        let claude_paths: HashSet<_> = sessions.iter().filter(|s| s.source == "claude" && (!s.archived || params["includeArchived"] == true)).map(|s| s.path.to_string_lossy().to_string()).collect();
        fn duplicate(value: &Value, id: &str, paths: &HashSet<String>) -> bool {
            if value["imported_thread_id"] == id && value["source_path"].as_str().is_some_and(|p| paths.contains(p)) { return true; }
            match value { Value::Array(a) => a.iter().any(|v| duplicate(v,id,paths)), Value::Object(m) => m.values().any(|v| duplicate(v,id,paths)), _ => false }
        }
        for s in &mut sessions {
            s.state = if s.source == "codex" && duplicate(&duplicates, &s.id, &claude_paths) { "duplicate".into() } else { self.migration_state(s, &records) };
            if let Some(root) = s.root(&HashMap::new()) {
                s.project = s.project_roots.iter().find(|(p,_)| p == &root).map(|(_,name)| name.clone())
                    .unwrap_or_else(|| root.file_name().unwrap_or_default().to_string_lossy().into());
            }
        }
        let counts: Vec<_> = selected.iter().map(|source| {
            let all: Vec<_> = sessions.iter().filter(|s| &s.source == source).collect();
            let included: Vec<_> = all.iter().filter(|s| !s.archived || params["includeArchived"] == true).collect();
            json!({"source":source,"chats":included.len(),"projects":included.iter().map(|s| s.root(&HashMap::new()).unwrap_or_else(|| PathBuf::from(&s.cwd))).collect::<HashSet<_>>().len(),"alreadyImported":included.iter().filter(|s| records.get(&s.key).is_some()).count(),"pending":included.iter().filter(|s| matches!(s.state.as_str(), "new"|"updated"|"chatMode")).count(),"archived":all.iter().filter(|s| s.archived).count()})
        }).collect();
        sessions.retain(|s| !s.archived || params["includeArchived"] == true);
        sessions.sort_by_key(|s| std::cmp::Reverse(s.updated_at));
        let response = json!({"sources":counts,"sessions":sessions,"warnings":warnings});
        *self.scanned.lock().unwrap() = Some(sessions);
        Ok(response)
    }
    pub(super) fn migrate(&self, params: Value, workspaces: &mut HashMap<String, WorkspaceEntry>, settings: &mut AppSettings) -> Result<Value, String> {
        if self.scanned.lock().unwrap().is_none() { self.scan(&params)?; }
        let sessions = self.scanned.lock().unwrap().clone().unwrap_or_default();
        self.migrate_sessions(params, sessions, workspaces, settings)
    }
    pub(super) fn migrate_sessions(&self, params: Value, sessions: Vec<Session>, workspaces: &mut HashMap<String, WorkspaceEntry>, settings: &mut AppSettings) -> Result<Value, String> {
        let mode = params["mode"].as_str().ok_or("Choose copy or move")?;
        if !matches!(mode, "copy" | "move") { return Err("Choose copy or move".into()); }
        let selected = sources(&params)?;
        let keys = params.get("keys").map(|v| v.as_array().ok_or("Invalid chat selection")).transpose()?;
        if keys.is_some_and(|keys| keys.iter().any(|key| !sessions.iter().any(|s| key == &s.key))) { return Err("Selection expired; scan again".into()); }
        let mut records = self.migrations()?;
        let mut log = Log { id: format!("{}-{}", chrono::Utc::now().format("%Y%m%dT%H%M%S"), uuid::Uuid::new_v4()), ..Log::default() };
        self.save_log(&log)?;
        let sessions: Vec<_> = sessions.into_iter().filter(|s| selected.contains(&s.source) && (!s.archived || params["includeArchived"] == true) && keys.is_none_or(|keys| keys.iter().any(|k| k == &s.key))).collect();
        *self.progress.lock().unwrap() = json!({"running":true,"phase":"migrate","completed":0,"total":sessions.len()});
        for (n, s) in sessions.iter().enumerate() {
            if io::check(&self.cancel).is_err() { log.cancelled = true; break; }
            let result = self.migrate_one(s, mode, &mut records, &mut log, workspaces, settings);
            if let Err(error) = result { log.skipped.push(format!("{}: {error}", s.title)); }
            self.progress.lock().unwrap()["completed"] = json!(n+1);
            self.save_log(&log)?;
        }
        self.save_log(&log)?;
        Ok(json!(log))
    }
    fn migrate_one(&self, s: &Session, mode: &str, records: &mut Value, log: &mut Log, workspaces: &mut HashMap<String, WorkspaceEntry>, settings: &AppSettings) -> Result<(), String> {
        if s.source == "codex" && !s.codex_desktop { return Err("Not a Codex Desktop thread".into()); }
        let (size, mtime) = s.fingerprint(&self.cancel)?;
        if size != s.size || mtime != s.mtime { return Err("source changed since scan; scan again".into()); }
        let state = self.migration_state(s, records);
        if s.state == "duplicate" { return Err("duplicate of selected Claude original".into()); }
        if state == "active" || s.active() { return Err("in use; try again when it has been idle for 10 minutes".into()); }
        if state == "empty" { return Err("no human prompts".into()); }
        if state == "continued" { return Err("continued in nucode; left as is".into()); }
        if state == "current" && mode == "copy" { return Err("already in nucode".into()); }
        let previous = records.get(&s.key).cloned();
        let mut receipt;
        if state == "current" {
            receipt = Receipt { key:s.key.clone(), title:s.title.clone(), kind:"thread".into(), thread_id:previous.as_ref().unwrap()["threadId"].as_str().unwrap_or_default().into(), ..Receipt::default() };
        } else {
            let id = previous.as_ref().and_then(|r| r["threadId"].as_str()).map(str::to_owned).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let (workspace, profile, cwd, file) = if let Some(r) = &previous {
                let profile = r["profile"].as_str().ok_or("Invalid migration profile")?.to_owned();
                let file = Path::new(r["file"].as_str().ok_or("Invalid migration file")?);
                if file.is_absolute() || file.components().any(|c| matches!(c, std::path::Component::ParentDir)) { return Err("Invalid migration file".into()); }
                (None, profile.clone(), if profile == "chats" { self.data.join("chats/scratch").join(&id) } else if Path::new(&s.cwd).is_dir() { PathBuf::from(&s.cwd) } else { s.root(workspaces).ok_or("No existing project folder")? }, PathBuf::from(r["file"].as_str().ok_or("Invalid migration file")?))
            } else { self.target(s, &id, workspaces, settings)? };
            let workspace_id = previous.as_ref().and_then(|r| r["workspaceId"].as_str()).map(str::to_owned).or_else(|| workspace.as_ref().map(|w| w.id.clone()));
            let mut b = convert::Builder::new(s, &id, &cwd, if profile == "chats" { "pi" } else { &profile }, settings);
            if s.source == "claude" { claude::convert(&s.path, &self.cancel, &mut b)?; } else if s.history { codex::convert_history(s, &self.cancel, &mut b)?; } else { codex::convert(&s.path, &self.cancel, &mut b)?; }
            let bytes = b.finish(&s.source);
            if s.fingerprint(&self.cancel)? != (size, mtime) { return Err("source changed during conversion; scan again".into()); }
            io::check(&self.cancel)?;
            let destination = self.data.join(&file);
            let temporary = destination.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
            write_new(&temporary, &bytes)?;
            let written = (|| {
                fs::File::open(&temporary).and_then(|f| f.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(s.updated_at.max(0) as u64))).map_err(|e| e.to_string())?;
                crate::shared::pi::read_imported_session(&temporary, &settings.providers)?;
                if let Some(r) = &previous { if file_hash(&destination)? != r["fileHash"].as_str().unwrap_or_default() { return Err("continued in nucode; left as is".into()); } }
                else if destination.exists() { return Err("Destination already exists".into()); }
                if profile == "chats" { fs::create_dir_all(&cwd).map_err(|e| e.to_string())?; }
                Ok::<_,String>(())
            })();
            if let Err(e) = written { let _ = fs::remove_file(&temporary); return Err(e); }
            receipt = Receipt { key:s.key.clone(),title:s.title.clone(),kind:"thread".into(),thread_id:id.clone(),workspace_id:workspace_id.clone(),files:HashMap::from([(file.to_string_lossy().to_string(),hash(&bytes))]),workspace:workspace.as_ref().filter(|w| !workspaces.contains_key(&w.id)).map(|w| json!(w)),..Receipt::default() };
            log.created.push(receipt.clone()); self.save_log(log)?;
            fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
            if let Some(w) = workspace { workspaces.insert(w.id.clone(), w); }
            self.persist_registry(workspaces, settings)?;
            records[&s.key] = json!({"threadId":id,"workspaceId":workspace_id,"profile":profile,"file":file,"fileHash":hash(&bytes),"sourcePath":s.path,"sourceSize":size,"sourceMtime":mtime,"logId":log.id});
            self.save_migrations(records)?;
        }
        if mode == "move" {
            if s.history { log.skipped.push(format!("{}: stored in Codex's database; left in Codex",s.title)); return Ok(()); }
            if state == "current" { log.created.push(receipt.clone()); self.save_log(log)?; }
            let mut paths = vec![s.path.clone()];
            if s.source == "claude" {
                let sidecar = s.path.with_extension("");
                if sidecar.exists() { paths.push(sidecar); }
                if let Some(p) = &s.metadata { paths.push(p.clone()); }
            }
            for path in paths {
                if fingerprint(&s.path).is_ok_and(|f| f != (size,mtime)) { return Err("source changed before move; originals retained".into()); }
                io::safe(&path)?;
                #[cfg(all(target_os = "macos", not(test)))]
                {
                    let target = trash_source(&path)?;
                    receipt.trashed.insert(path.to_string_lossy().into(), target.to_string_lossy().into());
                    log.created.last_mut().unwrap().trashed = receipt.trashed.clone(); self.save_log(log)?;
                }
                #[cfg(any(not(target_os = "macos"), test))]
                {
                    fs::create_dir_all(&self.roots.trash).map_err(|e| e.to_string())?;
                    io::safe(&self.roots.trash)?;
                    let mut target = self.roots.trash.join(path.file_name().ok_or("Missing source name")?);
                    let mut n = 1;
                    while target.exists() {
                        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                        let extension = path.extension().map(|s| format!(".{}",s.to_string_lossy())).unwrap_or_default();
                        target = self.roots.trash.join(format!("{stem} {n}{extension}")); n+=1;
                }
                receipt.trashed.insert(path.to_string_lossy().into(),target.to_string_lossy().into());
                log.created.last_mut().unwrap().trashed = receipt.trashed.clone(); self.save_log(log)?;
                fs::rename(&path,&target).map_err(|e| format!("Could not move to Trash: {e}"))?;
                }
            }
        }
        Ok(())
    }
    fn target(&self, s: &Session, id: &str, workspaces: &HashMap<String, WorkspaceEntry>, settings: &AppSettings) -> Result<(Option<WorkspaceEntry>, String, PathBuf, PathBuf), String> {
        let Some(root) = s.root(workspaces) else { return Ok((None,"chats".into(),self.data.join("chats/scratch").join(id),PathBuf::from("chats/sessions/chats").join(format!("{id}.jsonl")))); };
        let name = s.project_roots.iter().find(|(p,_)| p == &root).map(|(_,name)| name.clone()).unwrap_or_else(|| root.file_name().unwrap_or_default().to_string_lossy().into());
        let w = workspaces.values().find(|w| Path::new(&w.path) == root).cloned().unwrap_or(serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"name":name,"path":root,"settings":{}})).map_err(|e| e.to_string())?);
        let override_engine = w.settings.default_engine.as_ref().or_else(|| w.settings.agent_policy.as_ref().and_then(|p| p.default_engine.as_ref()));
        let profile = override_engine.filter(|e| matches!(e.as_str(),"pi"|"omp")).unwrap_or(&settings.agent_policy.default_engine).as_str();
        let profile = if matches!(profile,"pi"|"omp") { profile } else { "pi" }.to_owned();
        let file = PathBuf::from(&profile).join("sessions").join(&w.id).join(format!("{id}.jsonl"));
        let cwd = if Path::new(&s.cwd).is_dir() { PathBuf::from(&s.cwd) } else { root };
        Ok((Some(w),profile,cwd,file))
    }
    pub(super) fn restore_migrations(&self, log: &Log) -> Result<(),String> {
        // Restore sources first. Never overwrite a replacement created by the source app.
        for receipt in &log.created {
            for (original, trashed) in &receipt.trashed {
                let original = Path::new(original); let trashed = Path::new(trashed);
                let in_trash = trashed.starts_with(&self.roots.trash)
                    || trashed.ancestors().any(|p| p.file_name().is_some_and(|name| name == ".Trashes"));
                if !in_trash { return Err("Invalid Trash receipt".into()); }
                if ![self.roots.claude.join("projects"),self.roots.desktop.join("claude-code-sessions"),self.roots.codex.join("sessions"),self.roots.codex.join("archived_sessions")].iter().any(|root| original.starts_with(root)) { return Err("Invalid original source path".into()); }
                match fs::symlink_metadata(trashed) {
                    Ok(meta) if meta.file_type().is_symlink() => return Err("Trashed source symlinks are not restorable".into()),
                    Ok(_) => {
                        if original.exists() { return Err(format!("Cannot restore {}; the original path is occupied",original.display())); }
                        io::safe(trashed)?;
                        fs::create_dir_all(original.parent().ok_or("Invalid original path")?).map_err(|e| e.to_string())?;
                        io::safe(original.parent().unwrap())?;
                        fs::rename(trashed,original).map_err(|e| e.to_string())?;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound && original.exists() => (), // Already restored during an earlier Undo attempt.
                    Err(error) => return Err(format!("Cannot restore trashed source: {error}")),
                }
            }
        }
        Ok(())
    }
    pub(super) fn forget_migrations(&self, log: &Log) -> Result<(),String> {
        let mut records = self.migrations()?;
        if let Some(map) = records.as_object_mut() { map.retain(|_,r| r["logId"] != log.id); }
        self.save_migrations(&records)
    }
}

#[cfg(all(target_os = "macos", not(test)))]
fn trash_source(path: &Path) -> Result<PathBuf, String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    objc2::rc::autoreleasepool(|_| {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path.to_str().ok_or("Invalid source path")?));
        let mut resulting_url = None;
        NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, Some(&mut resulting_url))
            .map_err(|e| format!("Could not move to Trash: {e}"))?;
        let path = resulting_url.and_then(|url| url.path()).ok_or("Trash did not return a destination path")?;
        Ok(PathBuf::from(path.to_string()))
    })
}

