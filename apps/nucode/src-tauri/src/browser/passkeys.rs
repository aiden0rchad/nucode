//! A platform authenticator for the in-app browser: ES256 passkeys whose private keys live in the Keychain and are
//! released only after Touch ID or the Mac password. Everything here is platform-independent except the Keychain and
//! the LocalAuthentication prompt, so the whole ceremony is unit-tested with in-memory stand-ins.
use super::passwords::{now, Secrets};
use base64::Engine;
use futures_util::future::{select, BoxFuture, Either};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
    signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_ASN1_SIGNING},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io::Write, net::IpAddr, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::Duration};
use tokio::sync::Notify;

const NOT_ALLOWED: &str = "NotAllowedError";
const SECURITY: &str = "SecurityError";
const NOT_SUPPORTED: &str = "NotSupportedError";
const INVALID_STATE: &str = "InvalidStateError";
const ABORT: &str = "AbortError";
const TYPE: &str = "TypeError";
const COSE_ES256: i64 = -7;
/// How long a lookup that finds nothing waits before failing, so the page cannot tell "no passkey" from "declined" faster than a browser would.
const NO_CREDENTIAL_DELAY: Duration = Duration::from_millis(1000);
const PRIVATE: &str = "Passkeys are off in private browsing";
/// SubjectPublicKeyInfo header for an uncompressed P-256 point (id-ecPublicKey, prime256v1).
const SPKI_P256: [u8; 26] = [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00];

#[derive(Debug, Clone, PartialEq)]
pub struct Fail { pub name: &'static str, pub message: String, delay: bool }
fn fail(name: &'static str, message: impl Into<String>) -> Fail { Fail { name, message: message.into(), delay: false } }
fn store(message: String) -> Fail { fail(NOT_ALLOWED, message) }

fn b64(bytes: &[u8]) -> String { base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes) }
fn unb64(text: &str) -> Option<Vec<u8>> { base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(text).ok() }
fn sha256(bytes: &[u8]) -> Vec<u8> { digest::digest(&digest::SHA256, bytes).as_ref().to_vec() }

/// The page's origin as WebKit reports it, already checked for a secure context. `host` has no IPv6 brackets.
#[derive(Debug, Clone, PartialEq)]
pub struct Origin { pub text: String, pub host: String }
impl Origin {
    pub fn new(protocol: &str, host: &str, port: i64) -> Result<Self, Fail> {
        let protocol = protocol.to_ascii_lowercase();
        let host = host.to_ascii_lowercase();
        let bare = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(&host);
        let ip = bare.parse::<IpAddr>().ok();
        let valid = ip.is_some() || (!bare.is_empty() && bare.len() <= 253 && bare.split('.').all(|l| !l.is_empty() && l.len() <= 63 && l.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')));
        if !valid || !(0..=65535).contains(&port) { return Err(fail(NOT_ALLOWED, "Passkeys are unavailable on this page")); }
        let bare = ip.map_or_else(|| bare.to_string(), |ip| ip.to_string());
        let secure = match protocol.as_str() { "https" => true, "http" => matches!(bare.as_str(), "localhost" | "127.0.0.1" | "::1"), _ => false };
        if !secure { return Err(fail(NOT_ALLOWED, "Passkeys need a secure (https) page")); }
        let default = if protocol == "https" { 443 } else { 80 };
        let shown = if matches!(ip, Some(IpAddr::V6(_))) { format!("[{bare}]") } else { bare.clone() };
        let port = if port == 0 || port == default { String::new() } else { format!(":{port}") };
        Ok(Self { text: format!("{protocol}://{shown}{port}"), host: bare })
    }
    fn parse(text: &str) -> Result<Self, Fail> {
        let url = reqwest::Url::parse(text).map_err(|_| fail(NOT_ALLOWED, "Invalid saved passkey origin"))?;
        let origin = Self::new(url.scheme(), url.host_str().unwrap_or(""), url.port().map_or(0, i64::from))?;
        if origin.text != text { return Err(fail(NOT_ALLOWED, "Invalid saved passkey origin")); }
        Ok(origin)
    }
}

/// The relying party id: the origin's host, or a registrable parent domain of it (never a public suffix).
pub fn rp_id(origin: &Origin, requested: Option<&str>) -> Result<String, Fail> {
    let Some(requested) = requested else { return Ok(origin.host.clone()); };
    let requested = requested.to_ascii_lowercase();
    let mismatch = || fail(SECURITY, "The relying party ID is not valid for this site");
    if requested == origin.host { return Ok(requested); }
    if origin.host.parse::<IpAddr>().is_ok() || !origin.host.ends_with(&format!(".{requested}")) { return Err(mismatch()); }
    if psl::domain(requested.as_bytes()).is_none() { return Err(mismatch()); }
    Ok(requested)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    pub credential_id: String,
    pub rp_id: String,
    pub origin: String,
    pub user_id: String,
    pub user_name: String,
    pub display_name: String,
    pub created_at: u64,
    pub last_used_at: Option<u64>,
}
/// What Settings shows: no credential or user ids.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing { pub id: String, pub rp_id: String, pub user_name: String, pub display_name: String, pub created_at: u64, pub last_used_at: Option<u64> }
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Index { pub entries: Vec<Entry> }

pub fn secret_id(entry_id: &str) -> String { format!("passkey:{entry_id}") }
impl Index {
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("Cannot read saved passkey metadata".into()),
        };
        let index: Self = serde_json::from_slice(&bytes).map_err(|_| "Invalid saved passkey metadata")?;
        let mut seen = std::collections::HashSet::new();
        for entry in &index.entries {
            let bad = |what: &str| format!("Invalid saved passkey {what}");
            uuid::Uuid::parse_str(&entry.id).map_err(|_| bad("ID"))?;
            if !seen.insert(entry.id.clone()) || !seen.insert(entry.credential_id.clone()) { return Err(bad("ID")); }
            if !unb64(&entry.credential_id).is_some_and(|c| (16..=64).contains(&c.len())) { return Err(bad("credential")); }
            if !unb64(&entry.user_id).is_some_and(|u| (1..=64).contains(&u.len())) { return Err(bad("user")); }
            if entry.user_name.len() > 1024 || entry.display_name.len() > 1024 { return Err(bad("user")); }
            let origin = Origin::parse(&entry.origin).map_err(|_| bad("origin"))?;
            if rp_id(&origin, Some(&entry.rp_id)).map_err(|_| bad("site"))? != entry.rp_id { return Err(bad("site")); }
        }
        Ok(index)
    }
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("Missing passkey metadata directory")?;
        fs::create_dir_all(parent).map_err(|_| "Cannot create passkey metadata directory")?;
        let temp = parent.join(format!(".passkeys-{}.tmp", uuid::Uuid::new_v4()));
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
        result.map_err(|_| "Cannot save passkey metadata".into())
    }
    pub fn listing(&self) -> Vec<Listing> {
        self.entries.iter().map(|e| Listing { id: e.id.clone(), rp_id: e.rp_id.clone(), user_name: e.user_name.clone(), display_name: e.display_name.clone(), created_at: e.created_at, last_used_at: e.last_used_at }).collect()
    }
    pub fn delete(&mut self, secrets: &dyn Secrets, id: &str) -> Result<(), String> {
        if !self.entries.iter().any(|e| e.id == id) { return Err("Unknown saved passkey".into()); }
        secrets.delete(&secret_id(id))?;
        self.entries.retain(|e| e.id != id);
        Ok(())
    }
}

