//! File-level thread operations for pi-RPC sessions: archive, permanent delete and
//! move to another project. They never start an engine process and never touch a
//! path outside the engine's own sessions folder and the per-thread extras.

use super::*;

const ARCHIVE_FOLDER: &str = "archived";
const RUNNING: &str = "Finish or interrupt the turn first";

fn valid_part(value: &str, what: &str) -> Result<(), String> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(format!("Invalid {what}"));
    }
    Ok(())
}

/// A session's file and its two optional siblings, relative to one folder.
fn session_paths(folder: &Path, id: &str) -> [PathBuf; 3] {
    [folder.join(format!("{id}.jsonl")), folder.join(format!("{id}.jsonl.streams")), folder.join(id)]
}

/// Renames every existing source into place. A failure puts back what already moved.
fn move_paths(pairs: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let mut done: Vec<&(PathBuf, PathBuf)> = vec![];
    for pair in pairs {
        if std::fs::symlink_metadata(&pair.0).is_err() {
            continue;
        }
        if let Err(error) = std::fs::rename(&pair.0, &pair.1) {
            for (from, to) in done.iter().rev() {
                let _ = std::fs::rename(to, from);
            }
            return Err(error.to_string());
        }
        done.push(pair);
    }
    Ok(())
}

fn ignore_missing(result: std::io::Result<()>) -> Result<(), String> {
    match result {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Rewrites `cwd` in the session header (the line of type "session"; OMP may put a
/// title slot before it) and leaves every other byte alone.
pub(super) fn rewrite_header_cwd(text: &str, cwd: &str) -> Result<String, String> {
    let mut out = String::with_capacity(text.len() + cwd.len());
    let mut rewritten = false;
    for (index, line) in text.split_inclusive('\n').enumerate() {
        if !rewritten && index < 2 {
            if let Ok(mut header) = serde_json::from_str::<Value>(line) {
                if header["type"] == "session" {
                    header["cwd"] = json!(cwd);
                    out.push_str(&header.to_string());
                    if line.ends_with('\n') {
                        out.push('\n');
                    }
                    rewritten = true;
                    continue;
                }
            }
        }
        out.push_str(line);
    }
    if !rewritten {
        return Err("Missing pi session header".into());
    }
    Ok(out)
}

impl PiEngine {
    pub(super) fn handles_files(&self, method: &str) -> bool {
        matches!(method, "thread/archive" | "thread/delete" | "thread/move") && !self.chat && !self.work
    }

    pub(super) async fn file_operation(&self, workspace: &str, method: &str, params: &Value) -> Result<Value, String> {
        let id = params["threadId"].as_str().ok_or("Missing thread ID")?;
        valid_part(id, "thread ID")?;
        let directory = self.directory(workspace)?;
        self.quiesce(workspace, id).await?;
        match method {
            "thread/archive" => self.archive(workspace, id, &directory).await,
            "thread/delete" => self.delete(workspace, id, &directory).await,
            _ => {
                let target = params["targetWorkspaceId"].as_str().ok_or("Missing target project")?;
                self.relocate(workspace, id, &directory, target).await
            }
        }
    }

    /// Refuses while a turn runs; shuts down an idle process so no file is open.
    async fn quiesce(&self, workspace: &str, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(id).filter(|s| s.workspace == workspace) {
            if let Some(process) = &session.process {
                let _operation = process.operation.lock().await;
                if process.running.load(Ordering::SeqCst) || process.translator.lock().await.active {
                    return Err(RUNNING.into());
                }
                process.shutdown().await?;
            }
            session.process = None;
            session.configuration.clear();
        }
        Ok(())
    }

    fn announce_archived(&self, workspace: &str, id: &str) {
        self.emit(workspace, json!({"method":"thread/archived","params":{"threadId":id}}));
    }

    async fn archive(&self, workspace: &str, id: &str, directory: &Path) -> Result<Value, String> {
        let [file, streams, folder] = session_paths(directory, id);
        if !file.is_file() {
            return Err("Unknown pi thread".into());
        }
        let archived = directory.join(ARCHIVE_FOLDER);
        std::fs::create_dir_all(&archived).map_err(|e| e.to_string())?;
        let target = session_paths(&archived, id);
        move_paths(&[(file, target[0].clone()), (streams, target[1].clone()), (folder, target[2].clone())])?;
        self.sessions.lock().await.remove(id);
        self.announce_archived(workspace, id);
        Ok(json!({"result":{}}))
    }

    async fn delete(&self, workspace: &str, id: &str, directory: &Path) -> Result<Value, String> {
        let archived = directory.join(ARCHIVE_FOLDER);
        if !session_paths(directory, id)[0].is_file() && !session_paths(&archived, id)[0].is_file() {
            return Err("Unknown pi thread".into());
        }
        for folder in [directory, archived.as_path()] {
            let [file, streams, extras] = session_paths(folder, id);
            ignore_missing(std::fs::remove_file(file))?;
            ignore_missing(std::fs::remove_dir_all(streams))?;
            ignore_missing(std::fs::remove_dir_all(extras))?;
        }
        let data = self.data.as_ref().ok_or("Pi runtime is not configured")?;
        valid_part(workspace, "workspace ID")?;
        ignore_missing(std::fs::remove_file(data.join("thread-metadata").join(workspace).join(format!("{id}.json"))))?;
        config::write_team(&data.join(format!("{}/agent", self.profile.id())).join(workspace), id, None)?;
        ignore_missing(std::fs::remove_file(data.join("checkpoints").join(format!("{workspace}.git")).join(format!("{id}.json"))))?;
        self.sessions.lock().await.remove(id);
        self.announce_archived(workspace, id);
        Ok(json!({"result":{}}))
    }

    async fn relocate(&self, workspace: &str, id: &str, directory: &Path, target: &str) -> Result<Value, String> {
        if target == workspace {
            return Err("The thread is already in that project".into());
        }
        let destination = self.directory(target)?;
        let cwd = self.paths.lock().await.get(target).cloned().ok_or("Unknown target project")?;
        let data = self.data.as_ref().ok_or("Pi runtime is not configured")?;
        let [file, streams, folder] = session_paths(directory, id);
        if !file.is_file() {
            return Err("Unknown pi thread".into());
        }
        let moved = session_paths(&destination, id);
        if moved[0].exists() {
            return Err("The target project already has that thread".into());
        }
        let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
        let rewritten = rewrite_header_cwd(&text, &cwd)?;
        std::fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        // The new copy lands whole or not at all: write beside it, then rename into place.
        let temporary = destination.join(format!(".{id}.{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temporary, rewritten).map_err(|e| e.to_string())?;
        if let Err(error) = std::fs::rename(&temporary, &moved[0]) {
            let _ = std::fs::remove_file(&temporary);
            return Err(error.to_string());
        }
        let metadata_from = data.join("thread-metadata").join(workspace).join(format!("{id}.json"));
        valid_part(target, "workspace ID")?;
        let metadata_to = data.join("thread-metadata").join(target).join(format!("{id}.json"));
        let mut pairs = vec![(streams, moved[1].clone()), (folder, moved[2].clone())];
        if metadata_from.exists() {
            if let Err(error) = std::fs::create_dir_all(metadata_to.parent().ok_or("Missing metadata directory")?) {
                let _ = std::fs::remove_file(&moved[0]);
                return Err(error.to_string());
            }
            pairs.push((metadata_from, metadata_to));
        }
        if let Err(error) = move_paths(&pairs) {
            let _ = std::fs::remove_file(&moved[0]);
            return Err(error);
        }
        if let Err(error) = std::fs::remove_file(&file) {
            // The original must stay authoritative: put everything back.
            let reversed: Vec<_> = pairs.iter().map(|(from, to)| (to.clone(), from.clone())).collect();
            let _ = move_paths(&reversed);
            let _ = std::fs::remove_file(&moved[0]);
            return Err(error.to_string());
        }
        let registry = self.registry.lock().await.get(target).cloned().unwrap_or_default().0;
        let (mut thread, _) = read_session(&moved[0], &registry)?;
        thread["engine"] = json!(self.profile.id());
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(session) = sessions.get_mut(id) {
                for key in ["modelProvider", "model", "forkedFromId", "chatWeb"] {
                    if !session.thread[key].is_null() {
                        thread[key] = session.thread[key].clone();
                    }
                }
                session.workspace = target.into();
                session.file = moved[0].clone();
                session.thread = thread.clone();
            } else {
                sessions.insert(id.into(), Session { workspace: target.into(), thread: thread.clone(), file: moved[0].clone(), process: None, configuration: String::new() });
            }
        }
        self.announce_archived(workspace, id);
        let mut notification = thread.clone();
        notification["turns"] = json!([]);
        self.emit(target, json!({"method":"thread/started","params":{"thread":notification}}));
        Ok(json!({"result":thread_response(thread, false, "ask")}))
    }
}
