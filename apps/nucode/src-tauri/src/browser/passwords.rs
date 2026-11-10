use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

pub const PAUSED: &str = "Paused while the user signs in with a saved password. Try again after they finish.";
pub const SENSITIVE: &str = "A password field on this page has a value, so scripts, console and screenshots are blocked until it is submitted or cleared.";
#[cfg(not(target_os = "macos"))]
pub const UNAVAILABLE: &str = "Saved passwords are available on macOS";

pub fn reject_action(p: &serde_json::Value) -> Result<(), String> {
    if p["action"].as_str().is_some_and(|s| s.starts_with("browser_password") || s.starts_with("password")) {
        return Err("Unknown browser action".into());
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    pub origin: String,
    pub username: String,
    pub created_at: u64,
    pub last_used_at: Option<u64>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Index { pub entries: Vec<Entry>, pub never: Vec<String> }

pub fn origin(url: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(url).map_err(|_| "Enter an HTTP(S) URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("Enter an HTTP(S) URL without credentials".into());
    }
    Ok(url.origin().ascii_serialization())
}
pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
impl Index {
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("Cannot read saved password metadata".into()),
        };
        let index: Self = serde_json::from_slice(&bytes).map_err(|_| "Invalid saved password metadata")?;
        for entry in &index.entries {
            uuid::Uuid::parse_str(&entry.id).map_err(|_| "Invalid saved password ID")?;
            if origin(&entry.origin)? != entry.origin { return Err("Invalid saved password origin".into()); }
        }
        for site in &index.never { if origin(site)? != *site { return Err("Invalid never-save origin".into()); } }
        Ok(index)
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("Missing password metadata directory")?;
        fs::create_dir_all(parent).map_err(|_| "Cannot create password metadata directory")?;
        let temp = parent.join(format!(".passwords-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> std::io::Result<()> {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&temp)?;
            file.write_all(&serde_json::to_vec(self)?)?;
            file.sync_all()?;
            fs::rename(&temp, path)?;
            #[cfg(unix)] fs::File::open(parent)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(temp); }
        result.map_err(|_| "Cannot save password metadata".into())
    }
    pub fn matching<'a>(&'a self, site: &'a str) -> impl Iterator<Item = &'a Entry> { self.entries.iter().filter(move |e| e.origin == site) }
    pub fn same(&self, secrets: &dyn Secrets, site: &str, username: &str, password: &str) -> Result<bool, String> {
        for entry in self.matching(site).filter(|e| e.username == username) {
            if secrets.get(&entry.id)?.as_deref() == Some(password) { return Ok(true); }
        }
        Ok(false)
    }
    pub fn block(&mut self, site: String) { if !self.never.contains(&site) { self.never.push(site); } }
    pub fn unblock(&mut self, site: &str) { self.never.retain(|s| s != site); }
    pub fn put(&mut self, secrets: &dyn Secrets, site: &str, username: &str, password: &str) -> Result<(), String> {
        nucode_diag_mcp::writer::remember_secret(password);
        let site = origin(site)?;
        if password.is_empty() || password.len() > 65536 || username.len() > 4096 { return Err("Invalid credential".into()); }
        if let Some(entry) = self.entries.iter().find(|e| e.origin == site && e.username == username) {
            secrets.set(&entry.id, password)?;
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            secrets.set(&id, password)?;
            self.entries.push(Entry { id, origin: site.clone(), username: username.into(), created_at: now(), last_used_at: None });
        }
        self.unblock(&site);
        Ok(())
    }
}

pub trait Secrets: Send + Sync {
    fn get(&self, id: &str) -> Result<Option<String>, String>;
    fn set(&self, id: &str, password: &str) -> Result<(), String>;
    fn delete(&self, id: &str) -> Result<(), String>;
}
#[cfg(target_os = "macos")]
pub struct Keychain;
#[cfg(target_os = "macos")]
fn key(id: &str) -> Result<keyring::Entry, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid saved password ID")?;
    keyring::Entry::new("dev.nucode.browser-passwords", id).map_err(|_| "Cannot access password Keychain".into())
}
#[cfg(target_os = "macos")]
impl Secrets for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match key(id)?.get_password() {
            Ok(password) => { nucode_diag_mcp::writer::remember_secret(&password); Ok(Some(password)) },
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Cannot read password Keychain".into()),
        }
    }
    fn set(&self, id: &str, password: &str) -> Result<(), String> {
        nucode_diag_mcp::writer::remember_secret(password);
        key(id)?.set_password(password).map_err(|_| "Cannot save password to Keychain".into())
    }
    fn delete(&self, id: &str) -> Result<(), String> {
        match key(id)?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(_) => Err("Cannot delete saved password".into()) }
    }
}
pub struct Pending { pub origin: String, pub username: String, pub password: String, pub created: Instant }
impl Pending { pub fn expired(&self) -> bool { self.created.elapsed() >= Duration::from_secs(120) } }