// --- CBOR: only the shapes WebAuthn needs here ---
fn cbor_head(out: &mut Vec<u8>, major: u8, n: u64) {
    let m = major << 5;
    match n {
        0..=23 => out.push(m | n as u8),
        24..=0xff => out.extend([m | 24, n as u8]),
        0x100..=0xffff => { out.push(m | 25); out.extend((n as u16).to_be_bytes()); }
        _ => { out.push(m | 26); out.extend((n as u32).to_be_bytes()); }
    }
}
fn cbor_int(out: &mut Vec<u8>, n: i64) { if n >= 0 { cbor_head(out, 0, n as u64) } else { cbor_head(out, 1, (-1 - n) as u64) } }
fn cbor_bytes(out: &mut Vec<u8>, bytes: &[u8]) { cbor_head(out, 2, bytes.len() as u64); out.extend(bytes); }
fn cbor_text(out: &mut Vec<u8>, text: &str) { cbor_head(out, 3, text.len() as u64); out.extend(text.as_bytes()); }
/// COSE_Key for an ES256 public key, canonical key order 1, 3, -1, -2, -3.
fn cose_key(x: &[u8], y: &[u8]) -> Vec<u8> {
    let mut out = vec![];
    cbor_head(&mut out, 5, 5);
    for (k, v) in [(1, 2), (3, COSE_ES256), (-1, 1)] { cbor_int(&mut out, k); cbor_int(&mut out, v); }
    cbor_int(&mut out, -2); cbor_bytes(&mut out, x);
    cbor_int(&mut out, -3); cbor_bytes(&mut out, y);
    out
}
fn attestation_object(auth_data: &[u8]) -> Vec<u8> {
    let mut out = vec![];
    cbor_head(&mut out, 5, 3);
    cbor_text(&mut out, "fmt"); cbor_text(&mut out, "none");
    cbor_text(&mut out, "attStmt"); cbor_head(&mut out, 5, 0);
    cbor_text(&mut out, "authData"); cbor_bytes(&mut out, auth_data);
    out
}
const UP_UV: u8 = 0x05;
const AT: u8 = 0x40;
fn auth_data(rp_id: &str, flags: u8, attested: Option<(&[u8], &[u8])>) -> Vec<u8> {
    let mut out = sha256(rp_id.as_bytes());
    out.push(flags);
    out.extend(0u32.to_be_bytes());
    if let Some((credential_id, cose)) = attested {
        out.extend([0u8; 16]);
        out.extend((credential_id.len() as u16).to_be_bytes());
        out.extend(credential_id);
        out.extend(cose);
    }
    out
}
fn client_data(kind: &str, challenge: &[u8], origin: &Origin) -> String {
    // The origin passed Origin::new, so it holds nothing that needs JSON escaping.
    format!(r#"{{"type":"{kind}","challenge":"{}","origin":"{}","crossOrigin":false}}"#, b64(challenge), origin.text)
}

// --- Requests ---
#[derive(Debug, PartialEq)]
pub enum Op { Create, Get, Cancel }
pub struct Request { pub op: Op, pub id: u64, pub options: Value }
pub fn parse_request(body: &str) -> Result<Request, Fail> {
    let value: Value = serde_json::from_str(body).map_err(|_| fail(TYPE, "Invalid passkey request"))?;
    let op = match value["op"].as_str() { Some("create") => Op::Create, Some("get") => Op::Get, Some("cancel") => Op::Cancel, _ => return Err(fail(TYPE, "Invalid passkey request")) };
    Ok(Request { op, id: value["id"].as_u64().unwrap_or(0), options: value["options"].clone() })
}
/// The WebAuthn `timeout` in ms, clamped to `limits` (30 s to 5 min in the app; default 2 min).
pub const LIMITS: (Duration, Duration) = (Duration::from_secs(30), Duration::from_secs(300));
pub fn timeout_of(options: &Value, limits: (Duration, Duration)) -> Duration {
    let ms = options["timeout"].as_f64().filter(|ms| ms.is_finite()).map_or(120_000, |ms| ms.max(0.) as u64);
    Duration::from_millis(ms).clamp(limits.0, limits.1)
}
fn bytes_of(value: &Value, what: &str, max: usize) -> Result<Vec<u8>, Fail> {
    value.as_str().and_then(unb64).filter(|b| !b.is_empty() && b.len() <= max).ok_or_else(|| fail(TYPE, format!("Invalid {what}")))
}
fn text_of(value: &Value, what: &str) -> Result<String, Fail> {
    match value { Value::Null => Ok(String::new()), Value::String(s) if s.len() <= 1024 => Ok(s.clone()), _ => Err(fail(TYPE, format!("Invalid {what}"))) }
}
fn ids_of(list: &Value, what: &str) -> Result<Vec<Vec<u8>>, Fail> {
    list.as_array().map_or(Ok(vec![]), |list| list.iter().map(|item| bytes_of(&item["id"], what, 1023)).collect())
}
fn common(origin: &Origin, options: &Value) -> Result<String, Fail> {
    if options["mediation"] == "conditional" { return Err(fail(NOT_ALLOWED, "Conditional passkey sign-in is not supported")); }
    rp_id(origin, match &options["rpId"] { Value::Null => None, Value::String(s) => Some(s.as_str()), _ => Some("") })
}

pub struct CreatePlan { pub rp_id: String, pub reason: String, origin: Origin, challenge: Vec<u8>, user_id: Vec<u8>, user_name: String, display_name: String, exclude: bool }
pub fn plan_create(origin: &Origin, options: &Value, index: &Index, private: bool) -> Result<CreatePlan, Fail> {
    if options["mediation"] == "conditional" { return Err(fail(NOT_ALLOWED, "Conditional passkey sign-in is not supported")); }
    if private { return Err(fail(NOT_ALLOWED, PRIVATE)); }
    let rp_id = common(origin, options)?;
    if let Some(params) = options["pubKeyCredParams"].as_array().filter(|p| !p.is_empty()) {
        if !params.iter().any(|p| p["type"] == "public-key" && p["alg"].as_i64() == Some(COSE_ES256)) { return Err(fail(NOT_SUPPORTED, "No supported passkey algorithm was offered")); }
    }
    let challenge = bytes_of(&options["challenge"], "challenge", 1024)?;
    let user = &options["user"];
    let user_id = bytes_of(&user["id"], "user id", 64)?;
    let user_name = text_of(&user["name"], "user name")?;
    let display_name = text_of(&user["displayName"], "user display name")?;
    let excluded = ids_of(&options["excludeCredentials"], "excluded credential")?;
    let exclude = index.entries.iter().any(|e| e.rp_id == rp_id && unb64(&e.credential_id).is_some_and(|id| excluded.contains(&id)));
    let reason = format!("create a passkey for {rp_id}");
    Ok(CreatePlan { rp_id, reason, origin: origin.clone(), challenge, user_id, user_name, display_name, exclude })
}

/// Creates the credential: stores the key, then the metadata (rolled back if it cannot be saved), then drops any
/// passkey it replaces. Call only after the user verified.
pub fn finish_create(plan: &CreatePlan, index: &mut Index, secrets: &dyn Secrets, path: &Path) -> Result<Value, Fail> {
    if plan.exclude { return Err(fail(INVALID_STATE, "A passkey for this account already exists here")); }
    let rng = SystemRandom::new();
    let unavailable = || fail(NOT_ALLOWED, "Cannot create a passkey");
    let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &rng).map_err(|_| unavailable())?;
    let key = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, pkcs8.as_ref(), &rng).map_err(|_| unavailable())?;
    let mut credential_id = [0u8; 16];
    rng.fill(&mut credential_id).map_err(|_| unavailable())?;
    let point = key.public_key().as_ref();
    let cose = cose_key(&point[1..33], &point[33..65]);
    let auth = auth_data(&plan.rp_id, UP_UV | AT, Some((&credential_id, &cose)));
    let client = client_data("webauthn.create", &plan.challenge, &plan.origin);
    let secret = b64(pkcs8.as_ref());
    nucode_diag_mcp::writer::remember_secret(&secret);
    let id = uuid::Uuid::new_v4().to_string();
    secrets.set(&secret_id(&id), &secret).map_err(store)?;
    let user_id = b64(&plan.user_id);
    let before = index.clone();
    let replaced: Vec<String> = index.entries.iter().filter(|e| e.rp_id == plan.rp_id && e.user_id == user_id).map(|e| e.id.clone()).collect();
    index.entries.retain(|e| !replaced.contains(&e.id));
    index.entries.push(Entry { id: id.clone(), credential_id: b64(&credential_id), rp_id: plan.rp_id.clone(), origin: plan.origin.text.clone(), user_id, user_name: plan.user_name.clone(), display_name: plan.display_name.clone(), created_at: now(), last_used_at: None });
    if let Err(message) = index.save(path) {
        *index = before;
        let _ = secrets.delete(&secret_id(&id));
        return Err(store(message));
    }
    for old in replaced { let _ = secrets.delete(&secret_id(&old)); }
    let mut spki = SPKI_P256.to_vec();
    spki.extend(point);
    Ok(json!({
        "id": b64(&credential_id), "rawId": b64(&credential_id), "clientDataJSON": b64(client.as_bytes()),
        "attestationObject": b64(&attestation_object(&auth)), "authenticatorData": b64(&auth),
        "publicKey": b64(&spki), "publicKeyAlgorithm": COSE_ES256, "transports": ["internal"],
    }))
}

