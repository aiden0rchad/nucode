//! Copies the current site's sign-in cookies from Chrome-family browsers or Safari. Cookie values, the Keychain
//! password and decrypted bytes never reach the frontend, logs or diagnostics beyond redaction.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::Write,
    net::IpAddr,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

pub const PRIVATE: &str = "Turn off private browsing to import a sign-in.";
pub const SAFARI_ACCESS: &str = "nucode needs Full Disk Access to read Safari's cookies. Turn it on in System Settings → Privacy & Security → Full Disk Access, then try again.";
const SQLITE: &str = "/usr/bin/sqlite3";
/// Seconds between 1601-01-01 and 1970-01-01 (Chrome's epoch).
const CHROME_EPOCH: f64 = 11_644_473_600.;
/// Seconds between 1970-01-01 and 2001-01-01 (Safari's epoch).
const SAFARI_EPOCH: f64 = 978_307_200.;
const MAX_COOKIES: usize = 5000;

/// (id, name, data dir under Application Support, Keychain service, Keychain account)
const CHROMIUM: [(&str, &str, &str, &str, &str); 5] = [
    ("chrome", "Chrome", "Google/Chrome", "Chrome Safe Storage", "Chrome"),
    ("edge", "Edge", "Microsoft Edge", "Microsoft Edge Safe Storage", "Microsoft Edge"),
    ("brave", "Brave", "BraveSoftware/Brave-Browser", "Brave Safe Storage", "Brave"),
    ("arc", "Arc", "Arc/User Data", "Arc Safe Storage", "Arc"),
    ("chromium", "Chromium", "Chromium", "Chromium Safe Storage", "Chromium"),
];

/// A browser profile to import from. `found` counts its unexpired cookies for the current site (None when it could
/// not be checked); `needs_access` marks Safari without Full Disk Access.
#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Source { pub id: String, pub browser: String, pub profile: String, pub label: String, pub found: Option<usize>, pub needs_access: bool }

#[derive(Debug, Clone, PartialEq)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    /// "lax" or "strict" (Foundation has no value for SameSite=None); None leaves it unspecified.
    pub same_site: Option<&'static str>,
    /// Unix seconds; None is a session cookie.
    pub expires: Option<f64>,
}
impl Cookie {
    /// Properties for NSHTTPCookie; Expires is unix seconds and is turned into an NSDate where the cookie is built.
    pub fn properties(&self) -> BTreeMap<String, String> {
        let mut values = BTreeMap::from([
            ("Name".into(), self.name.clone()), ("Value".into(), self.value.clone()),
            ("Domain".into(), self.domain.clone()), ("Path".into(), self.path.clone()),
        ]);
        if self.secure { values.insert("Secure".into(), "TRUE".into()); }
        if self.http_only { values.insert("HttpOnly".into(), "TRUE".into()); }
        if let Some(policy) = self.same_site { values.insert("SameSite".into(), policy.into()); }
        match self.expires { Some(at) => values.insert("Expires".into(), at.to_string()), None => values.insert("Discard".into(), "TRUE".into()) };
        values
    }
}

fn now() -> f64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64() }

// ---- Which cookies ----

/// The tab the import acts on, read from backend tab state: (tab id, host, https).
pub fn target(state: &Value, tab_id: Option<&str>) -> Result<(String, String, bool), String> {
    let active = state["active"].as_str().unwrap_or("");
    let id = tab_id.filter(|id| !id.is_empty()).unwrap_or(active);
    if id != active { return Err("Choose the tab that is on screen".into()); }
    let tab = state["tabs"].as_array().into_iter().flatten().find(|tab| tab["id"] == id).ok_or("No page is open")?;
    let url = url::Url::parse(tab["url"].as_str().unwrap_or("")).map_err(|_| "Open a page first")?;
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let valid = !host.is_empty() && host.len() <= 253 && host.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.');
    match url.scheme() {
        "https" if valid => Ok((id.into(), host, true)),
        "http" if host == "localhost" => Ok((id.into(), host, false)),
        _ => Err("Sign-in import works on https pages (or http://localhost)".into()),
    }
}

/// Cookie domains that could match `host`, for a bound SQL filter: the host, and each dotted parent.
fn candidates(host: &str) -> Vec<String> {
    let mut list = vec![host.to_string(), format!(".{host}")];
    let mut rest = host;
    while let Some((_, parent)) = rest.split_once('.') { list.push(format!(".{parent}")); rest = parent; }
    list
}

/// Whether a cookie for `domain` is sent to `host`: same host, or a dotted parent that is not a public suffix.
pub fn matches(host: &str, domain: &str, secure: bool, https: bool) -> bool {
    if secure && !https { return false; }
    let domain = domain.to_ascii_lowercase();
    let bare = domain.strip_prefix('.').unwrap_or(&domain);
    if bare.is_empty() { return false; }
    let exempt = bare == "localhost" || bare.parse::<IpAddr>().is_ok();
    if !exempt && psl::domain(bare.as_bytes()).is_none() { return false; }
    if domain.starts_with('.') { host == bare || host.ends_with(&domain) } else { host == domain }
}

// ---- Chrome ----

