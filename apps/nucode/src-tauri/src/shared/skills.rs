//! Agent Skills (a folder with `SKILL.md`) offered to every Code engine.
//!
//! nucode owns a library of copied skills (`<data>/skills/<name>`) and can read the Claude Code,
//! Codex and `~/.agents` skill folders live when the user turns them on. `resolve` merges them;
//! `sync_links` rebuilds a directory of symlinks that an engine is pointed at. Skill content is
//! never executed or interpreted here; only the `name` and `description` frontmatter is read.
use crate::types::SkillsSettings;
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub(crate) const MAX_INSTALL_BYTES: u64 = 20 * 1024 * 1024;
pub(crate) const MAX_INSTALL_FILES: usize = 2000;
const CLONE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Skill {
    pub name: String,
    pub description: String,
    pub path: PathBuf,
    /// "library", "claudeCode", "codex" or "agents".
    pub source: &'static str,
    pub enabled: bool,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct Warning { pub path: String, pub message: String }
#[derive(Debug, Default, Clone, Serialize)]
pub(crate) struct Resolution { pub skills: Vec<Skill>, pub warnings: Vec<Warning> }
impl Resolution {
    pub fn enabled(&self) -> impl Iterator<Item = &Skill> { self.skills.iter().filter(|s| s.enabled) }
}
#[derive(Debug, Default, Serialize)]
pub(crate) struct Installed { pub installed: Vec<String>, pub conflicts: Vec<String>, pub warnings: Vec<Warning> }

pub(crate) fn library(data: &Path) -> PathBuf { data.join("skills") }
fn warn(path: &Path, message: impl Into<String>) -> Warning { Warning { path: path.to_string_lossy().into(), message: message.into() } }
fn home_dir() -> Option<PathBuf> { std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from) }

fn unquote(value: &str) -> String {
    let v = value.trim();
    for q in ['"', '\''] {
        if v.len() >= 2 && v.starts_with(q) && v.ends_with(q) { return v[1..v.len() - 1].replace(&format!("\\{q}"), &q.to_string()); }
    }
    v.to_string()
}
/// `name` and `description` from the leading YAML frontmatter. A small reader for what the Agent
/// Skills format needs: plain, quoted, folded (`>`) and literal (`|`) scalars, plus indented
/// continuation lines.
pub(crate) fn frontmatter(text: &str) -> (Option<String>, Option<String>) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") { return (None, None); }
    let mut block: Vec<&str> = vec![];
    for line in lines {
        if line.trim_end() == "---" { break; }
        block.push(line);
    }
    let (mut name, mut description) = (None, None);
    let mut i = 0;
    while i < block.len() {
        let line = block[i];
        i += 1;
        let Some((key, rest)) = line.split_once(':') else { continue };
        if line.starts_with([' ', '\t']) || !matches!(key, "name" | "description") { continue; }
        let mut parts = vec![rest.trim().to_string()];
        while i < block.len() && (block[i].starts_with([' ', '\t']) || block[i].trim().is_empty()) {
            parts.push(block[i].trim().to_string());
            i += 1;
        }
        let first = parts[0].clone();
        let value = if first.starts_with(['>', '|']) {
            let folded = first.starts_with('>');
            parts[1..].iter().map(String::as_str).collect::<Vec<_>>().join(if folded { " " } else { "\n" }).trim().to_string()
        } else {
            unquote(&parts.iter().filter(|p| !p.is_empty()).cloned().collect::<Vec<_>>().join(" "))
        };
        let value = Some(value).filter(|v| !v.is_empty());
        if key == "name" { name = value } else { description = value }
    }
    (name, description)
}
fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && !name.starts_with('.') && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Skills directly under `root`. Dot folders (Codex's `.system`) and entries without a `SKILL.md`
/// are skipped; a skill whose folder cannot be resolved to a real directory, or whose frontmatter
/// lacks a description, is skipped with a warning.
fn scan(root: &Path, source: &'static str, skills: &mut Vec<Skill>, warnings: &mut Vec<Warning>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let folder = entry.file_name().to_string_lossy().into_owned();
        if folder.starts_with('.') { continue; }
        let path = entry.path();
        let real = match fs::canonicalize(&path) {
            Ok(real) if real.is_dir() => real,
            Ok(_) => continue,
            Err(_) => { warnings.push(warn(&path, "Skipped: the folder this link points to is missing")); continue }
        };
        let manifest = real.join("SKILL.md");
        if !manifest.is_file() { continue; }
        let Ok(text) = fs::read_to_string(&manifest) else { warnings.push(warn(&path, "Skipped: SKILL.md is not readable text")); continue };
        let (name, description) = frontmatter(&text);
        let Some(description) = description else { warnings.push(warn(&path, "Skipped: SKILL.md has no description in its frontmatter")); continue };
        let name = match name {
            Some(name) => name,
            None => { warnings.push(warn(&path, format!("SKILL.md has no name; using the folder name \"{folder}\""))); folder }
        };
        if !safe_name(&name) { warnings.push(warn(&path, format!("Skipped: \"{name}\" is not a valid skill name (letters, digits, - _ . only)"))); continue }
        skills.push(Skill { name, description, path: real, source, enabled: true });
    }
}