pub struct GetPlan { pub rp_id: String, pub reason: String, origin: Origin, challenge: Vec<u8>, entry_id: String }
pub fn plan_get(origin: &Origin, options: &Value, index: &Index, private: bool) -> Result<GetPlan, Fail> {
    if options["mediation"] == "conditional" { return Err(fail(NOT_ALLOWED, "Conditional passkey sign-in is not supported")); }
    let rp_id = common(origin, options)?;
    let challenge = bytes_of(&options["challenge"], "challenge", 1024)?;
    let allowed = ids_of(&options["allowCredentials"], "allowed credential")?;
    let none = || Fail { delay: true, ..fail(NOT_ALLOWED, "The operation either timed out or was not allowed") };
    if private { return Err(none()); }
    // The most recently used one: there is no account chooser yet.
    let entry = index.entries.iter().filter(|e| e.rp_id == rp_id && (allowed.is_empty() || unb64(&e.credential_id).is_some_and(|id| allowed.contains(&id))))
        .max_by_key(|e| e.last_used_at.unwrap_or(e.created_at)).ok_or_else(none)?;
    let name = if entry.user_name.is_empty() { &entry.display_name } else { &entry.user_name };
    Ok(GetPlan { reason: format!("sign in to {rp_id} as {name}"), rp_id, origin: origin.clone(), challenge, entry_id: entry.id.clone() })
}
/// Signs the assertion. Call only after the user verified.
pub fn finish_get(plan: &GetPlan, index: &mut Index, secrets: &dyn Secrets, path: &Path) -> Result<Value, Fail> {
    let gone = || fail(NOT_ALLOWED, "The operation either timed out or was not allowed");
    let entry = index.entries.iter_mut().find(|e| e.id == plan.entry_id).ok_or_else(gone)?;
    let secret = secrets.get(&secret_id(&entry.id)).map_err(store)?.ok_or_else(gone)?;
    nucode_diag_mcp::writer::remember_secret(&secret);
    let key = unb64(&secret).and_then(|pkcs8| EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &pkcs8, &SystemRandom::new()).ok()).ok_or_else(gone)?;
    let auth = auth_data(&plan.rp_id, UP_UV, None);
    let client = client_data("webauthn.get", &plan.challenge, &plan.origin);
    let mut signed = auth.clone();
    signed.extend(sha256(client.as_bytes()));
    let signature = key.sign(&SystemRandom::new(), &signed).map_err(|_| gone())?;
    let response = json!({
        "id": entry.credential_id, "rawId": entry.credential_id, "clientDataJSON": b64(client.as_bytes()),
        "authenticatorData": b64(&auth), "signature": b64(signature.as_ref()), "userHandle": entry.user_id,
    });
    entry.last_used_at = Some(now());
    let _ = index.save(path); // The last-used time is a nicety; the sign-in must not fail over it.
    Ok(response)
}

// --- One ceremony at a time per webview ---
#[derive(Default)]
pub struct Slot(Mutex<Option<(u64, Arc<Notify>)>>);
pub struct Ceremony { slot: Arc<Slot>, pub cancel: Arc<Notify> }
impl Slot {
    pub fn begin(self: &Arc<Self>, id: u64) -> Option<Ceremony> {
        let mut current = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if current.is_some() { return None; }
        let cancel = Arc::new(Notify::new());
        *current = Some((id, cancel.clone()));
        Some(Ceremony { slot: self.clone(), cancel })
    }
    /// Cancels the running ceremony if `id` is its request id.
    pub fn cancel(&self, id: u64) {
        if let Some((current, cancel)) = &*self.0.lock().unwrap_or_else(|e| e.into_inner()) { if *current == id { cancel.notify_one(); } }
    }
}
impl Drop for Ceremony { fn drop(&mut self) { *self.slot.0.lock().unwrap_or_else(|e| e.into_inner()) = None; } }