#[cfg(target_os = "macos")]
#[link(name = "LocalAuthentication", kind = "framework")]
extern "C" {}
#[cfg(target_os = "macos")]
pub async fn authenticate(host: &str) -> Result<(), String> {
    use objc2::{msg_send, rc::Retained, runtime::{AnyClass, AnyObject, Bool}};
    use objc2_foundation::{NSError, NSString};
    let (tx, rx) = tokio::sync::oneshot::channel();
    let sender = std::sync::Mutex::new(Some(tx));
    {
        let context: Retained<AnyObject> = unsafe { msg_send![AnyClass::get(c"LAContext").ok_or("Authentication unavailable")?, new] };
        let retained = context.clone();
        let reply = block2::RcBlock::new(move |success: Bool, _error: *mut NSError| {
            let _keep_alive = &retained;
            if let Some(tx) = sender.lock().unwrap().take() { let _ = tx.send(success.as_bool()); }
        });
        unsafe { let _: () = msg_send![&*context, evaluatePolicy: 2isize, localizedReason: &*NSString::from_str(&format!("fill your saved password for {host}")), reply: &*reply]; }
    }
    if rx.await.unwrap_or(false) { Ok(()) } else { Err("Authentication was cancelled".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Memory(std::sync::Mutex<std::collections::HashMap<String, String>>);
    impl Secrets for Memory {
        fn get(&self, id: &str) -> Result<Option<String>, String> { let p = self.0.lock().unwrap().get(id).cloned(); if let Some(p) = &p { nucode_diag_mcp::writer::remember_secret(p); } Ok(p) }
        fn set(&self, id: &str, p: &str) -> Result<(), String> { self.0.lock().unwrap().insert(id.into(), p.into()); Ok(()) }
        fn delete(&self, id: &str) -> Result<(), String> { self.0.lock().unwrap().remove(id); Ok(()) }
    }
    #[test] fn origins_are_exact() {
        assert_eq!(origin("HTTPS://Example.com:443/path?q=1").unwrap(), "https://example.com");
        assert_eq!(origin("http://[::1]:8080/").unwrap(), "http://[::1]:8080");
        for url in ["file:///secret", "javascript:1", "data:text/plain,x", "https://user:pass@example.com", "example.com"] { assert!(origin(url).is_err()); }
        let mut index = Index::default(); let secrets = Memory::default();
        index.put(&secrets, "https://example.com/a", "user", "secret").unwrap();
        for site in ["http://example.com", "https://example.com:8443", "https://sub.example.com"] { assert_eq!(index.matching(site).count(), 0); }
        assert!(index.same(&secrets, "https://example.com", "user", "secret").unwrap());
        assert!(!index.same(&secrets, "https://example.com", "other", "secret").unwrap());
        index.put(&secrets, "https://example.com", "user", "changed").unwrap();
        assert_eq!(index.entries.len(), 1);
        assert!(!index.same(&secrets, "https://example.com", "user", "secret").unwrap());
        index.block("https://example.com".into()); index.block("https://example.com".into()); assert_eq!(index.never.len(), 1);
        index.unblock("https://example.com"); assert!(index.never.is_empty());
    }
    #[test] fn metadata_is_private_and_secret_free() {
        let dir = std::env::temp_dir().join(format!("password-test-{}", uuid::Uuid::new_v4())); let path = dir.join("browser/passwords.json");
        let mut index = Index::default(); index.put(&Memory::default(), "https://example.com", "user", "never-on-disk").unwrap();
        index.save(&path).unwrap(); index.save(&path).unwrap();
        assert_eq!(Index::load(&path).unwrap().entries.len(), 1);
        assert!(!fs::read_to_string(&path).unwrap().contains("never-on-disk"));
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600); }
        assert_eq!(fs::read_dir(dir.join("browser")).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn pending_expires() {
        let p = Pending { origin: "https://example.com".into(), username: "u".into(), password: "secret".into(), created: Instant::now() - Duration::from_secs(120) };
        assert!(p.expired());
    }
}