/// The merged skill list. Precedence on a name clash: library, Claude Code, Codex, agents.
pub(crate) fn resolve_in(data: &Path, home: Option<&Path>, settings: &SkillsSettings) -> Resolution {
    let mut found: Vec<Skill> = vec![];
    let mut warnings = vec![];
    scan(&library(data), "library", &mut found, &mut warnings);
    if let Some(home) = home {
        let sources = &settings.sources;
        if sources.claude_code { scan(&home.join(".claude/skills"), "claudeCode", &mut found, &mut warnings); }
        if sources.codex { scan(&home.join(".codex/skills"), "codex", &mut found, &mut warnings); }
        if sources.agents { scan(&home.join(".agents/skills"), "agents", &mut found, &mut warnings); }
    }
    let mut seen = HashSet::new();
    let mut skills = vec![];
    for mut skill in found {
        if !seen.insert(skill.name.clone()) { continue; }
        skill.enabled = !settings.disabled.contains(&skill.name);
        skills.push(skill);
    }
    skills.sort_by_key(|s| s.name.to_lowercase());
    Resolution { skills, warnings }
}
pub(crate) fn resolve(data: &Path, settings: &SkillsSettings) -> Resolution { resolve_in(data, home_dir().as_deref(), settings) }

/// Makes `dir` hold exactly one symlink per skill (a copy where symlinks are unavailable).
pub(crate) fn sync_links(dir: &Path, skills: &[&Skill]) -> Result<(), String> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_link = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
            if is_link || path.is_file() { fs::remove_file(&path) } else { fs::remove_dir_all(&path) }.map_err(|e| e.to_string())?;
        }
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    for skill in skills {
        let link = dir.join(&skill.name);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&skill.path, &link).map_err(|e| e.to_string())?;
        #[cfg(not(unix))]
        copy_tree(&skill.path, &link, &mut Budget::default())?;
    }
    Ok(())
}

