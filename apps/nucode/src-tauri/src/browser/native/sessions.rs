//! Session secrets never enter browser state, diagnostics, or the control protocol.
use block2::RcBlock;
use objc2::{rc::Retained, runtime::{AnyObject, ProtocolObject}, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_foundation::{NSArray, NSDate, NSDictionary, NSHTTPCookie, NSObject, NSObjectProtocol, NSString, NSURL, NSUUID};
use objc2_web_kit::{WKHTTPCookieStore, WKHTTPCookieStoreObserver, WKWebView, WKWebsiteDataStore};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, collections::BTreeMap, path::PathBuf, ptr::NonNull, sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc, Mutex, Weak}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tokio::sync::{oneshot, Notify, OnceCell};

const MAX_AGE: u64 = 7 * 24 * 60 * 60;
const TIMEOUT: Duration = Duration::from_secs(3);
// Also covers blocking Keychain calls that outlive an async timeout.
static KEYCHAIN: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    saved_at: u64,
    cookies: Vec<BTreeMap<String, String>>,
}
impl Snapshot {
    fn encode(cookies: Vec<BTreeMap<String, String>>, now: u64) -> Result<String, ()> {
        serde_json::to_string(&Self { saved_at: now, cookies }).map_err(|_| ())
    }
    fn decode(json: &str, now: u64) -> Result<Self, ()> {
        let snapshot: Self = serde_json::from_str(json).map_err(|_| ())?;
        if now.checked_sub(snapshot.saved_at).is_none_or(|age| age > MAX_AGE) { return Err(()); }
        for cookie in &snapshot.cookies {
            if !["Name", "Value", "Domain", "Path"].iter().all(|key| cookie.contains_key(*key))
                || cookie.keys().any(|key| !matches!(key.as_str(), "Name" | "Value" | "Domain" | "Path" | "Secure" | "HttpOnly" | "SameSite" | "OriginURL" | "Port" | "Version" | "Discard"))
            { return Err(()); }
        }
        Ok(snapshot)
    }
}
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn entry() -> Result<keyring::Entry, ()> { keyring::Entry::new("dev.nucode.browser-sessions", "session-cookies").map_err(|_| ()) }
fn delete() -> Result<(), ()> {
    match entry()?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(_) => Err(()) }
}

fn properties(cookie: &NSHTTPCookie) -> BTreeMap<String, String> {
    let mut values = BTreeMap::from([
        ("Name".into(), cookie.name().to_string()), ("Value".into(), cookie.value().to_string()),
        ("Domain".into(), cookie.domain().to_string()), ("Path".into(), cookie.path().to_string()),
        ("Version".into(), cookie.version().to_string()), ("Discard".into(), "TRUE".into()),
    ]);
    if cookie.isSecure() { values.insert("Secure".into(), "TRUE".into()); }
    if cookie.isHTTPOnly() { values.insert("HttpOnly".into(), "TRUE".into()); }
    if let Some(policy) = cookie.sameSitePolicy() { values.insert("SameSite".into(), policy.to_string()); }
    // WebKit reports [] for ordinary cookies; Foundation turns an empty Port into port 0, which matches nothing.
    let ports = cookie.portList().map(|ports| ports.iter().map(|port| port.stringValue().to_string()).collect::<Vec<_>>().join(",")).unwrap_or_default();
    if !no_port(&ports) { values.insert("Port".into(), ports); }
    if let Some(props) = cookie.properties() {
        if let Some(origin) = props.objectForKey(unsafe { objc2_foundation::NSHTTPCookieOriginURL }) {
            if let Some(url) = origin.downcast_ref::<NSURL>().and_then(|url| url.absoluteString()) {
                values.insert("OriginURL".into(), url.to_string());
            } else if let Some(url) = origin.downcast_ref::<NSString>() {
                values.insert("OriginURL".into(), url.to_string());
            }
        }
    }
    values
}
fn no_port(ports: &str) -> bool { ports.split(',').all(|port| matches!(port.trim(), "" | "0")) }
fn cookie(values: &BTreeMap<String, String>) -> Option<Retained<NSHTTPCookie>> {
    // Snapshots saved before the Port fix carry Port="" or "0".
    let values: BTreeMap<_, _> = values.iter().filter(|(key, value)| !(key.as_str() == "Port" && no_port(value))).collect();
    let keys: Vec<_> = values.keys().map(|key| NSString::from_str(key)).collect();
    let values: Option<Vec<Retained<AnyObject>>> = values.iter().map(|(key, value)| unsafe {
        let string = NSString::from_str(value);
        if key.as_str() == "OriginURL" { NSURL::URLWithString(&string).map(|url| Retained::cast_unchecked(url)) }
        else { Some(Retained::cast_unchecked(string)) }
    }).collect();
    let values = values?;
    let dict = NSDictionary::from_slices(&keys.iter().map(|key| &**key).collect::<Vec<_>>(),
        &values.iter().map(|value| &**value as &AnyObject).collect::<Vec<_>>());
    unsafe { NSHTTPCookie::cookieWithProperties(&dict) }
}
thread_local! {
    // Session cookies live only as long as the store object: keep the one restore writes into for the tabs.
    static LIVE: RefCell<Option<Retained<WKWebsiteDataStore>>> = const { RefCell::new(None) };
}
unsafe fn store() -> Retained<WKWebsiteDataStore> {
    LIVE.with(|live| live.borrow_mut().get_or_insert_with(|| {
        WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(super::STORE), MainThreadMarker::new().expect("WebKit main thread"))
    }).clone())
}