/// Chrome's expires_utc (microseconds since 1601) as unix seconds; None for a session cookie.
pub fn chrome_expiry(expires_utc: i64, has_expires: bool, persistent: bool) -> Option<f64> {
    if !has_expires || !persistent || expires_utc <= 0 { return None; }
    Some(expires_utc as f64 / 1e6 - CHROME_EPOCH)
}
pub fn same_site(chrome: i64) -> Option<&'static str> {
    match chrome { 1 => Some("lax"), 2 => Some("strict"), _ => None }
}

#[derive(Deserialize)]
#[serde(default)]
struct Row {
    host_key: String, name: String, ev: String, value: String, path: String,
    expires_utc: i64, is_secure: i64, is_httponly: i64, samesite: i64, has_expires: i64, is_persistent: i64, version: Option<String>,
}
impl Default for Row {
    fn default() -> Self {
        Self { host_key: String::new(), name: String::new(), ev: String::new(), value: String::new(), path: "/".into(), expires_utc: 0, is_secure: 0, is_httponly: 0, samesite: -1, has_expires: 0, is_persistent: 0, version: None }
    }
}

fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) { return None; }
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok()).collect()
}

mod crypto {
    use std::os::raw::{c_char, c_void};
    extern "C" {
        fn CCKeyDerivationPBKDF(algorithm: u32, password: *const c_char, password_len: usize, salt: *const u8, salt_len: usize, prf: u32, rounds: u32, derived: *mut u8, derived_len: usize) -> i32;
        fn CCCrypt(op: u32, alg: u32, options: u32, key: *const c_void, key_len: usize, iv: *const c_void, data_in: *const c_void, data_in_len: usize, data_out: *mut c_void, out_available: usize, out_moved: *mut usize) -> i32;
    }
    const PBKDF2: u32 = 2;
    const HMAC_SHA1: u32 = 1;
    const AES: u32 = 0;
    const PKCS7: u32 = 1;
    /// Chrome's macOS key: PBKDF2-HMAC-SHA1(password, "saltysalt", 1003 rounds), 16 bytes.
    pub fn key(password: &str) -> Option<[u8; 16]> {
        let mut out = [0u8; 16];
        let salt = b"saltysalt";
        let status = unsafe { CCKeyDerivationPBKDF(PBKDF2, password.as_ptr() as *const c_char, password.len(), salt.as_ptr(), salt.len(), HMAC_SHA1, 1003, out.as_mut_ptr(), out.len()) };
        (status == 0).then_some(out)
    }
    fn run(op: u32, key: &[u8; 16], data: &[u8]) -> Option<Vec<u8>> {
        let iv = [0x20u8; 16];
        let mut out = vec![0u8; data.len() + 16];
        let mut moved = 0usize;
        let status = unsafe { CCCrypt(op, AES, PKCS7, key.as_ptr() as *const c_void, key.len(), iv.as_ptr() as *const c_void, data.as_ptr() as *const c_void, data.len(), out.as_mut_ptr() as *mut c_void, out.len(), &mut moved) };
        if status != 0 { return None; }
        out.truncate(moved);
        Some(out)
    }
    pub fn decrypt(key: &[u8; 16], data: &[u8]) -> Option<Vec<u8>> { run(1, key, data) }
    #[cfg(test)]
    pub fn encrypt(key: &[u8; 16], data: &[u8]) -> Option<Vec<u8>> { run(0, key, data) }
}

/// One Chrome cookie row as a plain cookie for `host`, or None when it is unreadable, mismatched, expired or not for this host.
fn chrome_cookie(row: &Row, key: &[u8; 16], schema: u32, host: &str, https: bool, at: f64) -> Option<Cookie> {
    if !matches(host, &row.host_key, row.is_secure != 0, https) { return None; }
    let expires = chrome_expiry(row.expires_utc, row.has_expires != 0, row.is_persistent != 0);
    if expires.is_some_and(|expires| expires <= at) { return None; }
    let value = if row.ev.is_empty() { row.value.clone() } else {
        let data = unhex(&row.ev)?;
        let data = data.strip_prefix(b"v10")?;
        let mut plain = crypto::decrypt(key, data)?;
        if schema >= 24 {
            if plain.len() < 32 || plain[..32] != Sha256::digest(row.host_key.as_bytes())[..] { return None; }
            plain.drain(..32);
        }
        String::from_utf8(plain).ok()?
    };
    nucode_diag_mcp::writer::remember_secret(&value);
    Some(Cookie { name: row.name.clone(), value, domain: row.host_key.clone(), path: if row.path.is_empty() { "/".into() } else { row.path.clone() },
        secure: row.is_secure != 0, http_only: row.is_httponly != 0, same_site: same_site(row.samesite), expires })
}