#[derive(Default)]
struct Budget { bytes: u64, files: usize }
/// Copies regular files only: symlinks and `.git` are never followed or copied.
fn copy_tree(from: &Path, to: &Path, budget: &mut Budget) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if kind.is_symlink() || name == ".git" { continue; }
        if kind.is_dir() {
            copy_tree(&entry.path(), &to.join(&name), budget)?;
        } else if kind.is_file() {
            budget.files += 1;
            budget.bytes += entry.metadata().map_err(|e| e.to_string())?.len();
            if budget.files > MAX_INSTALL_FILES { return Err(format!("This is more than {MAX_INSTALL_FILES} files; nucode installs skill packs, not whole repositories")); }
            if budget.bytes > MAX_INSTALL_BYTES { return Err(format!("This is more than {} MB; nucode installs skill packs, not whole repositories", MAX_INSTALL_BYTES / 1024 / 1024)); }
            fs::copy(entry.path(), to.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Skill folders in a tree: the root itself, or every folder with a `SKILL.md` up to three levels down.
fn find_skills(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if root.join("SKILL.md").is_file() { out.push(root.to_path_buf()); return; }
    if depth == 0 { return; }
    let Ok(entries) = fs::read_dir(root) else { return };
    let mut entries: Vec<_> = entries.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name();
        if name == ".git" || name == "node_modules" { continue; }
        find_skills(&entry.path(), depth - 1, out);
    }
}

/// GitHub `https://github.com/<owner>/<repo>[.git][/tree/<branch>[/<subdir>]]` -> (clone url, branch, subdir).
/// A branch name with a slash is not supported; the first segment after `/tree/` is the branch.
pub(crate) fn parse_git_url(source: &str) -> Result<(String, Option<String>, PathBuf, String), String> {
    let rest = source.trim().trim_end_matches('/').strip_prefix("https://github.com/").ok_or("Use an https://github.com/<owner>/<repo> address or a folder on this computer")?;
    let parts: Vec<&str> = rest.split('/').collect();
    let part_ok = |p: &str| !p.is_empty() && !p.starts_with('-') && p != ".." && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if parts.len() < 2 || !part_ok(parts[0]) || !part_ok(parts[1].trim_end_matches(".git")) { return Err("That is not a GitHub repository address".into()); }
    let repo = parts[1].trim_end_matches(".git");
    let url = format!("https://github.com/{}/{repo}.git", parts[0]);
    match parts.get(2) {
        None => Ok((url, None, PathBuf::new(), repo.into())),
        Some(&"tree") if parts.len() >= 4 => {
            let sub: PathBuf = parts[4..].iter().collect();
            if !part_ok(parts[3]) || parts[4..].iter().any(|p| !part_ok(p)) { return Err("That is not a GitHub repository address".into()); }
            Ok((url, Some(parts[3].into()), sub, repo.into()))
        }
        _ => Err("Use the repository address, or one ending in /tree/<branch>/<folder>".into()),
    }
}

fn clone(url: &str, branch: Option<&str>, dest: &Path) -> Result<(), String> {
    let mut command = Command::new("git");
    command.args(["clone", "--depth", "1", "--quiet"]);
    if let Some(branch) = branch { command.args(["--branch", branch]); }
    let mut child = command.arg("--").arg(url).arg(dest)
        .env("GIT_TERMINAL_PROMPT", "0").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("Could not run git: {e}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(_) => {
                let mut message = String::new();
                if let Some(mut err) = child.stderr.take() { let _ = std::io::Read::read_to_string(&mut err, &mut message); }
                let message = message.trim();
                return Err(format!("Could not download the repository: {}", if message.is_empty() { "git failed" } else { message }));
            }
            None if started.elapsed() > CLONE_TIMEOUT => { let _ = child.kill(); let _ = child.wait(); return Err("Downloading the repository took too long".into()); }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// Copies every valid skill under `source` (a folder, or a GitHub address) into the library.
/// On a name clash nothing is installed unless `replace`; the clashing names come back in `conflicts`.
pub(crate) fn install(data: &Path, source: &str, replace: bool) -> Result<Installed, String> {
    let scratch = data.join(format!(".skills-install-{}", uuid::Uuid::new_v4()));
    let result = install_from(data, source, replace, &scratch);
    let _ = fs::remove_dir_all(&scratch);
    result
}
fn install_from(data: &Path, source: &str, replace: bool, scratch: &Path) -> Result<Installed, String> {
    let source = source.trim();
    if source.is_empty() { return Err("Enter a GitHub address or choose a folder".into()); }
    fs::create_dir_all(scratch).map_err(|e| e.to_string())?;
    let (root, fallback) = if source.starts_with("https://") || source.starts_with("http://") {
        let (url, branch, sub, repo) = parse_git_url(source)?;
        let checkout = scratch.join("repo");
        clone(&url, branch.as_deref(), &checkout)?;
        let root = checkout.join(sub);
        // The subfolder is untrusted path text: it must stay inside the checkout.
        if !fs::canonicalize(&root).is_ok_and(|r| fs::canonicalize(&checkout).is_ok_and(|c| r.starts_with(c))) { return Err("That folder is not in the repository".into()); }
        (root, repo)
    } else {
        let root = fs::canonicalize(source).map_err(|_| "That folder does not exist".to_string())?;
        let fallback = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        (root, fallback)
    };
    let mut folders = vec![];
    find_skills(&root, 3, &mut folders);
    if folders.is_empty() { return Err("No skills found: a skill is a folder with a SKILL.md file".into()); }
    let mut warnings = vec![];
    let mut staged: Vec<(String, PathBuf)> = vec![];
    let mut budget = Budget::default();
    let staging = scratch.join("staged");
    for folder in folders {
        let Ok(text) = fs::read_to_string(folder.join("SKILL.md")) else { warnings.push(warn(&folder, "Skipped: SKILL.md is not readable text")); continue };
        let (name, description) = frontmatter(&text);
        if description.is_none() { warnings.push(warn(&folder, "Skipped: SKILL.md has no description in its frontmatter")); continue; }
        let name = name.unwrap_or_else(|| if folder == root { fallback.clone() } else { folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() });
        if !safe_name(&name) { warnings.push(warn(&folder, format!("Skipped: \"{name}\" is not a valid skill name (letters, digits, - _ . only)"))); continue; }
        if staged.iter().any(|(n, _)| *n == name) { warnings.push(warn(&folder, format!("Skipped: another skill in this source is already named \"{name}\""))); continue; }
        let to = staging.join(&name);
        copy_tree(&folder, &to, &mut budget)?;
        staged.push((name, to));
    }
    if staged.is_empty() { return Err(warnings.first().map(|w| w.message.clone()).unwrap_or_else(|| "No valid skills found".into())); }
    let lib = library(data);
    let conflicts: Vec<String> = staged.iter().filter(|(n, _)| lib.join(n).exists()).map(|(n, _)| n.clone()).collect();
    if !conflicts.is_empty() && !replace { return Ok(Installed { conflicts, warnings, ..Default::default() }); }
    fs::create_dir_all(&lib).map_err(|e| e.to_string())?;
    let mut installed = vec![];
    for (name, from) in staged {
        let dest = lib.join(&name);
        if dest.exists() { fs::remove_dir_all(&dest).map_err(|e| e.to_string())?; }
        fs::rename(&from, &dest).or_else(|_| copy_tree(&from, &dest, &mut Budget::default())).map_err(|e| e.to_string())?;
        installed.push(name);
    }
    installed.sort();
    Ok(Installed { installed, conflicts: vec![], warnings })
}

/// Deletes one skill from nucode's library (never from an external source folder).
pub(crate) fn remove(data: &Path, name: &str) -> Result<(), String> {
    if !safe_name(name) { return Err("Not a skill name".into()); }
    let lib = library(data);
    let found = resolve_in(data, None, &SkillsSettings::default()).skills.into_iter().find(|s| s.name == name);
    // The folder is named after the skill, but a hand-placed folder may not be.
    let target = found.map(|s| s.path).filter(|p| fs::canonicalize(&lib).is_ok_and(|l| p.starts_with(l))).unwrap_or_else(|| lib.join(name));
    if !target.is_dir() { return Err(format!("\"{name}\" is not in nucode's skill library")); }
    fs::remove_dir_all(target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SkillSources;

    fn temp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("nu-skills-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn skill(root: &Path, folder: &str, front: &str) -> PathBuf {
        let dir = root.join(folder);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("SKILL.md"), format!("---\n{front}\n---\nBody\n")).unwrap();
        dir
    }
    fn all_on() -> SkillsSettings { SkillsSettings { sources: SkillSources { claude_code: true, codex: true, agents: true }, disabled: vec![] } }
    fn names(r: &Resolution) -> Vec<&str> { r.skills.iter().map(|s| s.name.as_str()).collect() }

    #[test]
    fn frontmatter_reads_plain_quoted_and_folded_values() {
        assert_eq!(frontmatter("---\nname: council\ndescription: Ask the council\n---\n"), (Some("council".into()), Some("Ask the council".into())));
        assert_eq!(frontmatter("---\nname: \"a\"\ndescription: 'it''s'\n---\n").0, Some("a".into()));
        let folded = frontmatter("---\nname: x\ndescription: >\n  first line\n  second line\nlicense: MIT\n---\n");
        assert_eq!(folded.1, Some("first line second line".into()));
        assert_eq!(frontmatter("no frontmatter"), (None, None));
        assert_eq!(frontmatter("---\nname:\ndescription: d\n---\n"), (None, Some("d".into())));
    }
    #[test]
    fn precedence_is_library_then_claude_then_codex_then_agents() {
        let (data, home) = (temp(), temp());
        skill(&library(&data), "dup", "name: dup\ndescription: from library");
        skill(&home.join(".claude/skills"), "dup", "name: dup\ndescription: from claude");
        skill(&home.join(".claude/skills"), "only-claude", "name: only-claude\ndescription: c");
        skill(&home.join(".codex/skills"), "only-claude", "name: only-claude\ndescription: from codex");
        skill(&home.join(".codex/skills"), "shared", "name: shared\ndescription: from codex");
        skill(&home.join(".agents/skills"), "shared", "name: shared\ndescription: from agents");
        let r = resolve_in(&data, Some(&home), &all_on());
        assert_eq!(names(&r), ["dup", "only-claude", "shared"]);
        let by = |n: &str| r.skills.iter().find(|s| s.name == n).unwrap();
        assert_eq!((by("dup").source, by("dup").description.as_str()), ("library", "from library"));
        assert_eq!(by("only-claude").source, "claudeCode");
        assert_eq!(by("shared").source, "codex");
    }
    #[test]
    fn external_sources_are_off_by_default_and_never_leak() {
        let (data, home) = (temp(), temp());
        skill(&home.join(".claude/skills"), "secret", "name: secret\ndescription: private");
        skill(&library(&data), "mine", "name: mine\ndescription: owned");
        let r = resolve_in(&data, Some(&home), &SkillsSettings::default());
        assert_eq!(names(&r), ["mine"]);
    }
    #[test]
    fn disabled_skills_stay_listed_but_are_not_enabled() {
        let data = temp();
        skill(&library(&data), "a", "name: a\ndescription: d");
        skill(&library(&data), "b", "name: b\ndescription: d");
        let r = resolve_in(&data, None, &SkillsSettings { disabled: vec!["a".into()], ..Default::default() });
        assert_eq!(names(&r), ["a", "b"]);
        assert_eq!(r.enabled().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["b"]);
    }
    #[test]
    fn invalid_frontmatter_is_skipped_or_falls_back_with_warnings() {
        let (data, home) = (temp(), temp());
        let root = home.join(".agents/skills");
        skill(&root, "no-description", "name: no-description");
        skill(&root, "folder-name", "description: has no name");
        skill(&root, "bad name", "name: has/slash\ndescription: d");
        fs::create_dir_all(root.join("not-a-skill")).unwrap();
        fs::write(root.join("loose-file.md"), "x").unwrap();
        let r = resolve_in(&data, Some(&home), &all_on());
        assert_eq!(names(&r), ["folder-name"]);
        assert_eq!(r.warnings.len(), 3);
        assert!(r.warnings.iter().any(|w| w.message.contains("no description")));
        assert!(r.warnings.iter().any(|w| w.message.contains("using the folder name")));
        assert!(r.warnings.iter().any(|w| w.message.contains("not a valid skill name")));
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_skill_folders_resolve_and_broken_links_warn() {
        let (data, home, elsewhere) = (temp(), temp(), temp());
        let real = skill(&elsewhere, "linked", "name: linked\ndescription: via symlink");
        let root = home.join(".claude/skills");
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&real, root.join("linked")).unwrap();
        std::os::unix::fs::symlink(elsewhere.join("gone"), root.join("broken")).unwrap();
        let r = resolve_in(&data, Some(&home), &all_on());
        assert_eq!(names(&r), ["linked"]);
        assert_eq!(r.skills[0].path, fs::canonicalize(&real).unwrap());
        assert_eq!(r.warnings.len(), 1);
        assert!(r.warnings[0].path.ends_with("broken"));
    }
    #[test]
    fn codex_system_folder_is_skipped() {
        let (data, home) = (temp(), temp());
        skill(&home.join(".codex/skills/.system"), "bundled", "name: bundled\ndescription: ships with codex");
        skill(&home.join(".codex/skills"), "user", "name: user\ndescription: d");
        assert_eq!(names(&resolve_in(&data, Some(&home), &all_on())), ["user"]);
    }
    #[cfg(unix)]
    #[test]
    fn sync_links_rebuilds_exactly_the_enabled_set() {
        let (data, dir) = (temp(), temp());
        skill(&library(&data), "a", "name: a\ndescription: d");
        skill(&library(&data), "b", "name: b\ndescription: d");
        let r = resolve_in(&data, None, &SkillsSettings::default());
        let target = dir.join("links");
        fs::create_dir_all(target.join("stale")).unwrap();
        sync_links(&target, &r.skills.iter().collect::<Vec<_>>()).unwrap();
        let mut found: Vec<_> = fs::read_dir(&target).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        found.sort();
        assert_eq!(found, ["a", "b"]);
        assert!(target.join("a/SKILL.md").is_file());
        sync_links(&target, &[]).unwrap();
        assert_eq!(fs::read_dir(&target).unwrap().count(), 0);
    }
    fn fixture_repo() -> PathBuf {
        let repo = temp();
        skill(&repo.join("skills"), "council", "name: council\ndescription: Convene the council");
        fs::create_dir_all(repo.join("skills/council/scripts")).unwrap();
        fs::write(repo.join("skills/council/scripts/run.sh"), "echo hi").unwrap();
        skill(&repo.join("skills"), "broken", "name: broken");
        skill(&repo.join("skills"), "second", "name: second\ndescription: Another");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join(".git/config"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc/hosts", repo.join("skills/council/leak")).unwrap();
        repo
    }
    #[test]
    fn install_copies_valid_skills_and_reports_conflicts() {
        let (data, repo) = (temp(), fixture_repo());
        let out = install(&data, repo.to_str().unwrap(), false).unwrap();
        assert_eq!(out.installed, ["council", "second"]);
        assert_eq!(out.warnings.len(), 1);
        let council = library(&data).join("council");
        assert!(council.join("scripts/run.sh").is_file());
        assert!(!council.join("leak").exists() && !fs::symlink_metadata(council.join("leak")).is_ok());
        assert!(!library(&data).join("broken").exists());
        assert_eq!(fs::read_dir(&data).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with(".skills-install")).count(), 0);

        fs::write(repo.join("skills/council/SKILL.md"), "---\nname: council\ndescription: Updated\n---\n").unwrap();
        let again = install(&data, repo.to_str().unwrap(), false).unwrap();
        assert!(again.installed.is_empty());
        assert_eq!(again.conflicts, ["council", "second"]);
        assert!(fs::read_to_string(council.join("SKILL.md")).unwrap().contains("Body"));
        let replaced = install(&data, repo.to_str().unwrap(), true).unwrap();
        assert_eq!(replaced.installed, ["council", "second"]);
        assert!(fs::read_to_string(council.join("SKILL.md")).unwrap().contains("Updated"));

        remove(&data, "council").unwrap();
        assert!(!council.exists());
        assert!(remove(&data, "../escape").is_err());
        assert!(remove(&data, "missing").is_err());
    }
    #[test]
    fn install_accepts_a_single_skill_folder_and_rejects_non_skills() {
        let (data, one, empty) = (temp(), temp(), temp());
        fs::write(one.join("SKILL.md"), "---\ndescription: root skill\n---\n").unwrap();
        let out = install(&data, one.to_str().unwrap(), false).unwrap();
        assert_eq!(out.installed, [one.file_name().unwrap().to_string_lossy().into_owned()]);
        assert!(install(&data, empty.to_str().unwrap(), false).unwrap_err().contains("No skills found"));
        assert!(install(&data, "/definitely/not/here", false).is_err());
        assert!(install(&data, "", false).is_err());
    }
    #[test]
    fn install_enforces_the_size_cap() {
        let (data, repo) = (temp(), temp());
        let dir = skill(&repo, "big", "name: big\ndescription: d");
        for i in 0..(MAX_INSTALL_FILES + 1) { fs::write(dir.join(format!("f{i}")), "").unwrap(); }
        assert!(install(&data, repo.to_str().unwrap(), false).unwrap_err().contains("files"));
        assert!(!library(&data).join("big").exists());
    }
    #[test]
    fn git_urls_parse_and_reject_other_hosts() {
        assert_eq!(parse_git_url("https://github.com/t3dotgg/tstack").unwrap(), ("https://github.com/t3dotgg/tstack.git".into(), None, PathBuf::new(), "tstack".into()));
        let (url, branch, sub, _) = parse_git_url("https://github.com/o/r.git/tree/main/skills/x/").unwrap();
        assert_eq!((url.as_str(), branch.as_deref(), sub), ("https://github.com/o/r.git", Some("main"), PathBuf::from("skills/x")));
        assert!(parse_git_url("https://example.com/o/r").is_err());
        assert!(parse_git_url("https://github.com/o").is_err());
        assert!(parse_git_url("https://github.com/o/r/tree/main/../x").is_err());
        assert!(parse_git_url("https://github.com/-x/r").is_err());
    }
    #[test]
    fn install_clones_with_system_git_from_a_local_repository() {
        if Command::new("git").arg("--version").output().is_err() { return; }
        let (repo, dest) = (fixture_repo(), temp());
        fs::remove_dir_all(repo.join(".git")).unwrap();
        let git = |args: &[&str]| assert!(Command::new("git").args(args).current_dir(&repo).output().unwrap().status.success());
        git(&["init", "-q"]);
        git(&["add", "-A"]);
        git(&["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "x"]);
        clone(repo.to_str().unwrap(), None, &dest.join("checkout")).unwrap();
        let mut found = vec![];
        find_skills(&dest.join("checkout"), 3, &mut found);
        assert_eq!(found.len(), 3);
    }
}