objc2::define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Weak<Sessions>]
    struct Observer;
    unsafe impl NSObjectProtocol for Observer {}
    unsafe impl WKHTTPCookieStoreObserver for Observer {
        #[unsafe(method(cookiesDidChangeInCookieStore:))]
        unsafe fn changed(&self, _store: &WKHTTPCookieStore) {
            if let Some(sessions) = self.ivars().upgrade() { sessions.changed.notify_one(); }
        }
    }
);
thread_local! {
    // WebKit does not retain its observers. Keep both on the main thread.
    static OBSERVER: RefCell<Option<(Retained<WKHTTPCookieStore>, Retained<Observer>)>> = const { RefCell::new(None) };
}

pub struct Sessions {
    app: tauri::AppHandle,
    path: PathBuf,
    restored: OnceCell<()>,
    operation: tokio::sync::Mutex<()>,
    generation: AtomicU64,
    ready: AtomicBool,
    changed: Notify,
    saved: Mutex<Option<u64>>,
}
impl Sessions {
    pub fn new(app: tauri::AppHandle, path: PathBuf) -> Arc<Self> {
        let sessions = Arc::new(Self { app, path, restored: OnceCell::new(), operation: tokio::sync::Mutex::new(()), generation: AtomicU64::new(0), ready: AtomicBool::new(false), changed: Notify::new(), saved: Mutex::new(None) });
        let weak = Arc::downgrade(&sessions);
        let mut enabled = sessions.enabled();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            let mut deadline = None;
            let mut disabled = false;
            let mut ticks = 0u32;
            loop {
                let Some(sessions) = weak.upgrade() else { break; };
                tokio::select! {
                    _ = sessions.changed.notified() => { deadline = Some(tokio::time::Instant::now() + TIMEOUT); }
                    _ = tokio::time::sleep_until(deadline.unwrap_or_else(|| tokio::time::Instant::now() + Duration::from_secs(86400))), if deadline.is_some() => {
                        deadline = None;
                        let _ = sessions.save().await;
                    }
                    _ = interval.tick() => {
                        ticks = ticks.wrapping_add(1);
                        if ticks % 60 == 0 && sessions.ready.load(Ordering::SeqCst) && deadline.is_none() { deadline = Some(tokio::time::Instant::now()); }
                        // Settings can change while the browser pane is closed or CDP is selected.
                        if let Ok(settings) = crate::storage::read_settings(&sessions.path) {
                            if !settings.browser.keep_sessions && !disabled {
                                disabled = sessions.forget().await.is_ok();
                                deadline = None;
                            } else if settings.browser.keep_sessions { disabled = false; }
                            let active = settings.browser.keep_sessions && !settings.browser.private_browsing;
                            if active && !enabled {
                                sessions.prepare().await;
                                sessions.changed.notify_one();
                            }
                            enabled = active;
                        }
                    }
                }
            }
        });
        sessions
    }
    pub fn notify(&self) { self.changed.notify_one(); }
    /// Adopt the first live tab's data store for saving and change observation.
    pub fn remember(self: &Arc<Self>, view: &tauri::Webview) {
        let weak = Arc::downgrade(self);
        let _ = view.with_webview(move |platform| unsafe {
            let wk = &*(platform.inner() as *const WKWebView);
            let live = wk.configuration().websiteDataStore();
            if LIVE.with(|slot| slot.borrow().is_some()) { return; }
            LIVE.with(|slot| *slot.borrow_mut() = Some(live.clone()));
            OBSERVER.with(|slot| {
                let cookies = live.httpCookieStore();
                let allocated = Observer::alloc(MainThreadMarker::new().unwrap()).set_ivars(weak);
                let observer: Retained<Observer> = objc2::msg_send![super(allocated), init];
                cookies.addObserver(ProtocolObject::from_ref(&*observer));
                *slot.borrow_mut() = Some((cookies, observer));
            });
        });
    }
    fn enabled(&self) -> bool {
        super::macos::persistent_store_available() && crate::storage::read_settings(&self.path)
            .is_ok_and(|settings| settings.browser.keep_sessions && !settings.browser.private_browsing)
    }
    fn valid(&self, generation: u64) -> bool { self.generation.load(Ordering::SeqCst) == generation && self.enabled() }

    pub async fn prepare(self: &Arc<Self>) {
        if !self.enabled() { return; }
        if self.ready.load(Ordering::SeqCst) { return; }
        let Ok(_operation) = tokio::time::timeout(TIMEOUT, self.operation.lock()).await else { return; };
        if !self.enabled() { return; }
        self.restored.get_or_init(|| async {
            // Timeout cancels pending reads/dispatch; queued main-thread work checks its receiver.
            let _ = tokio::time::timeout(TIMEOUT, self.restore()).await;
        }).await;
        if !self.enabled() { return; }
        let weak = Arc::downgrade(self);
        let (tx, rx) = oneshot::channel();
        if self.app.run_on_main_thread(move || unsafe {
            if tx.is_closed() { return; }
            OBSERVER.with(|slot| {
                if slot.borrow().is_none() {
                    let cookies = store().httpCookieStore();
                    let allocated = Observer::alloc(MainThreadMarker::new().unwrap()).set_ivars(weak);
                    let observer: Retained<Observer> = objc2::msg_send![super(allocated), init];
                    cookies.addObserver(ProtocolObject::from_ref(&*observer));
                    *slot.borrow_mut() = Some((cookies, observer));
                }
            });
            let _ = tx.send(());
        }).is_ok() && tokio::time::timeout(TIMEOUT, rx).await.is_ok_and(|result| result.is_ok()) {
            self.ready.store(true, Ordering::SeqCst);
        }
    }
    async fn restore(self: &Arc<Self>) -> Result<(), ()> {
        let sessions = self.clone();
        let generation = self.generation.load(Ordering::SeqCst);
        let snapshot = tauri::async_runtime::spawn_blocking(move || {
            let _lock = KEYCHAIN.lock().map_err(|_| ())?;
            if !sessions.valid(generation) { return Err(()); }
            let json = match entry()?.get_password() {
                Ok(json) => json, Err(keyring::Error::NoEntry) => return Ok(None), Err(_) => return Err(()),
            };
            match Snapshot::decode(&json, now()) { Ok(snapshot) => Ok(Some(snapshot)), Err(()) => { delete()?; Ok(None) } }
        }).await.map_err(|_| ())??;
        let Some(snapshot) = snapshot else { return Ok(()); };
        let sessions = self.clone();
        let (tx, rx) = oneshot::channel();
        self.app.run_on_main_thread(move || unsafe {
            if tx.is_closed() || !sessions.valid(generation) { return; }
            let cookies = store().httpCookieStore();
            let remaining = std::rc::Rc::new(std::cell::Cell::new(snapshot.cookies.len()));
            let done = std::rc::Rc::new(RefCell::new(Some(tx)));
            for values in snapshot.cookies {
                let remaining = remaining.clone();
                let done = done.clone();
                let completion = RcBlock::new(move || {
                    remaining.set(remaining.get() - 1);
                    if remaining.get() == 0 { if let Some(tx) = done.borrow_mut().take() { let _ = tx.send(()); } }
                });
                if let Some(cookie) = cookie(&values) { cookies.setCookie_completionHandler(&cookie, Some(&completion)); }
                else { completion.call(()); }
            }
            if remaining.get() == 0 { if let Some(tx) = done.borrow_mut().take() { let _ = tx.send(()); } }
        }).map_err(|_| ())?;
        rx.await.map_err(|_| ())
    }
    pub async fn save(self: &Arc<Self>) -> Result<(), ()> {
        // An immediate quit after opting out must also delete the saved item.
        if crate::storage::read_settings(&self.path).is_ok_and(|settings| !settings.browser.keep_sessions) {
            return self.forget().await;
        }
        let _operation = self.operation.lock().await;
        if !self.ready.load(Ordering::SeqCst) || !self.enabled() { return Ok(()); }
        let generation = self.generation.load(Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.app.run_on_main_thread(move || unsafe {
            if tx.is_closed() { return; }
            let tx = RefCell::new(Some(tx));
            store().httpCookieStore().getAllCookies(&RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
                if let Some(tx) = tx.borrow_mut().take() {
                    let values = cookies.as_ref().iter().filter(|cookie| cookie.isSessionOnly()).map(|cookie| properties(&cookie)).collect::<Vec<_>>();
                    let _ = tx.send(values);
                }
            }));
        }).map_err(|_| ())?;
        let values = tokio::time::timeout(TIMEOUT, rx).await.map_err(|_| ())?.map_err(|_| ())?;
        let sessions = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _lock = KEYCHAIN.lock().map_err(|_| ())?;
            if !sessions.valid(generation) { return Ok(()); }
            if values.is_empty() { *sessions.saved.lock().map_err(|_| ())? = None; return delete(); }
            let hash = { use std::hash::{Hash, Hasher}; let mut h = std::collections::hash_map::DefaultHasher::new(); values.hash(&mut h); h.finish() };
            if *sessions.saved.lock().map_err(|_| ())? == Some(hash) { return Ok(()); }
            entry()?.set_password(&Snapshot::encode(values, now())?).map_err(|_| ())?;
            *sessions.saved.lock().map_err(|_| ())? = Some(hash);
            Ok(())
        }).await.map_err(|_| ())?
    }
    pub async fn forget(self: &Arc<Self>) -> Result<(), ()> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut saved) = self.saved.lock() { *saved = None; }
        let _operation = self.operation.lock().await;
        // Do not restore a forgotten item if no browser view has been created yet.
        let _ = self.restored.set(());
        tauri::async_runtime::spawn_blocking(|| {
            let _lock = KEYCHAIN.lock().map_err(|_| ())?;
            delete()
        }).await.map_err(|_| ())?
    }
    pub async fn clear(self: &Arc<Self>) -> Result<(), ()> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut saved) = self.saved.lock() { *saved = None; }
        let _operation = self.operation.lock().await;
        self.ready.store(false, Ordering::SeqCst);
        let _ = self.restored.set(());
        // Delete first, even if WebKit clearing fails. Clear the persistent store also in private mode.
        tauri::async_runtime::spawn_blocking(|| {
            let _lock = KEYCHAIN.lock().map_err(|_| ())?;
            delete()
        }).await.map_err(|_| ())??;
        if !super::macos::persistent_store_available() { return Ok(()); }
        let (tx, rx) = oneshot::channel();
        self.app.run_on_main_thread(move || unsafe {
            if tx.is_closed() { return; }
            let tx = RefCell::new(Some(tx));
            store().removeDataOfTypes_modifiedSince_completionHandler(
                &WKWebsiteDataStore::allWebsiteDataTypes(MainThreadMarker::new().unwrap()), &NSDate::distantPast(),
                &RcBlock::new(move || { if let Some(tx) = tx.borrow_mut().take() { let _ = tx.send(()); } }),
            );
        }).map_err(|_| ())?;
        tokio::time::timeout(TIMEOUT, rx).await.map_err(|_| ())?.map_err(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fake() -> BTreeMap<String, String> {
        [("Name", "fake-session"), ("Value", "fake-secret"), ("Domain", ".example.test"), ("Path", "/"), ("Secure", "TRUE"), ("HttpOnly", "TRUE"), ("SameSite", "lax"), ("OriginURL", "https://example.test"), ("Version", "1"), ("Port", "443"), ("Discard", "TRUE")].into_iter().map(|(k, v)| (k.into(), v.into())).collect()
    }
    #[test]
    fn round_trip_and_age_boundary() {
        let values = vec![fake()];
        let json = Snapshot::encode(values.clone(), 100).unwrap();
        assert_eq!(Snapshot::decode(&json, 100 + MAX_AGE).unwrap().cookies, values);
        assert!(Snapshot::decode(&json, 101 + MAX_AGE).is_err());
        assert!(Snapshot::decode(&json, 99).is_err());
        assert!(Snapshot::decode("invalid", 100).is_err());
        assert!(Snapshot::decode(&Snapshot::encode(vec![], 100).unwrap(), 100).unwrap().cookies.is_empty());
    }
    #[test]
    fn rejects_invalid_or_persistent_properties() {
        let mut values = fake(); values.remove("Domain");
        assert!(Snapshot::decode(&Snapshot::encode(vec![values], 100).unwrap(), 100).is_err());
        let mut values = fake(); values.insert("Expires".into(), "tomorrow".into());
        assert!(Snapshot::decode(&Snapshot::encode(vec![values], 100).unwrap(), 100).is_err());
    }
    #[test]
    fn foundation_preserves_cookie_security_properties() {
        let original = fake();
        let cookie = cookie(&original).unwrap();
        assert!(cookie.isSessionOnly()); assert!(cookie.isSecure()); assert!(cookie.isHTTPOnly());
        let restored = properties(&cookie);
        for key in ["Name", "Value", "Domain", "Path", "SameSite", "Port"] { assert_eq!(restored.get(key), original.get(key)); }
        // Foundation may consume OriginURL when canonicalizing a cookie with an explicit domain.
        // All properties exposed by Foundation must survive the next native reconstruction.
        assert_eq!(properties(&super::cookie(&restored).unwrap()), restored);
    }
    #[test]
    fn empty_port_list_is_not_a_port_restriction() {
        for port in ["", "0"] {
            let mut values = fake(); values.insert("Port".into(), port.into());
            assert!(!properties(&cookie(&values).unwrap()).contains_key("Port"));
        }
    }
    #[test]
    fn old_settings_keep_sessions_by_default() {
        let settings: crate::types::BrowserSettings = serde_json::from_str("{}").unwrap();
        assert!(settings.keep_sessions);
        let settings: crate::types::BrowserSettings = serde_json::from_str(r#"{"keepSessions":false}"#).unwrap();
        assert!(!settings.keep_sessions);
    }
}