/// Removes the private temp directory holding a copy of the browser's cookie database, on every path.
struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Result<Self, String> {
        use std::os::unix::fs::DirBuilderExt;
        let path = std::env::temp_dir().join(format!("nucode-import-{}", uuid::Uuid::new_v4()));
        std::fs::DirBuilder::new().mode(0o700).create(&path).map_err(|_| "Could not prepare the import")?;
        Ok(Self(path))
    }
}
impl Drop for Scratch { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

/// Reads this host's rows through the system sqlite3 on a private copy of the database and its write-ahead log
/// (the copy includes recent writes that a read of the locked original would miss). The host reaches sqlite only as
/// bound parameters, and only matching rows leave it.
fn query(db: &Path, host: &str) -> Result<Vec<Row>, String> {
    let scratch = Scratch::new()?;
    let unreadable = |_| "Could not read the browser's cookies".to_string();
    let copy = scratch.0.join("Cookies");
    std::fs::copy(db, &copy).map_err(unreadable)?;
    let mut wal = db.as_os_str().to_owned();
    wal.push("-wal");
    if Path::new(&wal).exists() { std::fs::copy(&wal, scratch.0.join("Cookies-wal")).map_err(unreadable)?; }
    let names: Vec<_> = candidates(host);
    let mut script = String::new();
    for (i, name) in names.iter().enumerate() {
        // Host names are validated to letters, digits, '-' and '.', so they cannot end the quoted literal.
        if !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.') { return Err("Invalid host".into()); }
        script += &format!(".parameter set :h{i} '{name}'\n");
    }
    let list = (0..names.len()).map(|i| format!(":h{i}")).collect::<Vec<_>>().join(",");
    script += &format!("SELECT host_key, name, hex(encrypted_value) AS ev, value, path, expires_utc, is_secure, is_httponly, samesite, has_expires, is_persistent, (SELECT value FROM meta WHERE key='version') AS version FROM cookies WHERE host_key IN ({list}) LIMIT {MAX_COOKIES};\n");
    let mut child = Command::new(SQLITE).arg("-readonly").arg("-json").arg(&copy)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_| "Could not read the browser's cookies")?;
    child.stdin.take().ok_or("Could not read the browser's cookies")?.write_all(script.as_bytes()).map_err(|_| "Could not read the browser's cookies")?;
    let output = child.wait_with_output().map_err(|_| "Could not read the browser's cookies")?;
    if !output.status.success() { return Err("Could not read the browser's cookies".into()); }
    if output.stdout.iter().all(u8::is_ascii_whitespace) { return Ok(vec![]); }
    serde_json::from_slice(&output.stdout).map_err(|_| "Could not read the browser's cookies".into())
}

fn chrome_db(profile: &Path) -> Option<PathBuf> {
    ["Network/Cookies", "Cookies"].iter().map(|name| profile.join(name)).find(|path| path.is_file())
}

/// Profile directories (`Default`, `Profile N`) that hold cookies, with their display names from Local State.
pub fn profiles(data: &Path) -> Vec<(String, String)> {
    let names: Value = std::fs::read(data.join("Local State")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or(Value::Null);
    let mut found: Vec<_> = std::fs::read_dir(data).into_iter().flatten().flatten().filter_map(|entry| {
        let dir = entry.file_name().to_str()?.to_string();
        let ok = dir == "Default" || dir.strip_prefix("Profile ").is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()));
        if !ok || chrome_db(&entry.path()).is_none() { return None; }
        let name = names["profile"]["info_cache"][&dir]["name"].as_str().filter(|name| !name.trim().is_empty()).unwrap_or(&dir).to_string();
        Some((dir, name))
    }).collect();
    found.sort();
    found
}