pub type Auth = Box<dyn Fn(String) -> BoxFuture<'static, Result<(), Fail>> + Send + Sync>;
pub struct Env {
    pub index_path: PathBuf,
    /// Serialises read-modify-write of the metadata file with Settings.
    pub lock: Arc<Mutex<()>>,
    pub private: Box<dyn Fn() -> bool + Send + Sync>,
    pub secrets: Arc<dyn Secrets>,
    pub auth: Auth,
    pub limits: (Duration, Duration),
}
pub fn reply_ok(result: Value) -> String { json!({"ok": true, "result": result}).to_string() }
pub fn reply_err(f: &Fail) -> String { json!({"ok": false, "name": f.name, "message": f.message}).to_string() }
pub fn busy() -> Fail { fail(NOT_ALLOWED, "Another passkey request is in progress") }
pub fn unavailable() -> Fail { fail(NOT_ALLOWED, "Passkeys are unavailable on this page") }

/// Serves one message from a page. `origin` is what WebKit says the sending frame's origin is; nothing in `body` can change it.
pub async fn handle(env: &Env, slot: &Arc<Slot>, origin: Result<Origin, Fail>, body: &str) -> String {
    let request = match parse_request(body) { Ok(request) => request, Err(f) => return reply_err(&f) };
    if request.op == Op::Cancel { slot.cancel(request.id); return reply_ok(Value::Null); }
    let Some(ceremony) = slot.begin(request.id) else { return reply_err(&busy()); };
    let result = match origin {
        Err(f) => Err(f),
        Ok(origin) => {
            let work = Box::pin(ceremonies(env, &origin, &request));
            let cancelled = Box::pin(ceremony.cancel.notified());
            match tokio::time::timeout(timeout_of(&request.options, env.limits), select(work, cancelled)).await {
                Err(_) => Err(fail(NOT_ALLOWED, "The operation timed out")),
                Ok(Either::Left((result, _))) => result,
                Ok(Either::Right(_)) => Err(fail(ABORT, "The operation was aborted")),
            }
        }
    };
    match result { Ok(value) => reply_ok(value), Err(f) => reply_err(&f) }
}
fn locked(env: &Env) -> Result<std::sync::MutexGuard<'_, ()>, Fail> { env.lock.lock().map_err(|_| fail(NOT_ALLOWED, "Saved passkeys unavailable")) }
async fn ceremonies(env: &Env, origin: &Origin, request: &Request) -> Result<Value, Fail> {
    let private = (env.private)();
    match request.op {
        Op::Create => {
            let plan = { let _guard = locked(env)?; plan_create(origin, &request.options, &Index::load(&env.index_path).map_err(store)?, private)? };
            (env.auth)(plan.reason.clone()).await?;
            let _guard = locked(env)?;
            let mut index = Index::load(&env.index_path).map_err(store)?;
            finish_create(&plan, &mut index, &*env.secrets, &env.index_path)
        }
        Op::Get => {
            let planned = { let _guard = locked(env)?; plan_get(origin, &request.options, &Index::load(&env.index_path).map_err(store)?, private) };
            let plan = match planned {
                Err(f) if f.delay => { tokio::time::sleep(NO_CREDENTIAL_DELAY).await; return Err(f); }
                planned => planned?,
            };
            (env.auth)(plan.reason.clone()).await?;
            let _guard = locked(env)?;
            let mut index = Index::load(&env.index_path).map_err(store)?;
            finish_get(&plan, &mut index, &*env.secrets, &env.index_path)
        }
        Op::Cancel => Err(unavailable()),
    }
}

// --- macOS: Keychain and Touch ID ---
#[cfg(target_os = "macos")]
pub struct Keychain;
#[cfg(target_os = "macos")]
fn key(id: &str) -> Result<keyring::Entry, String> {
    uuid::Uuid::parse_str(id.strip_prefix("passkey:").ok_or("Invalid saved passkey ID")?).map_err(|_| "Invalid saved passkey ID")?;
    keyring::Entry::new("dev.nucode.browser-passkeys", id).map_err(|_| "Cannot access passkey Keychain".into())
}
#[cfg(target_os = "macos")]
impl Secrets for Keychain {
    fn get(&self, id: &str) -> Result<Option<String>, String> {
        match key(id)?.get_password() {
            Ok(secret) => { nucode_diag_mcp::writer::remember_secret(&secret); Ok(Some(secret)) },
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Cannot read passkey Keychain".into()),
        }
    }
    fn set(&self, id: &str, secret: &str) -> Result<(), String> {
        nucode_diag_mcp::writer::remember_secret(secret);
        key(id)?.set_password(secret).map_err(|_| "Cannot save passkey to Keychain".into())
    }
    fn delete(&self, id: &str) -> Result<(), String> {
        match key(id)?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(_) => Err("Cannot delete saved passkey".into()) }
    }
}
/// LAContext is documented as usable from any thread; this lets the prompt be dismissed when its future is dropped.
#[cfg(target_os = "macos")]
struct Dismiss(objc2::rc::Retained<objc2::runtime::AnyObject>);
#[cfg(target_os = "macos")]
unsafe impl Send for Dismiss {}
#[cfg(target_os = "macos")]
impl Dismiss { fn invalidate(&self) { unsafe { let _: () = objc2::msg_send![&*self.0, invalidate]; } } }
#[cfg(target_os = "macos")]
impl Drop for Dismiss { fn drop(&mut self) { self.invalidate(); } }
/// Touch ID or the Mac password. Dropping the future (cancel, timeout) dismisses the prompt.
#[cfg(target_os = "macos")]
pub fn authenticate(reason: String) -> BoxFuture<'static, Result<(), Fail>> {
    Box::pin(async move {
        use objc2::{msg_send, rc::Retained, runtime::{AnyClass, AnyObject, Bool}};
        use objc2_foundation::{NSError, NSString};
        let cancelled = || fail(NOT_ALLOWED, "Passkey authentication was cancelled");
        let (tx, rx) = tokio::sync::oneshot::channel();
        let sender = Mutex::new(Some(tx));
        let dismiss = {
            let context: Retained<AnyObject> = unsafe { msg_send![AnyClass::get(c"LAContext").ok_or_else(|| fail(NOT_ALLOWED, "Authentication unavailable"))?, new] };
            let dismiss = Dismiss(context.clone());
            let retained = context.clone();
            let reply = block2::RcBlock::new(move |success: Bool, _error: *mut NSError| {
                let _keep_alive = &retained;
                if let Some(tx) = sender.lock().unwrap_or_else(|e| e.into_inner()).take() { let _ = tx.send(success.as_bool()); }
            });
            unsafe { let _: () = msg_send![&*context, evaluatePolicy: 2isize, localizedReason: &*NSString::from_str(&reason), reply: &*reply]; }
            dismiss
        };
        let verified = rx.await.unwrap_or(false);
        drop(dismiss);
        if verified { Ok(()) } else { Err(cancelled()) }
    })
}
#[cfg(target_os = "macos")]
impl Env {
    pub fn native(index_path: PathBuf, lock: Arc<Mutex<()>>, private: Box<dyn Fn() -> bool + Send + Sync>) -> Self {
        Self { index_path, lock, private, secrets: Arc::new(Keychain), auth: Box::new(authenticate), limits: LIMITS }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{UnparsedPublicKey, ECDSA_P256_SHA256_ASN1};
    use std::collections::HashMap;

    #[derive(Default)]
    struct Memory(Mutex<HashMap<String, String>>);
    impl Secrets for Memory {
        fn get(&self, id: &str) -> Result<Option<String>, String> { Ok(self.0.lock().unwrap().get(id).cloned()) }
        fn set(&self, id: &str, secret: &str) -> Result<(), String> { self.0.lock().unwrap().insert(id.into(), secret.into()); Ok(()) }
        fn delete(&self, id: &str) -> Result<(), String> { self.0.lock().unwrap().remove(id); Ok(()) }
    }
    fn temp() -> PathBuf { std::env::temp_dir().join(format!("passkey-test-{}", uuid::Uuid::new_v4())).join("browser/passkeys.json") }
    fn site() -> Origin { Origin::new("https", "example.test", 0).unwrap() }
    fn options(extra: Value) -> Value {
        let mut o = json!({"challenge": b64(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), "user": {"id": b64(b"user-1"), "name": "alice", "displayName": "Alice"}, "pubKeyCredParams": [{"type": "public-key", "alg": -7}]});
        for (k, v) in extra.as_object().unwrap() { o[k] = v.clone(); }
        o
    }
    fn create(o: &Origin, opts: &Value, index: &mut Index, secrets: &Memory, path: &Path) -> Result<Value, Fail> {
        finish_create(&plan_create(o, opts, index, false)?, index, secrets, path)
    }
    fn get(o: &Origin, opts: &Value, index: &mut Index, secrets: &Memory, path: &Path) -> Result<Value, Fail> {
        finish_get(&plan_get(o, opts, index, false)?, index, secrets, path)
    }
    fn bin(v: &Value) -> Vec<u8> { unb64(v.as_str().unwrap()).unwrap() }

    /// Just enough CBOR to read back what we wrote: unsigned/negative ints, byte and text strings, maps.
    #[derive(Debug, PartialEq, Clone)]
    enum Cbor { Int(i64), Bytes(Vec<u8>), Text(String), Map(Vec<(Cbor, Cbor)>) }
    fn decode(b: &[u8], at: &mut usize) -> Cbor {
        let head = b[*at]; *at += 1;
        let (major, info) = (head >> 5, head & 31);
        let n = match info { 0..=23 => info as u64, 24 => { *at += 1; b[*at - 1] as u64 } 25 => { *at += 2; u16::from_be_bytes([b[*at - 2], b[*at - 1]]) as u64 } _ => panic!("length") } as usize;
        match major {
            0 => Cbor::Int(n as i64),
            1 => Cbor::Int(-1 - n as i64),
            2 => { *at += n; Cbor::Bytes(b[*at - n..*at].to_vec()) }
            3 => { *at += n; Cbor::Text(String::from_utf8(b[*at - n..*at].to_vec()).unwrap()) }
            5 => Cbor::Map((0..n).map(|_| { let k = decode(b, at); (k, decode(b, at)) }).collect()),
            _ => panic!("major"),
        }
    }
    fn lookup<'a>(map: &'a Cbor, key: Cbor) -> &'a Cbor { let Cbor::Map(m) = map else { panic!() }; &m.iter().find(|(k, _)| *k == key).unwrap().1 }