fn support() -> Option<PathBuf> { Some(PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support")) }
fn safari_installed() -> bool { ["/Applications/Safari.app", "/System/Cryptexes/App/System/Applications/Safari.app"].iter().any(|path| Path::new(path).exists()) }

pub fn sources_in(support: &Path, safari: bool) -> Vec<Source> {
    let mut list = vec![];
    for (id, browser, dir, _, _) in CHROMIUM {
        for (profile, name) in profiles(&support.join(dir)) {
            list.push(Source { id: format!("{id}:{profile}"), browser: browser.into(), label: format!("{browser} — {name}"), profile: name, ..Default::default() });
        }
    }
    if safari { list.push(Source { id: "safari".into(), browser: "Safari".into(), label: "Safari".into(), ..Default::default() }); }
    list
}
/// Installed browsers and their profiles, each marked with how many cookies it holds for `host` (counted from cookie
/// metadata and Safari's file; no Keychain access, no values kept). Sources with a sign-in come first.
pub fn sources_for(host: &str, https: bool) -> Vec<Source> {
    let Some(support) = support() else { return vec![] };
    let mut list = sources_in(&support, safari_installed());
    for source in &mut list {
        if source.id == "safari" {
            match support.parent().and_then(Path::parent).map(|home| safari_import(home, host, https)) {
                Some(Ok(cookies)) => source.found = Some(cookies.len()),
                Some(Err(error)) => source.needs_access = error == SAFARI_ACCESS,
                None => {}
            }
        } else if let Some((browser, profile)) = source.id.split_once(':') {
            source.found = chrome_rows(&support, browser, profile, host, https).ok().map(|rows| rows.len());
        }
    }
    list.sort_by_key(|source| !source.found.is_some_and(|n| n > 0));
    list
}

/// A profile's unexpired rows for `host`, still encrypted.
fn chrome_rows(support: &Path, browser: &str, profile: &str, host: &str, https: bool) -> Result<Vec<Row>, String> {
    let (_, _, dir, _, _) = *CHROMIUM.iter().find(|entry| entry.0 == browser).ok_or("Unknown browser")?;
    let data = support.join(dir);
    if !profiles(&data).iter().any(|(name, _)| name == profile) { return Err("That browser profile is no longer available".into()); }
    let db = chrome_db(&data.join(profile)).ok_or("That browser profile has no cookies")?;
    let at = now();
    Ok(query(&db, host)?.into_iter().filter(|row| matches(host, &row.host_key, row.is_secure != 0, https)
        && !chrome_expiry(row.expires_utc, row.has_expires != 0, row.is_persistent != 0).is_some_and(|expires| expires <= at)).collect())
}

fn chrome_import(support: &Path, browser: &str, profile: &str, host: &str, https: bool, password: impl FnOnce(&str, &str) -> Result<String, String>) -> Result<Vec<Cookie>, String> {
    let (_, _, _, service, account) = *CHROMIUM.iter().find(|entry| entry.0 == browser).ok_or("Unknown browser")?;
    let rows = chrome_rows(support, browser, profile, host, https)?;
    // Nothing for this host: do not ask the Keychain for the browser's key.
    if rows.is_empty() { return Ok(vec![]); }
    let password = password(service, account)?;
    nucode_diag_mcp::writer::remember_secret(&password);
    let key = crypto::key(&password).ok_or("Could not read the browser's cookies")?;
    let at = now();
    Ok(rows.iter().filter_map(|row| chrome_cookie(row, &key, row.version.as_deref().and_then(|v| v.parse().ok()).unwrap_or(0), host, https, at)).collect())
}

fn keychain(service: &str, account: &str) -> Result<String, String> {
    keyring::Entry::new(service, account).and_then(|entry| entry.get_password())
        .map_err(|error| match error { keyring::Error::NoEntry => "Could not find that browser's saved key in your Keychain".into(), _ => "Keychain access was not allowed".to_string() })
}

// ---- Safari ----

fn rd32(data: &[u8], at: usize, big: bool) -> Result<u32, String> {
    let bytes: [u8; 4] = data.get(at..at.checked_add(4).ok_or("Safari's cookies are malformed")?).and_then(|b| b.try_into().ok()).ok_or("Safari's cookies are malformed")?;
    Ok(if big { u32::from_be_bytes(bytes) } else { u32::from_le_bytes(bytes) })
}
fn rdf64(data: &[u8], at: usize) -> Result<f64, String> {
    let bytes: [u8; 8] = data.get(at..at.checked_add(8).ok_or("Safari's cookies are malformed")?).and_then(|b| b.try_into().ok()).ok_or("Safari's cookies are malformed")?;
    Ok(f64::from_le_bytes(bytes))
}
fn cstr(data: &[u8], at: usize) -> Result<String, String> {
    let rest = data.get(at..).ok_or("Safari's cookies are malformed")?;
    let end = rest.iter().position(|&b| b == 0).ok_or("Safari's cookies are malformed")?;
    String::from_utf8(rest[..end].to_vec()).map_err(|_| "Safari's cookies are malformed".into())
}

/// Parses Cookies.binarycookies, keeping only cookies that `keep` accepts (by domain and secure flag) so nothing else
/// is held. Every offset is bounds-checked; malformed input is an error.
pub fn parse_binarycookies(data: &[u8], at: f64, keep: impl Fn(&str, bool) -> bool) -> Result<Vec<Cookie>, String> {
    const BAD: &str = "Safari's cookies are malformed";
    if data.get(..4) != Some(b"cook") { return Err(BAD.into()); }
    let pages = rd32(data, 4, true)? as usize;
    if pages > 100_000 { return Err(BAD.into()); }
    let mut start = 8usize.checked_add(pages * 4).ok_or(BAD)?;
    let mut found = vec![];
    for page in 0..pages {
        let size = rd32(data, 8 + page * 4, true)? as usize;
        let end = start.checked_add(size).filter(|end| *end <= data.len()).ok_or(BAD)?;
        let body = &data[start..end];
        start = end;
        // Each page starts with the tag bytes 00 00 01 00; counts and offsets after it are little-endian.
        if body.get(..4) != Some(&[0, 0, 1, 0]) { return Err(BAD.into()); }
        let count = rd32(body, 4, false)? as usize;
        if count > body.len() / 4 { return Err(BAD.into()); }
        for index in 0..count {
            let offset = rd32(body, 8 + index * 4, false)? as usize;
            let cookie = body.get(offset..).ok_or(BAD)?;
            let size = rd32(cookie, 0, false)? as usize;
            let cookie = cookie.get(..size).ok_or(BAD)?;
            if size < 56 { return Err(BAD.into()); }
            let flags = rd32(cookie, 8, false)?;
            let (domain, name, path, value) = (rd32(cookie, 16, false)? as usize, rd32(cookie, 20, false)? as usize, rd32(cookie, 24, false)? as usize, rd32(cookie, 28, false)? as usize);
            let domain = cstr(cookie, domain)?;
            let secure = flags & 1 != 0;
            if !keep(&domain, secure) { continue; }
            let expiry = rdf64(cookie, 40)?;
            if !expiry.is_finite() { return Err(BAD.into()); }
            let expires = expiry + SAFARI_EPOCH;
            if expires <= at { continue; }
            let value = cstr(cookie, value)?;
            nucode_diag_mcp::writer::remember_secret(&value);
            found.push(Cookie { name: cstr(cookie, name)?, value, domain, path: cstr(cookie, path)?, secure, http_only: flags & 4 != 0, same_site: None, expires: Some(expires) });
            if found.len() > MAX_COOKIES { return Err(BAD.into()); }
        }
    }
    Ok(found)
}

/// Safari's cookie files: the default profile's, then each other profile's website data store.
fn safari_files(home: &Path) -> Result<Vec<PathBuf>, String> {
    let data = home.join("Library/Containers/com.apple.Safari/Data/Library");
    let mut paths = vec![data.join("Cookies/Cookies.binarycookies"), home.join("Library/Cookies/Cookies.binarycookies")];
    for stores in [data.join("WebKit/WebsiteDataStore"), data.join("WebKit/com.apple.Safari/WebsiteDataStore")] {
        match std::fs::read_dir(&stores) {
            Ok(entries) => paths.extend(entries.flatten().map(|entry| entry.path().join("Cookies/Cookies.binarycookies"))),
            Err(error) if denied(&error) => return Err(SAFARI_ACCESS.into()),
            Err(_) => {}
        }
    }
    Ok(paths)
}
fn denied(error: &std::io::Error) -> bool { error.kind() == std::io::ErrorKind::PermissionDenied || error.raw_os_error() == Some(1) }

/// This host's cookies from every Safari profile; where profiles disagree, the one that expires last wins. A file
/// that does not parse is skipped while another one does.
fn safari_import(home: &Path, host: &str, https: bool) -> Result<Vec<Cookie>, String> {
    let mut found: BTreeMap<(String, String, String), Cookie> = BTreeMap::new();
    let (mut parsed, mut failure) = (false, None);
    for path in safari_files(home)? {
        let data = match std::fs::read(&path) { Ok(data) => data, Err(error) if denied(&error) => return Err(SAFARI_ACCESS.into()), Err(_) => continue };
        let cookies = match parse_binarycookies(&data, now(), |domain, secure| matches(host, domain, secure, https)) { Ok(cookies) => cookies, Err(error) => { failure = Some(error); continue } };
        parsed = true;
        for cookie in cookies {
            let key = (cookie.domain.clone(), cookie.name.clone(), cookie.path.clone());
            if found.get(&key).is_none_or(|old| old.expires < cookie.expires) { found.insert(key, cookie); }
        }
    }
    if !parsed { return Err(failure.unwrap_or_else(|| "Could not find Safari's cookies".into())); }
    Ok(found.into_values().collect())
}

/// Reads the cookies a browser source holds for `host`, and the label to show for it.
pub fn read(source: &str, host: &str, https: bool) -> Result<(Vec<Cookie>, String), String> {
    let support = support().ok_or("Could not find your home folder")?;
    let label = sources_in(&support, safari_installed()).into_iter().find(|entry| entry.id == source).ok_or("That browser is no longer available")?.label;
    let cookies = if source == "safari" {
        safari_import(support.parent().and_then(Path::parent).ok_or("Could not find your home folder")?, host, https)?
    } else {
        let (browser, profile) = source.split_once(':').ok_or("Unknown browser")?;
        chrome_import(&support, browser, profile, host, https, keychain)?
    };
    Ok((cookies, label))
}

/// Refuses the import in private browsing, whose tabs do not use the store imported cookies are written to.
pub fn check_private(private: bool) -> Result<(), String> {
    if private { Err(PRIVATE.into()) } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn host_matching() {
        assert!(matches("www.example.test", "www.example.test", false, true));
        assert!(matches("www.example.test", ".example.test", false, true));
        assert!(matches("example.test", ".example.test", false, true));
        assert!(!matches("example.test", "www.example.test", false, true), "a host-only cookie of a subdomain");
        assert!(!matches("example.test", "example.test.evil.test", false, true));
        assert!(!matches("notexample.test", ".example.test", false, true));
        assert!(!matches("example.test", ".other.test", false, true), "another site");
        assert!(!matches("example.test", ".test", false, true), "a public suffix");
        assert!(!matches("a.example.co.uk", ".co.uk", false, true), "a public suffix");
        assert!(matches("a.example.co.uk", ".example.co.uk", false, true));
        assert!(!matches("example.test", "", false, true));
        assert!(!matches("localhost", ".", false, true));
    }
    #[test]
    fn secure_cookies_need_https() {
        assert!(matches("localhost", "localhost", false, false));
        assert!(!matches("localhost", "localhost", true, false), "secure-only on http localhost");
        assert!(matches("localhost", "localhost", true, true));
        assert!(matches("example.test", ".example.test", true, true));
    }
    #[test]
    fn target_comes_from_backend_tab_state() {
        let state = json!({"active":"a","tabs":[{"id":"a","url":"https://Sub.Example.test/path?q=1"},{"id":"b","url":"https://other.test/"},{"id":"c","url":"http://localhost:3000/"},{"id":"d","url":"http://example.test/"},{"id":"e","url":"about:blank"}]});
        assert_eq!(target(&state, None).unwrap(), ("a".into(), "sub.example.test".into(), true));
        assert_eq!(target(&state, Some("a")).unwrap().1, "sub.example.test");
        assert!(target(&state, Some("b")).is_err(), "a tab that is not on screen");
        let mut local = state.clone(); local["active"] = json!("c");
        assert_eq!(target(&local, None).unwrap(), ("c".into(), "localhost".into(), false));
        for id in ["d", "e", "missing"] {
            let mut state = state.clone(); state["active"] = json!(id);
            assert!(target(&state, None).is_err(), "{id}");
        }
        assert!(target(&json!({}), None).is_err());
    }
    #[test]
    fn candidates_cover_host_and_parents() {
        assert_eq!(candidates("a.b.test"), ["a.b.test", ".a.b.test", ".b.test", ".test"]);
    }
    #[test]
    fn private_browsing_is_refused() {
        assert_eq!(check_private(true).unwrap_err(), "Turn off private browsing to import a sign-in.");
        assert!(check_private(false).is_ok());
    }
    #[test]
    fn chrome_time_and_expiry() {
        // 2030-01-01T00:00:00Z
        let unix = 1_893_456_000i64;
        let utc = (unix * 1_000_000) + (11_644_473_600i64 * 1_000_000);
        assert_eq!(chrome_expiry(utc, true, true), Some(unix as f64));
        assert_eq!(chrome_expiry(utc, false, true), None);
        assert_eq!(chrome_expiry(utc, true, false), None);
        assert_eq!(chrome_expiry(0, true, true), None);
    }
    #[test]
    fn samesite_mapping() {
        assert_eq!([same_site(-1), same_site(0), same_site(1), same_site(2), same_site(9)], [None, None, Some("lax"), Some("strict"), None]);
    }
    #[test]
    fn profiles_use_display_names_and_only_existing_ones() {
        let dir = std::env::temp_dir().join(format!("nucode-profiles-test-{}", uuid::Uuid::new_v4()));
        for profile in ["Default", "Profile 1", "Profile 2", "Profile x", "Guest Profile"] { std::fs::create_dir_all(dir.join(profile).join("Network")).unwrap(); }
        std::fs::write(dir.join("Default/Network/Cookies"), b"").unwrap();
        std::fs::write(dir.join("Profile 1/Cookies"), b"").unwrap();
        std::fs::write(dir.join("Profile x/Cookies"), b"").unwrap();
        std::fs::write(dir.join("Local State"), json!({"profile":{"info_cache":{"Default":{"name":"Personal"},"Profile 1":{"name":" "}}}}).to_string()).unwrap();
        assert_eq!(profiles(&dir), [("Default".to_string(), "Personal".to_string()), ("Profile 1".to_string(), "Profile 1".to_string())]);
        let all = sources_in(&dir.parent().unwrap().join("nope"), true);
        assert_eq!(all, [Source { id: "safari".into(), browser: "Safari".into(), label: "Safari".into(), ..Default::default() }]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
    #[test]
    fn sources_list_labels() {
        let base = std::env::temp_dir().join(format!("nucode-sources-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(base.join("Google/Chrome/Default")).unwrap();
        std::fs::write(base.join("Google/Chrome/Default/Cookies"), b"").unwrap();
        std::fs::write(base.join("Google/Chrome/Local State"), json!({"profile":{"info_cache":{"Default":{"name":"Personal"}}}}).to_string()).unwrap();
        let list = sources_in(&base, false);
        assert_eq!(list, [Source { id: "chrome:Default".into(), browser: "Chrome".into(), profile: "Personal".into(), label: "Chrome — Personal".into(), ..Default::default() }]);
        std::fs::remove_dir_all(&base).unwrap();
    }

    mod chrome {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        fn row(host: &str, plain: &[u8], key: &[u8; 16], schema: u32) -> Row {
            let mut data = vec![];
            if schema >= 24 { data.extend_from_slice(&Sha256::digest(host.as_bytes())); }
            data.extend_from_slice(plain);
            let mut ev = b"v10".to_vec();
            ev.extend(crypto::encrypt(key, &data).unwrap());
            let ev = ev.iter().map(|b| format!("{b:02X}")).collect();
            Row { host_key: host.into(), name: "session".into(), ev, ..Row::default() }
        }
        #[test]
        fn v10_round_trip_with_and_without_host_hash() {
            let key = crypto::key("synthetic-password").unwrap();
            assert_ne!(key, crypto::key("another-password").unwrap());
            for schema in [23, 24] {
                let cookie = chrome_cookie(&row(".example.test", b"synthetic-value", &key, schema), &key, schema, "www.example.test", true, 0.).unwrap();
                assert_eq!((cookie.value.as_str(), cookie.domain.as_str(), cookie.expires), ("synthetic-value", ".example.test", None));
            }
        }
        #[test]
        fn mismatched_hash_wrong_key_and_unknown_prefix_are_skipped() {
            let key = crypto::key("synthetic-password").unwrap();
            // Encrypted for another host: the embedded hash does not match this row's host_key.
            let mut wrong_host = row(".example.test", b"v", &key, 24);
            wrong_host.host_key = ".other.test".into();
            assert!(chrome_cookie(&wrong_host, &key, 24, "other.test", true, 0.).is_none());
            // Schema 24 with a payload that has no hash prefix.
            assert!(chrome_cookie(&row(".example.test", b"short", &key, 23), &key, 24, "example.test", true, 0.).is_none());
            let mut other = row(".example.test", b"v", &key, 23);
            other.ev = other.ev.replacen("763130", "763131", 1);
            assert!(chrome_cookie(&other, &key, 23, "example.test", true, 0.).is_none(), "unknown prefix");
            assert!(chrome_cookie(&row(".example.test", b"v", &key, 23), &crypto::key("x").unwrap(), 23, "example.test", true, 0.).is_none(), "wrong key");
            let mut bad = row(".example.test", b"v", &key, 23); bad.ev = "ZZ".into();
            assert!(chrome_cookie(&bad, &key, 23, "example.test", true, 0.).is_none());
        }
        #[test]
        fn plain_values_other_sites_and_expired_cookies() {
            let key = crypto::key("synthetic-password").unwrap();
            let plain = Row { host_key: "example.test".into(), name: "n".into(), value: "plain".into(), ..Row::default() };
            assert_eq!(chrome_cookie(&plain, &key, 24, "example.test", true, 0.).unwrap().value, "plain");
            assert!(chrome_cookie(&plain, &key, 24, "other.test", true, 0.).is_none());
            let utc = (1_000i64 + 11_644_473_600) * 1_000_000;
            let expiring = Row { has_expires: 1, is_persistent: 1, expires_utc: utc, ..Row { host_key: "example.test".into(), value: "x".into(), ..Row::default() } };
            assert_eq!(chrome_cookie(&expiring, &key, 24, "example.test", true, 999.).unwrap().expires, Some(1000.));
            assert!(chrome_cookie(&expiring, &key, 24, "example.test", true, 1000.).is_none(), "expired");
        }
        #[test]
        fn reads_a_synthetic_database_through_sqlite() {
            let key_password = "synthetic-password";
            let key = crypto::key(key_password).unwrap();
            let base = std::env::temp_dir().join(format!("nucode-chrome-test-{}", uuid::Uuid::new_v4()));
            let profile = base.join("Google/Chrome/Default/Network");
            std::fs::create_dir_all(&profile).unwrap();
            std::fs::write(base.join("Google/Chrome/Local State"), "{}").unwrap();
            let mut encrypted = b"v10".to_vec();
            let mut data = Sha256::digest(b".example.test").to_vec();
            data.extend_from_slice(b"synthetic-value");
            encrypted.extend(crypto::encrypt(&key, &data).unwrap());
            let hex: String = encrypted.iter().map(|b| format!("{b:02X}")).collect();
            let sql = format!("PRAGMA journal_mode=WAL; CREATE TABLE meta(key TEXT, value TEXT); INSERT INTO meta VALUES('version','24');
                CREATE TABLE cookies(host_key TEXT, name TEXT, encrypted_value BLOB, value TEXT, path TEXT, expires_utc INT, is_secure INT, is_httponly INT, samesite INT, has_expires INT, is_persistent INT);
                INSERT INTO cookies VALUES('.example.test','session',x'{hex}','','/',0,1,1,1,0,0);
                INSERT INTO cookies VALUES('other.test','other',x'','nope','/',0,0,0,-1,0,0);");
            let status = Command::new(SQLITE).arg(profile.join("Cookies")).arg(&sql).stdout(Stdio::null()).status().unwrap();
            assert!(status.success());
            let (cookies, _) = (chrome_import(&base, "chrome", "Default", "www.example.test", true, |service, account| {
                assert_eq!((service, account), ("Chrome Safe Storage", "Chrome"));
                Ok(key_password.into())
            }).unwrap(), ());
            assert_eq!(cookies.len(), 1);
            assert_eq!((cookies[0].name.as_str(), cookies[0].value.as_str(), cookies[0].same_site, cookies[0].secure, cookies[0].http_only), ("session", "synthetic-value", Some("lax"), true, true));
            // Counting for the source list reads metadata only.
            assert_eq!(chrome_rows(&base, "chrome", "Default", "www.example.test", true).unwrap().len(), 1);
            assert_eq!(chrome_rows(&base, "chrome", "Default", "www.example.test", false).unwrap().len(), 0, "secure cookie, http host");
            // Nothing for this host: no Keychain access at all.
            assert!(chrome_import(&base, "chrome", "Default", "nothing.test", true, |_, _| panic!("asked the Keychain")).unwrap().is_empty());
            assert!(chrome_import(&base, "chrome", "../Default", "example.test", true, |_, _| Ok(String::new())).is_err());
            assert!(chrome_import(&base, "unknown", "Default", "example.test", true, |_, _| Ok(String::new())).is_err());
            let scratch = Scratch::new().unwrap();
            let path = scratch.0.clone();
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o700);
            drop(scratch);
            assert!(!path.exists(), "the private copy is removed");
            std::fs::remove_dir_all(&base).unwrap();
        }
    }

    fn page(cookies: &[(&str, &str, &str, &str, u32, f64)]) -> Vec<u8> {
        let mut bodies: Vec<Vec<u8>> = vec![];
        for (domain, name, path, value, flags, expiry) in cookies {
            let strings = [domain, name, path, value];
            let mut offsets = [0u32; 4];
            let mut tail = vec![];
            for (i, text) in strings.iter().enumerate() { offsets[i] = 56 + tail.len() as u32; tail.extend_from_slice(text.as_bytes()); tail.push(0); }
            let size = 56 + tail.len() as u32;
            let mut c = vec![];
            for v in [size, 0, *flags, 0, offsets[0], offsets[1], offsets[2], offsets[3]] { c.extend_from_slice(&v.to_le_bytes()); }
            c.extend_from_slice(&[0u8; 8]);
            c.extend_from_slice(&expiry.to_le_bytes());
            c.extend_from_slice(&0f64.to_le_bytes());
            c.extend(tail);
            bodies.push(c);
        }
        let mut page = vec![];
        page.extend_from_slice(&[0, 0, 1, 0]);
        page.extend_from_slice(&(bodies.len() as u32).to_le_bytes());
        let mut offset = 8 + bodies.len() as u32 * 4 + 4;
        for body in &bodies { page.extend_from_slice(&offset.to_le_bytes()); offset += body.len() as u32; }
        page.extend_from_slice(&0u32.to_le_bytes());
        for body in bodies { page.extend(body); }
        page
    }
    fn file(pages: &[Vec<u8>]) -> Vec<u8> {
        let mut data = b"cook".to_vec();
        data.extend_from_slice(&(pages.len() as u32).to_be_bytes());
        for page in pages { data.extend_from_slice(&(page.len() as u32).to_be_bytes()); }
        for page in pages { data.extend_from_slice(page); }
        data
    }
    #[test]
    fn binarycookies_parse_filter_and_expiry() {
        let future = 4_000_000_000. - SAFARI_EPOCH;
        let data = file(&[page(&[(".example.test", "sid", "/", "synthetic", 5, future), ("other.test", "o", "/", "x", 0, future), (".example.test", "old", "/", "x", 1, 1.)]), page(&[("www.example.test", "second", "/a", "y", 1, future)])]);
        let all = parse_binarycookies(&data, 2_000_000_000., |_, _| true).unwrap();
        assert_eq!(all.len(), 3, "the expired cookie is skipped");
        let mine = parse_binarycookies(&data, 2_000_000_000., |domain, secure| matches("www.example.test", domain, secure, true)).unwrap();
        assert_eq!(mine.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["sid", "second"]);
        assert_eq!((mine[0].value.as_str(), mine[0].path.as_str(), mine[0].secure, mine[0].http_only, mine[0].same_site, mine[0].expires), ("synthetic", "/", true, true, None, Some(4_000_000_000.)));
        assert_eq!((mine[1].secure, mine[1].http_only, mine[1].path.as_str()), (true, false, "/a"));
        assert_eq!(parse_binarycookies(&data, 2_000_000_000., |_, secure| !secure).unwrap().len(), 1);
    }
    #[test]
    fn malformed_binarycookies_are_errors_never_panics() {
        let future = 1e9;
        let good = file(&[page(&[(".example.test", "sid", "/", "v", 0, future)])]);
        assert!(parse_binarycookies(&good, 0., |_, _| true).is_ok());
        for cut in 0..good.len() { assert!(parse_binarycookies(&good[..cut], 0., |_, _| true).is_err(), "truncated at {cut}"); }
        assert!(parse_binarycookies(b"", 0., |_, _| true).is_err());
        assert!(parse_binarycookies(b"nope1234", 0., |_, _| true).is_err());
        // Every single-byte corruption must return, not panic.
        for at in 0..good.len() { for byte in [0u8, 0xff, 0x7f] { let mut bad = good.clone(); bad[at] = byte; let _ = parse_binarycookies(&bad, 0., |_, _| true); } }
        // A huge page count and a cookie offset past the page.
        let mut huge = b"cook".to_vec(); huge.extend_from_slice(&u32::MAX.to_be_bytes());
        assert!(parse_binarycookies(&huge, 0., |_, _| true).is_err());
        let mut far = good.clone();
        let offset_at = 8 + 4 + 8;
        far[offset_at..offset_at + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(parse_binarycookies(&far, 0., |_, _| true).is_err());
        // An unterminated string.
        let mut open = good.clone(); let n = open.len(); open[n - 1] = b'x';
        assert!(parse_binarycookies(&open, 0., |_, _| true).is_err());
    }
    #[test]
    fn safari_permission_error_explains_full_disk_access() {
        assert!(SAFARI_ACCESS.contains("Full Disk Access"));
        let home = std::env::temp_dir().join(format!("nucode-safari-test-{}", uuid::Uuid::new_v4()));
        let path = home.join("Library/Cookies");
        std::fs::create_dir_all(&path).unwrap();
        assert_eq!(safari_import(&home, "example.test", true).unwrap_err(), "Could not find Safari's cookies");
        let data = file(&[page(&[(".example.test", "sid", "/", "v", 1, 4e9 - SAFARI_EPOCH)])]);
        std::fs::write(path.join("Cookies.binarycookies"), data).unwrap();
        assert_eq!(safari_import(&home, "example.test", true).unwrap().len(), 1);
        assert!(safari_import(&home, "example.test", false).unwrap().is_empty(), "secure cookie, http host");
        // Another Safari profile: its cookies are added, and a duplicate keeps the later expiry.
        let store = home.join("Library/Containers/com.apple.Safari/Data/Library/WebKit/WebsiteDataStore/ABC/Cookies");
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(store.join("Cookies.binarycookies"), file(&[page(&[(".example.test", "sid", "/", "w", 1, 4.1e9 - SAFARI_EPOCH), ("example.test", "pref", "/", "x", 0, 4e9 - SAFARI_EPOCH)])])).unwrap();
        std::fs::create_dir_all(store.join("../../BAD/Cookies")).unwrap();
        std::fs::write(store.join("../../BAD/Cookies/Cookies.binarycookies"), b"cook\0\0\0\x01junk").unwrap();
        let mut both = safari_import(&home, "example.test", true).unwrap();
        both.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(both.iter().map(|c| (c.name.as_str(), c.value.as_str())).collect::<Vec<_>>(), [("pref", "x"), ("sid", "w")]);
        std::fs::remove_dir_all(&home).unwrap();
    }
}