    #[test] fn round_trip_is_verified_independently_of_the_signing_code() {
        let path = temp(); let secrets = Memory::default(); let mut index = Index::default();
        let opts = options(json!({}));
        let made = create(&site(), &opts, &mut index, &secrets, &path).unwrap();
        // attestationObject: exact canonical shape, then authData byte by byte.
        let object = bin(&made["attestationObject"]);
        assert_eq!(&object[..28], b"\xa3\x63fmt\x64none\x67attStmt\xa0\x68authData");
        let mut at = 0; let decoded = decode(&object, &mut at); assert_eq!(at, object.len());
        assert_eq!(lookup(&decoded, Cbor::Text("fmt".into())), &Cbor::Text("none".into()));
        assert_eq!(lookup(&decoded, Cbor::Text("attStmt".into())), &Cbor::Map(vec![]));
        let Cbor::Bytes(auth) = lookup(&decoded, Cbor::Text("authData".into())).clone() else { panic!() };
        assert_eq!(auth, bin(&made["authenticatorData"]));
        assert_eq!(&auth[..32], digest::digest(&digest::SHA256, b"example.test").as_ref());
        assert_eq!(auth[32], 0x45); assert_eq!(&auth[33..37], &[0, 0, 0, 0]);
        assert_eq!(&auth[37..53], &[0u8; 16]);
        assert_eq!(&auth[53..55], &[0, 16]);
        let credential_id = &auth[55..71];
        assert_eq!(credential_id, bin(&made["rawId"]).as_slice()); assert_eq!(made["id"], made["rawId"]);
        let mut at = 71; let cose = decode(&auth, &mut at); assert_eq!(at, auth.len());
        let Cbor::Map(entries) = &cose else { panic!() };
        assert_eq!(entries.iter().map(|(k, _)| k.clone()).collect::<Vec<_>>(), [1, 3, -1, -2, -3].map(Cbor::Int));
        assert_eq!(lookup(&cose, Cbor::Int(1)), &Cbor::Int(2)); assert_eq!(lookup(&cose, Cbor::Int(3)), &Cbor::Int(-7)); assert_eq!(lookup(&cose, Cbor::Int(-1)), &Cbor::Int(1));
        let (Cbor::Bytes(x), Cbor::Bytes(y)) = (lookup(&cose, Cbor::Int(-2)).clone(), lookup(&cose, Cbor::Int(-3)).clone()) else { panic!() };
        assert_eq!((x.len(), y.len()), (32, 32));
        let mut point = vec![4]; point.extend(&x); point.extend(&y);
        let spki = bin(&made["publicKey"]); assert_eq!(&spki[..26], &SPKI_P256); assert_eq!(&spki[26..], point.as_slice());
        assert_eq!(made["publicKeyAlgorithm"], -7); assert_eq!(made["transports"], json!(["internal"]));
        // clientDataJSON is exact.
        let expected = format!(r#"{{"type":"webauthn.create","challenge":"{}","origin":"https://example.test","crossOrigin":false}}"#, opts["challenge"].as_str().unwrap());
        assert_eq!(bin(&made["clientDataJSON"]), expected.as_bytes());
        // Assertion, verified with a public key rebuilt from the attestation.
        let assertion_options = options(json!({"challenge": b64(b"another-challenge")}));
        let got = get(&site(), &assertion_options, &mut index, &secrets, &path).unwrap();
        assert_eq!(bin(&got["rawId"]), credential_id); assert_eq!(bin(&got["userHandle"]), b"user-1");
        let auth = bin(&got["authenticatorData"]); assert_eq!(auth.len(), 37); assert_eq!(auth[32], 0x05); assert_eq!(&auth[33..], &[0; 4]);
        assert_eq!(&auth[..32], digest::digest(&digest::SHA256, b"example.test").as_ref());
        let client = bin(&got["clientDataJSON"]);
        assert_eq!(client, format!(r#"{{"type":"webauthn.get","challenge":"{}","origin":"https://example.test","crossOrigin":false}}"#, b64(b"another-challenge")).as_bytes());
        let mut signed = auth.clone(); signed.extend(digest::digest(&digest::SHA256, &client).as_ref());
        let signature = bin(&got["signature"]);
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_ASN1, &point).verify(&signed, &signature).unwrap();
        // A different message must not verify.
        signed[0] ^= 1;
        assert!(UnparsedPublicKey::new(&ECDSA_P256_SHA256_ASN1, &point).verify(&signed, &signature).is_err());
        assert!(Index::load(&path).unwrap().entries[0].last_used_at.is_some());
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn private_keys_stay_in_the_secret_store_and_out_of_metadata() {
        let path = temp(); let secrets = Memory::default(); let mut index = Index::default();
        create(&site(), &options(json!({})), &mut index, &secrets, &path).unwrap();
        let stored = secrets.0.lock().unwrap().clone();
        assert_eq!(stored.len(), 1);
        let (id, pkcs8) = stored.iter().next().unwrap();
        assert!(id.starts_with("passkey:"));
        assert!(!fs::read_to_string(&path).unwrap().contains(pkcs8.as_str()));
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600); }
        let json = serde_json::to_string(&index.listing()).unwrap();
        assert!(!json.contains("credentialId") && !json.contains("userId") && !json.contains(pkcs8.as_str()));
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn origins_come_from_webkit_parts_and_must_be_secure() {
        assert_eq!(Origin::new("HTTPS", "Example.Test", 443).unwrap().text, "https://example.test");
        assert_eq!(Origin::new("https", "example.test", 8443).unwrap().text, "https://example.test:8443");
        assert_eq!(Origin::new("http", "localhost", 80).unwrap().text, "http://localhost");
        assert_eq!(Origin::new("http", "localhost", 3000).unwrap().text, "http://localhost:3000");
        assert_eq!(Origin::new("http", "127.0.0.1", 8080).unwrap().text, "http://127.0.0.1:8080");
        let v6 = Origin::new("http", "[::1]", 5173).unwrap(); assert_eq!((v6.text.as_str(), v6.host.as_str()), ("http://[::1]:5173", "::1"));
        for (protocol, host) in [("http", "example.test"), ("http", "localhost.example.test"), ("http", "192.168.1.1"), ("file", "example.test"), ("ftp", "localhost"), ("data", ""), ("https", ""), ("https", "exa mple.test"), ("https", "ex\"ample.test")] {
            assert_eq!(Origin::new(protocol, host, 0).unwrap_err().name, NOT_ALLOWED, "{protocol}://{host}");
        }
        assert!(Origin::new("https", "example.test", 70000).is_err());
        assert_eq!(Origin::parse("https://example.test:8443").unwrap().text, "https://example.test:8443");
        assert!(Origin::parse("https://EXAMPLE.test").is_err());
        assert!(Origin::parse("http://example.test").is_err());
    }
    #[test] fn rp_id_rules() {
        let o = Origin::new("https", "login.accounts.example.test", 0).unwrap();
        assert_eq!(rp_id(&o, None).unwrap(), "login.accounts.example.test");
        assert_eq!(rp_id(&o, Some("login.accounts.example.test")).unwrap(), "login.accounts.example.test");
        assert_eq!(rp_id(&o, Some("Accounts.Example.Test")).unwrap(), "accounts.example.test");
        assert_eq!(rp_id(&o, Some("example.test")).unwrap(), "example.test");
        for bad in ["test", "other.test", "ample.test", "mple.test", "", ".example.test", "login.accounts.example.test.", "evil-example.test"] {
            assert_eq!(rp_id(&o, Some(bad)).unwrap_err().name, SECURITY, "{bad}");
        }
        let suffix = Origin::new("https", "foo.co.uk", 0).unwrap();
        assert_eq!(rp_id(&suffix, Some("co.uk")).unwrap_err().name, SECURITY);
        assert_eq!(rp_id(&suffix, Some("foo.co.uk")).unwrap(), "foo.co.uk");
        let pages = Origin::new("https", "me.github.io", 0).unwrap();
        assert_eq!(rp_id(&pages, Some("github.io")).unwrap_err().name, SECURITY);
        let sub = Origin::new("https", "a.b.com", 0).unwrap();
        assert_eq!(rp_id(&sub, Some("com")).unwrap_err().name, SECURITY);
        let ip = Origin::new("http", "127.0.0.1", 0).unwrap();
        assert_eq!(rp_id(&ip, None).unwrap(), "127.0.0.1"); assert_eq!(rp_id(&ip, Some("127.0.0.1")).unwrap(), "127.0.0.1");
        assert_eq!(rp_id(&ip, Some("0.0.1")).unwrap_err().name, SECURITY);
        let local = Origin::new("http", "localhost", 3000).unwrap();
        assert_eq!(rp_id(&local, None).unwrap(), "localhost"); assert_eq!(rp_id(&local, Some("localhost")).unwrap(), "localhost");
        assert_eq!(rp_id(&local, Some("host")).unwrap_err().name, SECURITY);
        // Through the plans: the rpId in the options, never anything the page says about its origin.
        let index = Index::default();
        assert_eq!(plan_create(&site(), &options(json!({"rpId": "evil.test"})), &index, false).err().unwrap().name, SECURITY);
        assert_eq!(plan_get(&site(), &options(json!({"rpId": "evil.test"})), &index, false).err().unwrap().name, SECURITY);
        assert_eq!(plan_create(&site(), &options(json!({"rpId": ""})), &index, false).err().unwrap().name, SECURITY);
    }
    #[test] fn insecure_origins_never_reach_a_ceremony() {
        assert!(Origin::new("http", "example.test", 0).is_err());
    }
    #[test] fn es256_is_required() {
        let index = Index::default();
        for params in [json!([{"type": "public-key", "alg": -257}]), json!([{"type": "public-key", "alg": -8}, {"type": "other", "alg": -7}])] {
            assert_eq!(plan_create(&site(), &options(json!({"pubKeyCredParams": params})), &index, false).err().unwrap().name, NOT_SUPPORTED);
        }
        assert!(plan_create(&site(), &options(json!({"pubKeyCredParams": [{"type": "public-key", "alg": -257}, {"type": "public-key", "alg": -7}]})), &index, false).is_ok());
        // An empty list means the defaults, which include ES256.
        assert!(plan_create(&site(), &options(json!({"pubKeyCredParams": []})), &index, false).is_ok());
    }
    #[test] fn exclude_credentials_block_a_duplicate_only_for_the_same_site() {
        let path = temp(); let secrets = Memory::default(); let mut index = Index::default();
        let first = create(&site(), &options(json!({})), &mut index, &secrets, &path).unwrap();
        let exclude = json!([{"type": "public-key", "id": first["rawId"]}]);
        let again = options(json!({"excludeCredentials": exclude, "user": {"id": b64(b"user-2"), "name": "bob"}}));
        assert_eq!(create(&site(), &again, &mut index, &secrets, &path).unwrap_err().name, INVALID_STATE);
        assert_eq!(index.entries.len(), 1); assert_eq!(secrets.0.lock().unwrap().len(), 1);
        let other = Origin::new("https", "other.test", 0).unwrap();
        assert!(create(&other, &again, &mut index, &secrets, &path).is_ok());
        let unrelated = options(json!({"excludeCredentials": [{"type": "public-key", "id": b64(b"nothing-stored!!")}], "user": {"id": b64(b"user-3"), "name": "carol"}}));
        assert!(create(&site(), &unrelated, &mut index, &secrets, &path).is_ok());
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn allow_credentials_filter_and_the_latest_used_wins() {
        let path = temp(); let secrets = Memory::default(); let mut index = Index::default();
        let a = create(&site(), &options(json!({"user": {"id": b64(b"a"), "name": "alice"}})), &mut index, &secrets, &path).unwrap();
        let b = create(&site(), &options(json!({"user": {"id": b64(b"b"), "name": "bob"}})), &mut index, &secrets, &path).unwrap();
        index.entries.iter_mut().find(|e| e.credential_id == a["id"].as_str().unwrap()).unwrap().last_used_at = Some(now() + 100);
        let plan = plan_get(&site(), &options(json!({})), &index, false).unwrap();
        assert_eq!(plan.reason, "sign in to example.test as alice");
        let only_b = options(json!({"allowCredentials": [{"type": "public-key", "id": b["id"]}]}));
        let got = get(&site(), &only_b, &mut index, &secrets, &path).unwrap();
        assert_eq!(got["id"], b["id"]); assert_eq!(bin(&got["userHandle"]), b"b");
        let missing = options(json!({"allowCredentials": [{"type": "public-key", "id": b64(b"unknown-cred-id!")}]}));
        let none = plan_get(&site(), &missing, &index, false).err().unwrap();
        assert_eq!((none.name, none.delay), (NOT_ALLOWED, true));
        let other = Origin::new("https", "other.test", 0).unwrap();
        assert!(plan_get(&other, &options(json!({})), &index, false).is_err());
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn a_new_credential_replaces_the_same_user_on_the_same_site() {
        let path = temp(); let secrets = Memory::default(); let mut index = Index::default();
        let first = create(&site(), &options(json!({})), &mut index, &secrets, &path).unwrap();
        let old_id = index.entries[0].id.clone();
        let second = create(&site(), &options(json!({})), &mut index, &secrets, &path).unwrap();
        assert_ne!(first["id"], second["id"]);
        assert_eq!(index.entries.len(), 1); assert_eq!(Index::load(&path).unwrap().entries.len(), 1);
        assert!(secrets.0.lock().unwrap().get(&secret_id(&old_id)).is_none()); assert_eq!(secrets.0.lock().unwrap().len(), 1);
        // The old credential no longer signs in.
        let old = options(json!({"allowCredentials": [{"type": "public-key", "id": first["id"]}]}));
        assert!(plan_get(&site(), &old, &index, false).is_err());
        // Another user, or the same user elsewhere, is kept.
        create(&site(), &options(json!({"user": {"id": b64(b"user-2"), "name": "bob"}})), &mut index, &secrets, &path).unwrap();
        create(&Origin::new("https", "other.test", 0).unwrap(), &options(json!({})), &mut index, &secrets, &path).unwrap();
        assert_eq!(index.entries.len(), 3); assert_eq!(secrets.0.lock().unwrap().len(), 3);
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn private_browsing_and_conditional_mediation_are_refused() {
        let path = temp(); let secrets = Memory::default(); let mut index = Index::default();
        let made = create(&site(), &options(json!({})), &mut index, &secrets, &path).unwrap();
        let denied = plan_create(&site(), &options(json!({})), &index, true).err().unwrap();
        assert_eq!((denied.name, denied.message.as_str()), (NOT_ALLOWED, "Passkeys are off in private browsing"));
        let none = plan_get(&site(), &options(json!({})), &index, true).err().unwrap();
        assert_eq!((none.name, none.delay), (NOT_ALLOWED, true));
        for plan in [plan_create(&site(), &options(json!({"mediation": "conditional"})), &index, false).err(), plan_get(&site(), &options(json!({"mediation": "conditional"})), &index, false).err()] {
            let f = plan.unwrap(); assert_eq!(f.name, NOT_ALLOWED); assert!(!f.delay);
        }
        assert!(plan_get(&site(), &options(json!({"mediation": "optional", "allowCredentials": [{"type": "public-key", "id": made["id"]}]})), &index, false).is_ok());
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn malformed_options_are_type_errors_and_timeouts_are_clamped() {
        let index = Index::default();
        for bad in [json!({"challenge": ""}), json!({"challenge": "***"}), json!({"challenge": 7}), json!({"user": {"id": "", "name": "a"}}), json!({"user": {"id": b64(&[0u8; 65]), "name": "a"}}), json!({"user": {"id": b64(b"u"), "name": 5}})] {
            assert_eq!(plan_create(&site(), &options(bad), &index, false).err().unwrap().name, TYPE);
        }
        let t = |o: Value| timeout_of(&o, LIMITS);
        assert_eq!(t(json!({})), Duration::from_secs(120));
        assert_eq!(t(json!({"timeout": 1})), Duration::from_secs(30));
        assert_eq!(t(json!({"timeout": -5})), Duration::from_secs(30));
        assert_eq!(t(json!({"timeout": 99999999999u64})), Duration::from_secs(300));
        assert_eq!(t(json!({"timeout": 45000})), Duration::from_secs(45));
        assert_eq!(t(json!({"timeout": "soon"})), Duration::from_secs(120));
    }
    #[test] fn index_load_validates_everything() {
        let path = temp(); let secrets = Memory::default(); let mut index = Index::default();
        create(&site(), &options(json!({})), &mut index, &secrets, &path).unwrap();
        assert_eq!(Index::load(&path).unwrap().entries.len(), 1);
        assert_eq!(Index::load(&path.with_file_name("missing.json")).unwrap().entries.len(), 0);
        let good = serde_json::to_value(&index).unwrap();
        let mutate = |field: &str, value: Value| { let mut v = good.clone(); v["entries"][0][field] = value; fs::write(&path, v.to_string()).unwrap(); Index::load(&path) };
        for (field, value) in [("id", json!("not-a-uuid")), ("credentialId", json!("***")), ("credentialId", json!("AA")), ("userId", json!("")), ("origin", json!("http://example.test")), ("origin", json!("https://example.test/path")), ("rpId", json!("evil.test")), ("rpId", json!("test")), ("userName", json!("x".repeat(2000)))] {
            assert!(mutate(field, value.clone()).is_err(), "{field} {value}");
        }
        let mut dup = good.clone(); let e = dup["entries"][0].clone(); dup["entries"].as_array_mut().unwrap().push(e);
        fs::write(&path, dup.to_string()).unwrap(); assert!(Index::load(&path).is_err());
        let mut extra = good.clone(); extra["entries"][0]["privateKey"] = json!("x");
        fs::write(&path, extra.to_string()).unwrap(); assert!(Index::load(&path).is_err());
        fs::write(&path, "not json").unwrap(); assert!(Index::load(&path).is_err());
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn delete_removes_the_key_and_the_entry() {
        let path = temp(); let secrets = Memory::default(); let mut index = Index::default();
        create(&site(), &options(json!({})), &mut index, &secrets, &path).unwrap();
        let id = index.entries[0].id.clone();
        assert!(index.delete(&secrets, "unknown").is_err());
        index.delete(&secrets, &id).unwrap();
        assert!(index.entries.is_empty() && secrets.0.lock().unwrap().is_empty());
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn a_failed_save_leaves_no_orphaned_key() {
        let dir = std::env::temp_dir().join(format!("passkey-test-{}", uuid::Uuid::new_v4())); fs::create_dir_all(&dir).unwrap();
        let secrets = Memory::default(); let mut index = Index::default();
        // A directory where the file should be makes the final rename fail.
        let path = dir.join("passkeys.json"); fs::create_dir_all(path.join("keep")).unwrap();
        assert!(create(&site(), &options(json!({})), &mut index, &secrets, &path).is_err());
        assert!(index.entries.is_empty() && secrets.0.lock().unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn only_one_ceremony_runs_at_a_time() {
        let slot = Arc::new(Slot::default());
        let first = slot.begin(1).unwrap();
        assert!(slot.begin(2).is_none());
        slot.cancel(2); // Not the running request: ignored.
        let waiter = Box::pin(first.cancel.notified());
        slot.cancel(1);
        tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(async { waiter.await });
        drop(first);
        assert!(slot.begin(3).is_some());
    }

    fn env(path: &Path, secrets: Arc<Memory>, private: bool, verdict: Result<(), Fail>, hang: bool) -> Env {
        Env {
            index_path: path.to_path_buf(), lock: Arc::default(), private: Box::new(move || private), secrets,
            auth: Box::new(move |_reason| { let verdict = verdict.clone(); Box::pin(async move { if hang { std::future::pending::<()>().await; } verdict }) }),
            limits: (Duration::from_millis(100), Duration::from_millis(100)),
        }
    }
    fn run<T>(f: impl std::future::Future<Output = T>) -> T { tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap().block_on(f) }
    fn request(op: &str, id: u64, options: Value) -> String { json!({"op": op, "id": id, "options": options}).to_string() }
    fn parsed(reply: &str) -> Value { serde_json::from_str(reply).unwrap() }

    #[test] fn nothing_is_created_or_signed_without_the_user_verifying() {
        let path = temp(); let secrets = Arc::new(Memory::default());
        let declined = env(&path, secrets.clone(), false, Err(fail(NOT_ALLOWED, "Passkey authentication was cancelled")), false);
        let slot = Arc::new(Slot::default());
        let reply = parsed(&run(handle(&declined, &slot, Ok(site()), &request("create", 1, options(json!({}))))));
        assert_eq!((reply["ok"].clone(), reply["name"].clone()), (json!(false), json!(NOT_ALLOWED)));
        assert!(secrets.0.lock().unwrap().is_empty() && !path.exists());
        // Make one with approval, then decline the sign-in.
        let approved = env(&path, secrets.clone(), false, Ok(()), false);
        let made = parsed(&run(handle(&approved, &slot, Ok(site()), &request("create", 2, options(json!({}))))));
        assert_eq!(made["ok"], true); assert!(made["result"]["attestationObject"].is_string());
        let reply = parsed(&run(handle(&declined, &slot, Ok(site()), &request("get", 3, options(json!({}))))));
        assert_eq!(reply["ok"], false); assert!(!reply.to_string().contains("signature"));
        let reply = parsed(&run(handle(&approved, &slot, Ok(site()), &request("get", 4, options(json!({}))))));
        assert_eq!(reply["ok"], true); assert!(reply["result"]["signature"].is_string());
        fs::remove_dir_all(path.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test] fn handle_rejects_bad_origins_private_browsing_busy_slots_and_garbage() {
        let path = temp(); let secrets = Arc::new(Memory::default()); let slot = Arc::new(Slot::default());
        let ok = env(&path, secrets.clone(), false, Ok(()), false);
        let insecure = Origin::new("http", "example.test", 0).unwrap_err();
        assert_eq!(parsed(&run(handle(&ok, &slot, Err(insecure), &request("create", 1, options(json!({}))))))["name"], NOT_ALLOWED);
        let private = env(&path, secrets.clone(), true, Ok(()), false);
        let reply = parsed(&run(handle(&private, &slot, Ok(site()), &request("create", 2, options(json!({}))))));
        assert_eq!(reply["message"], "Passkeys are off in private browsing");
        for body in ["", "not json", r#"{"op":"delete"}"#, r#"{"options":{}}"#] { assert_eq!(parsed(&run(handle(&ok, &slot, Ok(site()), body)))["name"], TYPE); }
        let running = slot.begin(9).unwrap();
        assert_eq!(parsed(&run(handle(&ok, &slot, Ok(site()), &request("create", 10, options(json!({}))))))["message"], "Another passkey request is in progress");
        assert_eq!(parsed(&run(handle(&ok, &slot, Ok(site()), &request("cancel", 10, Value::Null))))["ok"], true);
        drop(running);
        assert!(secrets.0.lock().unwrap().is_empty());
    }
    #[test] fn a_pending_prompt_is_cancelled_by_abort_and_by_timeout() {
        let path = temp(); let secrets = Arc::new(Memory::default());
        let mut hanging = env(&path, secrets.clone(), false, Ok(()), true);
        let slot = Arc::new(Slot::default());
        hanging.limits = (Duration::from_secs(10), Duration::from_secs(10));
        run(async {
            let body = request("create", 5, options(json!({})));
            let started = handle(&hanging, &slot, Ok(site()), &body);
            let cancel = async { tokio::time::sleep(Duration::from_millis(50)).await; slot.cancel(5); };
            let (reply, _) = tokio::join!(started, cancel);
            assert_eq!(parsed(&reply)["name"], ABORT);
        });
        assert!(slot.begin(6).is_some()); // The slot is free again.
        drop(slot);
        // With nobody cancelling, the same hung prompt ends at the timeout.
        hanging.limits = (Duration::from_millis(100), Duration::from_millis(100));
        let reply = parsed(&run(handle(&hanging, &Arc::new(Slot::default()), Ok(site()), &request("create", 1, options(json!({"timeout": 1}))))));
        assert_eq!((reply["name"].clone(), reply["message"].clone()), (json!(NOT_ALLOWED), json!("The operation timed out")));
        assert!(secrets.0.lock().unwrap().is_empty() && !path.exists());
    }
}
