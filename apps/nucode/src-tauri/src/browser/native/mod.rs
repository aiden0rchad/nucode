#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(target_os = "macos")]
mod navigation_events;
#[cfg(target_os = "macos")]
mod popup;
#[cfg(target_os = "macos")]
mod sessions;
pub use super::policy;

use super::backend::BrowserBackend;
use futures_util::future::BoxFuture;
use policy::{allowed_origin, automation_allowed, label, navigation, Navigation, Rect};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent},
    AppHandle, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl,
};
use tokio::sync::watch;

const STORE: [u8; 16] = *b"nucode-browser01";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
/// Main window state placement needs: UI zoom, whether it is on screen, content size in points.
struct MainFrame { zoom: f64, visible: bool, width: f64, height: f64 }
struct Views {
    live: Vec<String>,
    hook_keys: HashMap<String, String>,
    shown: Option<String>,
    placement: policy::Placement,
    last_poll: Instant,
    private: bool,
}
impl Views {
    fn creation_failed(&mut self, state: &watch::Sender<Value>, id: &str, error: &str) {
        self.live.retain(|entry| entry != id);
        self.hook_keys.remove(id);
        if self.shown.as_deref() == Some(id) { self.shown = None; }
        update(state, id, json!({"ready":false,"loading":false,"progress":0,"error":format!("Could not open this tab: {error}. Choose Retry to try again.")}));
    }
}
pub struct NativeBackend {
    #[cfg(target_os = "macos")]
    sessions: Arc<sessions::Sessions>,
    app: AppHandle,
    state: watch::Sender<Value>,
    views: tokio::sync::Mutex<Views>,
    downloads: Arc<Mutex<HashSet<String>>>,
    pending: Arc<Mutex<Option<super::passwords::Pending>>>,
    password_index: Arc<Mutex<()>>,
    settings_path: std::path::PathBuf,
}
impl NativeBackend {
    pub fn new(
        app: AppHandle,
        state: watch::Sender<Value>,
        settings_path: std::path::PathBuf,
    ) -> Self {
        Self {
            #[cfg(target_os = "macos")]
            sessions: sessions::Sessions::new(app.clone(), settings_path.clone()),
            app,
            state,
            views: tokio::sync::Mutex::new(Views {
                live: vec![],
                hook_keys: HashMap::new(),
                shown: None,
                placement: policy::Placement::default(),
                last_poll: Instant::now(),
                private: false,
            }),
            downloads: Arc::default(),
            pending: Arc::new(Mutex::new(None)),
            password_index: Arc::new(Mutex::new(())),
            settings_path,
        }
    }
    fn settings(&self) -> Result<super::Settings, String> {
        Ok(crate::storage::read_settings(&self.settings_path)?.browser)
    }
    fn active(&self) -> String {
        self.state.borrow()["active"].as_str().unwrap_or("").into()
    }
    fn tab(&self, id: &str) -> Option<Value> {
        self.state.borrow()["tabs"]
            .as_array()?
            .iter()
            .find(|t| t["id"] == id)
            .cloned()
    }
    fn update(&self, id: &str, values: Value) {
        update(&self.state, id, values);
    }
    fn add_tab(&self, url: &str) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.state.send_modify(|s| {
            if !s["tabs"].is_array() {
                s["tabs"] = json!([]);
            }
            s["tabs"]
                .as_array_mut()
                .unwrap()
                .push(json!({"id":id,"url":url,"title":"New tab","loading":true,"ready":false}));
            s["active"] = json!(id);
        });
        id
    }
    async fn hide(&self, views: &mut Views) -> Result<(), String> {
        if let Some(id) = views.shown.take() {
            self.update(&id, json!({"snapshot":null}));
            if let Some(view) = self.app.get_webview(&label(&id)?) {
                #[cfg(target_os = "macos")]
                if self.tab(&id).is_some_and(|t| t["error"].is_null() && t["credentialsPaused"] != true) && macos::sensitive(&view).await == Ok(false) {
                    if let Ok(image) = macos::image(&view).await {
                        if macos::sensitive(&view).await == Ok(false) { self.update(&id, json!({"snapshot":image})); }
                    }
                }
                #[cfg(target_os = "macos")]
                {
                    if macos::owns_focus(&view).await? {
                        if let Some(main) = self.app.get_webview("main") {
                            main.set_focus().map_err(|e| e.to_string())?;
                        }
                    }
                    macos::expose_accessibility(&view, false).await?;
                    // Keep WebKit's viewport/scroll while the parent clips the
                    // parked view. NSView.setHidden collapses its layout viewport.
                    view.set_position(LogicalPosition::new(-32000., -32000.))
                        .map_err(|e| e.to_string())?;
                }
                #[cfg(not(target_os = "macos"))]
                view.hide().map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    async fn view(&self, id: &str, views: &mut Views) -> Result<Webview, String> {
        let name = label(id)?;
        if let Some(view) = self.app.get_webview(&name) {
            policy::touch(&mut views.live, id);
            return Ok(view);
        }
        self.update(id, json!({"error":null,"ready":false,"loading":true}));
        let mut stage = "configuration";
        let valid = Arc::new(AtomicBool::new(true));
        let result = self.create_view(id, views, &mut stage, valid.clone()).await;
        if let Err(error) = &result {
            valid.store(false, Ordering::Release);
            // A partially configured child must not be reused on Retry.
            if let Some(view) = self.app.get_webview(&name) { let _ = close_view(view); }
            views.creation_failed(&self.state, id, error);
            // Stage names contain no URL, page content or platform error text.
            nucode_diag_mcp::writer::metadata("error", "browser", "browser.native.create_failed", json!({"errorClass":stage}));
        }
        result
    }
    async fn create_view(&self, id: &str, views: &mut Views, stage: &mut &'static str, valid: Arc<AtomicBool>) -> Result<Webview, String> {
        injected_fault(stage)?;
        let name = label(id)?;
        let tab = self.tab(id).ok_or("Unknown browser tab")?;
        let url = tab["url"].as_str().unwrap_or("about:blank");
        if navigation(url, url) != Navigation::Allow {
            return Err("Navigation blocked".into());
        }
        if let Some(evicted) = policy::touch(&mut views.live, id) {
            if let Some(view) = self.app.get_webview(&label(&evicted)?) {
                close_view(view)?;
            }
            views.hook_keys.remove(&evicted);
            self.update(&evicted, json!({"ready":false}));
        }
        let settings = self.settings()?;
        #[cfg(target_os = "macos")]
        self.sessions.prepare().await;
        let state = self.state.clone();
        let tab_id = id.to_string();
        #[cfg(target_os = "macos")]
        let loaded_sessions = self.sessions.clone();
        // on_navigation publishes the next URL before on_page_load starts.
        let page_url = Mutex::new(url.to_string());
        let title_state = self.state.clone();
        let title_id = id.to_string();
        let nav_state = self.state.clone();
        let nav_id = id.to_string();
        let new_state = self.state.clone();
        let new_settings = settings.clone();
        let new_app = self.app.clone();
        let download_state = self.state.clone();
        let download_valid = valid.clone();
        let downloads = self.downloads.clone();
        let downloads_dir = self.app.path().download_dir().map_err(|e| e.to_string())?;
        let hook_key = uuid::Uuid::new_v4().to_string();
        let mut builder = WebviewBuilder::new(&name, WebviewUrl::External("about:blank".parse().expect("blank URL")))
            .user_agent(UA).devtools(cfg!(debug_assertions)).focused(false)
            // Keep WebKit's page background: Wry's color override disables it on macOS.
            .incognito(settings.private_browsing)
            .initialization_script(format!("({})({});", include_str!("page_hooks.js"), json!(hook_key)))
            .on_navigation(move |url| {
                let current = nav_state.borrow()["tabs"].as_array().and_then(|tabs|tabs.iter().find(|t|t["id"] == nav_id)).and_then(|t|t["url"].as_str()).unwrap_or("about:blank").to_string();
                match navigation(url.as_str(), &current) {
                    Navigation::Allow if allowed_origin(url, &settings) => { update(&nav_state,&nav_id,json!({"url":url.as_str()})); true },
                    Navigation::External => { nav_state.send_modify(|s|s["externalRequest"] = json!(url.as_str())); false },
                    _ => { update(&nav_state,&nav_id,json!({"error":"Navigation blocked by browser policy"})); false },
                }
            })
            .on_page_load(move |_view, payload| {
                let finished = matches!(payload.event(),PageLoadEvent::Finished);
                let mut previous = page_url.lock().unwrap();
                let values = page_load_values(&previous, payload.url(), finished);
                *previous = payload.url().to_string();
                update_if(&state,&tab_id,values, || valid.load(Ordering::Acquire));
                // Sign-ins finish with a page load; WebKit's cookie observer doesn't fire reliably.
                #[cfg(target_os = "macos")]
                if finished { loaded_sessions.notify(); }
            })
            .on_document_title_changed(move |_view,title|update(&title_state,&title_id,json!({"title":title})))
            .on_new_window(move |url,features| {
                match navigation(url.as_str(),url.as_str()) {
                    Navigation::Allow if allowed_origin(&url, &new_settings) => {
                        if policy::opens_popup(url.as_str(), features.size().is_some(), features.position().is_some()) {
                            let result = (|| -> tauri::Result<tauri::WebviewWindow> {
                                let nav_state = new_state.clone();
                                let nav_settings = new_settings.clone();
                                let current = Mutex::new(url.to_string());
                                let nested_state = new_state.clone();
                                let nested_settings = new_settings.clone();
                                let mut builder = tauri::WebviewWindowBuilder::new(
                                    &new_app, format!("browser-popup-{}", uuid::Uuid::new_v4().simple()),
                                    WebviewUrl::External("about:blank".parse().expect("valid blank URL")),
                                ).inner_size(500., 640.);
                                if features.position().is_none() { builder = builder.center(); }
                                builder = builder.resizable(true).title(url.host_str().unwrap_or("Sign in"))
                                    .user_agent(UA).devtools(cfg!(debug_assertions)).focused(true);
                                // multiwebview-ok: optional, with the plain-window fallback below.
                                if let Some(main) = new_app.get_webview_window("main") {
                                    builder = builder.parent(&main)?;
                                } else {
                                    // Adding browser child views makes main cease to be a WebviewWindow.
                                    #[cfg(target_os = "macos")]
                                    if let Some(main) = new_app.get_window("main") { builder = builder.parent_raw(main.ns_window()?); }
                                }
                                let window = builder.window_features(features)
                                    .on_document_title_changed(|window, title| { let _ = window.set_title(&title); })
                                    .on_navigation(move |url| {
                                        let Ok(mut current) = current.lock() else { return false; };
                                        match navigation(url.as_str(), &current) {
                                            Navigation::Allow if allowed_origin(url, &nav_settings) => { *current = url.to_string(); true },
                                            Navigation::External => { nav_state.send_modify(|s|s["externalRequest"] = json!(url.as_str())); false },
                                            _ => false,
                                        }
                                    })
                                    .on_new_window(move |url, _| {
                                        match navigation(url.as_str(), url.as_str()) {
                                            Navigation::Allow if allowed_origin(&url, &nested_settings) => { nested_state.send_modify(|s|s["newWindow"] = json!(url.as_str())); },
                                            Navigation::External => { nested_state.send_modify(|s|s["externalRequest"] = json!(url.as_str())); },
                                            _ => (),
                                        }
                                        NewWindowResponse::Deny
                                    }).build()?;
                                #[cfg(target_os = "macos")]
                                if let Err(error) = popup::install(&window) {
                                    let _ = window.destroy();
                                    return Err(error);
                                }
                                Ok(window)
                            })();
                            match result {
                                Ok(window) => {
                                    new_state.send_modify(|s| s["lastPopup"] = json!({"url":url.as_str(),"id":window.label()}));
                                    return NewWindowResponse::Create { window };
                                },
                                Err(_) => nucode_diag_mcp::writer::metadata("error", "browser", "browser.native.popup_failed", json!({})),
                            }
                        }
                        new_state.send_modify(|s|s["newWindow"] = json!(url.as_str()));
                    },
                    Navigation::External => { new_state.send_modify(|s|s["externalRequest"] = json!(url.as_str())); },
                    _ => (),
                }
                NewWindowResponse::Deny
            })
            .on_download(move |view,event| match event {
                DownloadEvent::Requested { url,destination } => {
                    if !download_valid.load(Ordering::Acquire) { return false; }
                    update_if(&download_state, view.label().trim_start_matches("browser-"), json!({"ready":true,"loading":false,"error":null}), || download_valid.load(Ordering::Acquire));
                    if downloads.lock().unwrap().remove(url.as_str()) {
                        let name = destination.file_name().unwrap_or(std::ffi::OsStr::new("download"));
                        let mut path = downloads_dir.join(name);
                        if path.exists() { path = downloads_dir.join(format!("{}-{}",uuid::Uuid::new_v4(),name.to_string_lossy())); }
                        *destination = path; true
                    } else { download_state.send_modify(|s|s["downloadRequest"] = json!(url.as_str())); false }
                },
                DownloadEvent::Finished {url,success,..} => { download_state.send_modify(|s|s["download"] = json!({"url":url.as_str(),"success":success})); true },
                _ => false,
            });
        #[cfg(target_os = "macos")]
        {
            builder = if macos::persistent_store_available() && !views.private {
                builder.data_store_identifier(STORE)
            } else {
                builder.incognito(true)
            };
        }
        #[cfg(target_os = "windows")]
        {
            builder = builder.data_directory(
                self.settings_path
                    .parent()
                    .ok_or("Missing data directory")?
                    .join("browser/native-webview2"),
            );
        }
        *stage = "window";
        injected_fault(stage)?;
        let window = self
            .app
            .get_window("main")
            .ok_or("Main window unavailable")?;
        // Create offscreen: no white flash before first load or before hide is processed.
        *stage = "webview";
        injected_fault(stage)?;
        let view = window
            .add_child(
                builder,
                LogicalPosition::new(-32000., -32000.),
                LogicalSize::new(800., 600.),
            )
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        {
            *stage = "accessibility";
            injected_fault(stage)?;
            let path = self.settings_path.clone();
            let pending = self.pending.clone();
            let index = self.password_index.clone();
            let state = self.state.clone();
            macos::hide_app_bridge(&view).await?;
            macos::install_passwords(&view, Box::new(move |capture| {
                let _ = offer_capture(&path, &pending, &index, &state, capture);
            })).await?;
            macos::install_accessibility(&view).await?;
            self.sessions.remember(&view);
        }
        *stage = "layout";
        injected_fault(stage)?;
        if let Some(main) = self.app.get_webview("main") {
            // add_child changes the original webview's sizing semantics. Keep the
            // UI full-window; browser bounds remain controlled by place().
            let _ = main.set_auto_resize(true);
            if let Ok(size) = window.inner_size() { let _ = main.set_size(size); }
        }
        view.hide().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        {
            *stage = "navigation";
            injected_fault(stage)?;
            navigation_events::install(&view, id.to_string(), self.state.clone())?;
        }
        // The builder already loads about:blank. A second blank load would finish after a navigate issued right
        // after creation and be reported as that page being ready.
        if url != "about:blank" {
            view.navigate(url.parse().map_err(|_| "Invalid URL")?).map_err(|_| "Cannot navigate browser")?;
        }
        views.hook_keys.insert(id.into(), hook_key);
        Ok(view)
    }
    async fn main_frame(&self) -> Result<MainFrame, String> {
        #[cfg(target_os = "macos")]
        return macos::main_frame(&self.app.get_webview("main").ok_or("Main webview unavailable")?).await;
        #[cfg(not(target_os = "macos"))]
        {
            let window = self.app.get_window("main").ok_or("Main window unavailable")?;
            let size = window.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
            Ok(MainFrame { zoom: 1., visible: window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true), width: size.width, height: size.height })
        }
    }
    async fn place(&self, views: &mut Views) -> Result<(), String> {
        let id = self.active();
        let frame = self.main_frame().await?;
        let rect = views.placement.rect(&id);
        let visible = rect.is_some() && frame.visible;
        let ready = self
            .tab(&id)
            .is_some_and(|t| t["ready"] == true && t["error"].is_null());
        if !visible || !ready || views.shown.as_deref().is_some_and(|shown| shown != id) {
            self.hide(views).await?;
        }
        // A failed creation needs explicit Retry, never an unbounded poll/recreate loop.
        if !visible || id.is_empty() || self.tab(&id).is_some_and(|tab| tab["error"].is_string()) {
            return Ok(());
        }
        let view = self.view(&id, views).await?;
        if self
            .tab(&id)
            .is_some_and(|t| t["ready"] == true && t["error"].is_null())
        {
            let mut rect = rect.unwrap().scaled(frame.zoom)?;
            // Child webviews sit above HTML; leave the window resize gutter reachable.
            rect.w = rect.w.min((frame.width - 8. - rect.x).max(1.));
            rect.h = rect.h.min((frame.height - 8. - rect.y).max(1.));
            view.set_bounds(tauri::Rect {
                position: LogicalPosition::new(rect.x, rect.y).into(),
                size: LogicalSize::new(rect.w, rect.h).into(),
            })
            .map_err(|e| e.to_string())?;
            if views.shown.as_deref() != Some(&id) {
                view.show().map_err(|e| e.to_string())?;
                #[cfg(target_os = "macos")]
                macos::expose_accessibility(&view, true).await?;
                views.shown = Some(id);
            }
        }
        Ok(())
    }
    async fn action_and_settle(&self, p: Value) -> Result<Value, String> {
        let events = self.state.subscribe();
        let id = self.active();
        let before = self.tab(&id);
        let before_popup = events.borrow()["lastPopup"].clone();
        let history = matches!(p["action"].as_str(), Some("back" | "forward"));
        let result = self.dispatch(p, true).await?;
        let result = if history { self.tab(&id).unwrap_or(result) } else { result };
        Ok(match before {
            Some(before) => settle_action(events, &id, &before, &before_popup, result, Duration::from_millis(400), Duration::from_secs(15)).await,
            None => result,
        })
    }
    pub async fn ui_request(&self, p: Value) -> Result<Value, String> {
        if p["action"] == "tool" { return Err("Unknown browser action".into()); }
        self.dispatch(p, false).await
    }
    async fn command(&self, p: Value) -> Result<Value, String> {
        if matches!(p["action"].as_str(), Some("back" | "forward")) { self.action_and_settle(p).await }
        else { self.dispatch(p, true).await }
    }
    async fn dispatch(&self, p: Value, agent: bool) -> Result<Value, String> {
        super::passwords::reject_action(&p)?;
        let mut views = self.views.lock().await;
        self.check_paused(&p, agent)?;
        self.state.send_if_modified(|s| {
            let capabilities = json!({"screenshot":cfg!(target_os = "macos"),"evaluate":cfg!(target_os = "macos")});
            let changed = s["backend"] != "native" || s["capabilities"] != capabilities;
            s["backend"] = json!("native");
            s["capabilities"] = capabilities;
            changed
        });
        let settings = self.settings()?;
        self.expire_offer(settings.private_browsing || !settings.offer_to_save_passwords)?;
        if views.private != settings.private_browsing {
            close_popups(&self.app)?;
            self.hide(&mut views).await?;
            for id in views.live.drain(..) {
                if let Some(view) = self.app.get_webview(&label(&id)?) {
                    close_view(view)?;
                }
                self.update(&id, json!({"ready":false}));
            }
            views.hook_keys.clear();
            views.private = settings.private_browsing;
        }
        let action = p["action"].as_str().ok_or("Missing browser action")?;
        if action == "ensure" {
            return Ok(json!({"native":cfg!(target_os = "macos")}));
        }
        // Process popup requests for agent-only sessions too, without requiring a pane subscription.
        {
            let new_url = self.state.borrow()["newWindow"].as_str().map(String::from);
            if let Some(url) = new_url {
                self.state.send_modify(|s| s["newWindow"] = Value::Null);
                self.hide(&mut views).await?;
                let id = self.add_tab(&url);
                self.view(&id, &mut views).await?;
            }
        }
        if action == "poll" {
            self.refresh_logins()?;

            if views.last_poll.elapsed() > Duration::from_millis(250) {
                views.last_poll = Instant::now();
                let id = self.active();
                #[cfg(target_os = "macos")]
                if let Some(view) = label(&id).ok().and_then(|name| self.app.get_webview(&name)) {
                    self.pickup_password(&view).await?;
                    if let Ok(status) = macos::control(&view, "status".into()).await {
                        self.update(&id, status);
                    }
                    if self
                        .tab(&id)
                        .is_some_and(|t| t["ready"] == true && t["error"].is_null())
                    {
                        match macos::script(&view, json!({"op":"meta"})).await {
                            Ok(meta) => {
                                if meta["userInput"] == true && self.state.borrow()["agent"] == true
                                {
                                    self.state.send_modify(|s| {
                                        s["agent"] = json!(false);
                                        s["takeover"] =
                                            json!(s["takeover"].as_u64().unwrap_or(0) + 1);
                                    });
                                }
                                self.update(&id, meta);
                            }
                            Err(error) => {
                                self.update(&id,json!({"error":format!("Page unavailable: {error}. Reload to recover.")}));
                                self.hide(&mut views).await?;
                            }
                        }
                    }
                }
            }
            self.place(&mut views).await?;
            return Ok(self.state.borrow().clone());
        }
        if action == "activity" {
            self.state.send_modify(|s| s["agent"] = p["active"].clone());
            return Ok(Value::Null);
        }
        if action == "detach" {
            views.placement.detach();
            self.hide(&mut views).await?;
            return Ok(Value::Null);
        }
        if action == "reset" {
            close_popups(&self.app)?;
            views.placement.detach();
            self.hide(&mut views).await?;
            for id in views.live.drain(..) {
                if let Some(view) = self.app.get_webview(&label(&id)?) {
                    close_view(view)?;
                }
            }
            views.hook_keys.clear();
            self.state
                .send_replace(json!({"tabs":[],"active":"","agent":false}));
            return Ok(Value::Null);
        }
        if action == "clear" {
            if p["confirmed"] != true {
                return Err("Confirm clearing browsing data first".into());
            }
            close_popups(&self.app)?;
            self.hide(&mut views).await?;
            #[cfg(target_os = "macos")]
            self.clear_sessions().await?;
            // Materialize a view so persistent storage can also be cleared after restart.
            if self.active().is_empty() {
                self.add_tab("about:blank");
            }
            let view = self.view(&self.active(), &mut views).await?;
            view.clear_all_browsing_data().map_err(|e| e.to_string())?;
            for id in views.live.drain(..) {
                if let Some(view) = self.app.get_webview(&label(&id)?) {
                    close_view(view)?;
                }
            }
            views.hook_keys.clear();
            self.state
                .send_replace(json!({"backend":"native","tabs":[],"active":"","agent":false}));
            return Ok(Value::Null);
        }
        if action == "attach" || action == "bounds" || action == "resize" {
            if let Some(id) = p["tabId"].as_str() {
                label(id)?;
                if self.tab(id).is_none() {
                    return Err("Unknown browser tab".into());
                }
                if id != self.active() {
                    return Ok(Value::Null);
                }
            }
            let rect = if p["rect"].is_null() { None } else {
                Some(serde_json::from_value::<Rect>(p["rect"].clone()).map_err(|e| e.to_string())?)
            };
            views.placement.update(&self.active(), rect, p["visible"].as_bool())?;
            self.place(&mut views).await?;
            return Ok(Value::Null);
        }
        let mut action = action;
        let mut id = p["id"].as_str().map(String::from);
        if action == "tabs" {
            action = match p["params"]["action"].as_str().unwrap_or("list") {
                "list" => {
                    let state = self.state.borrow();
                    let mut tabs = state["tabs"].clone();
                    // Other browser tools act on the active tab.
                    for tab in tabs.as_array_mut().into_iter().flatten() { tab["active"] = json!(tab["id"] == state["active"]); }
                    return Ok(tabs);
                }
                "new" => "new",
                "select" => "activate",
                "close" => "close",
                _ => return Err("Unknown tabs action".into()),
            };
            if let Some(index) = p["params"]["index"].as_u64() {
                id = Some(
                    self.state.borrow()["tabs"][index as usize]["id"]
                        .as_str()
                        .ok_or("Unknown tab index")?
                        .into(),
                );
            }
        }
        if action == "new" {
            let url = new_tab_url(&p)?;
            self.hide(&mut views).await?;
            let id = self.add_tab(url);
            self.view(&id, &mut views).await?;
            self.place(&mut views).await?;
            if agent {
                let events = self.state.subscribe();
                drop(views);
                return wait_for_page(events, &id, url == "about:blank", Duration::from_secs(20)).await;
            }
            return Ok(json!({"id":id}));
        }
        if action == "activate" {
            let id = id.ok_or("Missing tab ID")?;
            label(&id)?;
            if self.tab(&id).is_none() {
                return Err("Unknown browser tab".into());
            }
            self.hide(&mut views).await?;
            self.state.send_modify(|s| s["active"] = json!(id));
            self.place(&mut views).await?;
            return Ok(Value::Null);
        }
        if action == "close" {
            let id = id.unwrap_or_else(|| self.active());
            label(&id)?;
            if id == self.active() { views.placement.detach(); }
            if views.shown.as_deref() == Some(&id) {
                self.hide(&mut views).await?;
            }
            if let Some(view) = self.app.get_webview(&label(&id)?) {
                close_view(view)?;
            }
            views.live.retain(|v| v != &id);
            views.hook_keys.remove(&id);
            self.state.send_modify(|s| {
                if let Some(tabs) = s["tabs"].as_array_mut() {
                    tabs.retain(|t| t["id"] != id);
                }
                if s["active"] == id {
                    s["active"] = s["tabs"][0]["id"]
                        .as_str()
                        .map(|s| json!(s))
                        .unwrap_or(json!(""));
                }
            });
            self.place(&mut views).await?;
            return Ok(Value::Null);
        }
        if action == "dismiss" {
            for key in ["externalRequest", "newWindow", "downloadRequest"] {
                if p["key"] == key {
                    self.state.send_modify(|s| s[key] = Value::Null);
                }
            }
            return Ok(Value::Null);
        }
        if self.active().is_empty() {
            if action != "navigate" {
                return Err("No browser page is open. Navigate to a URL first.".into());
            }
            self.add_tab("about:blank");
        }
        let id = self.active();
        if matches!(action, "screenshot" | "evaluate") { policy::check_target(&p, &id, None)?; }
        let mut view = self.view(&id, &mut views).await?;
        if agent && needs_ready_page(&p) {
            let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
            loop {
                // Materialize the view first; page events and UI commands must be able to run while waiting.
                let events = self.state.subscribe();
                drop(views);
                wait_for_page(events, &id, true, deadline.saturating_duration_since(tokio::time::Instant::now())).await?;
                views = self.views.lock().await;
                self.check_paused(&p, agent)?;
                if self.active() != id { return Err("Browser page changed; retry on the current page".into()); }
                // A concurrent command may have evicted the view while we waited.
                view = self.view(&id, &mut views).await?;
                if self.tab(&id).is_some_and(|tab| tab["ready"] == true && tab["error"].is_null()) { break; }
            }
        }
        if matches!(action, "screenshot" | "evaluate") { policy::check_target(&p, &id, Some(current_url(&view).await?.as_str()))?; }
        #[cfg(target_os = "macos")]
        if matches!(action, "evaluate" | "console" | "screenshot") && macos::sensitive(&view).await? {
            return Err(super::passwords::SENSITIVE.into());
        }
        match action {
            "navigate" | "download" => {
                let url = p["url"].as_str().ok_or("Missing URL")?;
                if navigation(
                    url,
                    self.tab(&id)
                        .as_ref()
                        .and_then(|t| t["url"].as_str())
                        .unwrap_or(""),
                ) != Navigation::Allow
                {
                    return Err("Navigation blocked".into());
                }
                if action == "download" {
                    if p["confirmed"] != true || self.state.borrow()["downloadRequest"] != url {
                        return Err("Confirm download first".into());
                    }
                    self.downloads.lock().unwrap().insert(url.into());
                    self.state
                        .send_modify(|s| s["downloadRequest"] = Value::Null);
                }
                if action == "navigate" {
                    self.update(&id, json!({"ready":false,"loading":true,"error":null}));
                }
                view.navigate(url.parse().map_err(|_| "Invalid URL")?)
                    .map_err(|e| e.to_string())?;
            }
            "reload" => {
                self.update(&id, json!({"error":null,"ready":false}));
                view.reload().map_err(|e| e.to_string())?;
            }
            "zoom" => {
                let zoom = p["value"]
                    .as_f64()
                    .filter(|v| (0.25..=5.).contains(v))
                    .ok_or("Invalid zoom")?;
                view.set_zoom(zoom).map_err(|e| e.to_string())?;
            }
            "clearSite" => {
                if p["confirmed"] != true {
                    return Err("Confirm clearing site data first".into());
                }
                let url = current_url(&view).await?;
                policy::check_target(&p, &id, Some(url.as_str()))?;
                #[cfg(target_os = "macos")]
                {
                    macos::clear_site(
                        &view,
                        url.host_str().ok_or("This page has no site data")?.into(),
                    )
                    .await?;
                }
                #[cfg(target_os = "windows")]
                return Err("Use Settings → Browser → Clear browsing data on Windows".into());
                #[cfg(target_os = "macos")]
                view.reload().map_err(|e| e.to_string())?;
            }
            #[cfg(target_os = "macos")]
            "back" | "forward" | "stop" => {
                return macos::control(&view, action.into()).await;
            }
            #[cfg(target_os = "macos")]
            "script" | "evaluate" | "console" | "dialog" => {
                let url = current_url(&view).await?;
                if action == "evaluate" { policy::check_target(&p, &id, Some(url.as_str()))?; }
                if !automation_allowed(&url, &settings) {
                    return Err("Browser origin blocked by policy".into());
                }
                if action == "evaluate" {
                    let result = macos::evaluate_page(&view, p, url.as_str()).await;
                    if macos::sensitive(&view).await? { return Err(super::passwords::SENSITIVE.into()); }
                    return result;
                }
                let key = views.hook_keys.get(&id).ok_or("Native page hooks unavailable; reload the tab")?;
                let hooks = |params: Value| json!({"function":format!("() => globalThis[{}].request({params})", json!(key))});
                if matches!(action, "console" | "dialog") {
                    let console = action == "console";
                    let result = macos::evaluate_page(&view, hooks(p), url.as_str()).await;
                    if console && macos::sensitive(&view).await? { return Err(super::passwords::SENSITIVE.into()); }
                    return result;
                }
                let snapshot = p["op"] == "snapshot";
                let mut p = p; p["expectedUrl"] = json!(url.as_str());
                if p["op"] == "click" && agent && pointer_click(&view, &p, url.as_str()).await {
                    return Ok(json!({"performed":true}));
                }
                let mut result = macos::script(&view, p).await?;
                if snapshot && !macos::sensitive(&view).await? {
                    match macos::evaluate_page(&view, hooks(json!({"action":"snapshot"})), url.as_str()).await {
                        Ok(note) => if let Some(note) = note.as_str().filter(|s| !s.is_empty()) {
                            result["dialogNote"] = json!(note.chars().take(14000).collect::<String>());
                        },
                        // A PDF or sandboxed file preview: the snapshot itself worked, its content may be outside the DOM.
                        Err(e) if e == macos::SCRIPTS_BLOCKED => result["scriptsBlocked"] = json!(true),
                        Err(e) => return Err(e),
                    }
                    if serde_json::to_vec(&result).map_err(|e| e.to_string())?.len() > 200000 {
                        return Err("Native result exceeds 200 KB".into());
                    }
                }
                return Ok(result);
            }
            #[cfg(target_os = "macos")]
            "screenshot" => {
                let url = current_url(&view).await?;
                policy::check_target(&p, &id, Some(url.as_str()))?;
                if !automation_allowed(&url, &settings) {
                    return Err("Browser origin blocked by policy".into());
                }
                let result = macos::image(&view).await?;
                if macos::sensitive(&view).await? { return Err(super::passwords::SENSITIVE.into()); }
                if current_url(&view).await? != url {
                    return Err("Page changed during capture; retry on the current page".into());
                }
                return Ok(result);
            }
            #[cfg(target_os = "macos")]
            "idle" => {
                let key = views.hook_keys.get(&id).cloned().ok_or("Native page hooks unavailable; reload the tab")?;
                drop(views);
                let idle = json!({"function":format!("() => globalThis[{}].request({{\"action\":\"idle\",\"timeout\":3000}})", json!(key))});
                // Client-side routers change the URL while loading (inbox and calendar pages); measure on the current one.
                for _ in 0..3 {
                    let url = current_url(&view).await?;
                    if !automation_allowed(&url, &settings) { return Err("Browser origin blocked by policy".into()); }
                    match macos::evaluate_page(&view, idle.clone(), url.as_str()).await {
                        Err(e) if e.starts_with("Page navigated before") => continue,
                        result => return Ok(result.unwrap_or(json!(false))),
                    }
                }
                return Ok(json!(false));
            }
            #[cfg(target_os = "macos")]
            "wait" => {
                drop(views);
                let deadline = Instant::now() + Duration::from_secs(20);
                let time = p["time"].as_f64().unwrap_or(0.);
                if !(0. ..=20.).contains(&time) {
                    return Err("Wait must be between 0 and 20 seconds".into());
                }
                tokio::time::sleep(Duration::from_secs_f64(time)).await;
                loop {
                    if self.tab(&id).is_some_and(|t| t["credentialsPaused"] == true) { return Err(super::passwords::PAUSED.into()); }
                    if macos::script(&view,json!({"op":"wait","text":p["text"],"textGone":p["textGone"],"ref":p["ref"]})).await? == true { return Ok(json!(true)); }
                    if Instant::now() >= deadline {
                        return Err("Wait timed out. Try the Headless Chromium backend (Settings → Browser)".into());
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
            #[cfg(target_os = "windows")]
            "back" | "forward" | "stop" => {
                view.eval(match action {
                    "back" => "history.back()",
                    "forward" => "history.forward()",
                    _ => "window.stop()",
                })
                .map_err(|e| e.to_string())?;
            }
            _ => return Err("Try the Headless Chromium backend (Settings → Browser)".into()),
        }
        self.place(&mut views).await?;
        Ok(Value::Null)
    }
}
impl NativeBackend {
    #[cfg(target_os = "macos")]
    pub async fn save_sessions(&self) {
        let _ = tokio::time::timeout(Duration::from_secs(3), self.sessions.save()).await;
    }
    #[cfg(target_os = "macos")]
    pub async fn clear_sessions(&self) -> Result<(), String> {
        self.sessions.clear().await.map_err(|_| "Cannot clear browser sessions".into())
    }
    fn check_paused(&self, p: &Value, agent: bool) -> Result<(), String> {
        password_gate(&self.state.borrow(), p, agent)
    }
    fn password_path(&self) -> Result<std::path::PathBuf, String> {
        Ok(self.settings_path.parent().ok_or("Missing app data directory")?.join("browser/passwords.json"))
    }
    fn expire_offer(&self, clear: bool) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|_| "Password offer unavailable")?;
        if pending.as_ref().is_some_and(|p| clear || p.expired()) {
            *pending = None;
            self.state.send_modify(|s| s["passwordOffer"] = Value::Null);
        }
        Ok(())
    }
    pub fn take_offer(&self) -> Result<Option<super::passwords::Pending>, String> {
        let mut pending = self.pending.lock().map_err(|_| "Password offer unavailable")?;
        let offer = pending.take();
        if offer.is_some() { self.state.send_modify(|s| s["passwordOffer"] = Value::Null); }
        Ok(offer.filter(|p| !p.expired()))
    }
    pub async fn resume(&self, id: &str) -> Result<(), String> {
        let _views = self.views.lock().await;
        self.tab(id).ok_or("Unknown browser tab")?;
        self.update(id, json!({"credentialsPaused":false}));
        Ok(())
    }
    fn refresh_logins(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            let _guard = self.password_index.lock().map_err(|_| "Saved passwords unavailable")?;
            self.publish_logins(&super::passwords::Index::load(&self.password_path()?)?);
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    fn publish_logins(&self, index: &super::passwords::Index) {
        self.state.send_if_modified(|s| {
            let mut changed = false;
            for tab in s["tabs"].as_array_mut().into_iter().flatten() {
                let site = super::passwords::origin(tab["url"].as_str().unwrap_or("")).unwrap_or_default();
                let logins = json!(index.matching(&site).map(|e| json!({"id":e.id,"username":e.username})).collect::<Vec<_>>());
                if tab["savedLogins"] != logins { tab["savedLogins"] = logins; changed = true; }
            }
            changed
        });
    }
}
#[cfg(target_os = "macos")]
impl NativeBackend {
    pub fn list_passwords(&self) -> Result<super::passwords::Index, String> {
        let _guard = self.password_index.lock().map_err(|_| "Saved passwords unavailable")?;
        super::passwords::Index::load(&self.password_path()?)
    }
    pub fn has_logins(&self, site: &str) -> Result<bool, String> {
        Ok(self.list_passwords()?.matching(&super::passwords::origin(site)?).next().is_some())
    }
    fn edit_passwords(&self, edit: impl FnOnce(&mut super::passwords::Index) -> Result<(), String>) -> Result<(), String> {
        let _guard = self.password_index.lock().map_err(|_| "Saved passwords unavailable")?;
        let path = self.password_path()?;
        let mut index = super::passwords::Index::load(&path)?;
        edit(&mut index)?;
        index.save(&path)?;
        self.publish_logins(&index);
        Ok(())
    }
    pub fn save_password(&self, origin: &str, username: &str, password: &str) -> Result<(), String> {
        self.edit_passwords(|index| index.put(&super::passwords::Keychain, origin, username, password))
    }
    pub fn delete_password(&self, id: &str) -> Result<(), String> {
        use super::passwords::Secrets;
        self.edit_passwords(|index| {
            if !index.entries.iter().any(|e| e.id == id) { return Err("Unknown saved login".into()); }
            super::passwords::Keychain.delete(id)?;
            index.entries.retain(|e| e.id != id);
            Ok(())
        })
    }
    pub fn unblock_password(&self, site: &str) -> Result<(), String> {
        let site = super::passwords::origin(site)?;
        self.edit_passwords(|index| { index.unblock(&site); Ok(()) })
    }
    pub fn decide_offer(&self, decision: &str) -> Result<(), String> {
        if !matches!(decision, "save" | "never" | "dismiss") { return Err("Invalid password offer decision".into()); }
        let offer = self.take_offer()?.ok_or("Password offer expired")?;
        match decision {
            "save" => self.save_password(&offer.origin, &offer.username, &offer.password),
            "never" => self.edit_passwords(|index| { index.block(offer.origin); Ok(()) }),
            _ => Ok(()),
        }
    }
    async fn pickup_password(&self, view: &Webview) -> Result<(), String> {
        let captured = match macos::password_call(view, "return JSON.stringify(globalThis.__nuPasswords.takeCaptured());", vec![]).await {
            Ok(value) => value,
            // A provisional navigation has no private world yet.
            Err(_) => return Ok(()),
        };
        offer_capture(&self.settings_path, &self.pending, &self.password_index, &self.state, captured)
    }
    pub async fn fill_saved(&self, tab_id: &str, entry_id: &str) -> Result<Value, String> {
        use super::passwords::{self, Secrets};
        let entry = self.list_passwords()?.entries.into_iter().find(|e| e.id == entry_id).ok_or("Unknown saved login")?;
        let view = self.app.get_webview(&label(tab_id)?).ok_or("Browser tab unavailable")?;
        let expected_url = current_url(&view).await?;
        if passwords::origin(expected_url.as_str())? != entry.origin { return Err("Saved login belongs to a different origin".into()); }
        if self.settings()?.require_auth_to_fill { passwords::authenticate(expected_url.host_str().ok_or("Invalid login origin")?).await?; }
        let _views = self.views.lock().await;
        let view = self.app.get_webview(&label(tab_id)?).ok_or("Browser tab unavailable")?;
        if current_url(&view).await? != expected_url || self.tab(tab_id).is_none_or(|t| t["ready"] != true) {
            return Err("Page changed while authenticating; try again".into());
        }
        let password = passwords::Keychain.get(entry_id)?.ok_or("Saved password unavailable")?;
        self.update(tab_id, json!({"credentialsPaused":true,"snapshot":null}));
        let result = macos::password_call(&view,
            "if (location.origin !== origin || location.href !== url) throw new Error('Page changed'); return JSON.stringify(globalThis.__nuPasswords.fill(username, password));",
            vec![("origin", entry.origin), ("url", expected_url.to_string()), ("username", entry.username), ("password", password)],
        ).await;
        // On an ambiguous failure remain paused: DOM setters may already have run.
        let result = result?;
        if result["filled"] != true { self.update(tab_id, json!({"credentialsPaused":false})); }
        else { self.edit_passwords(|index| {
            if let Some(entry) = index.entries.iter_mut().find(|e| e.id == entry_id) { entry.last_used_at = Some(passwords::now()); }
            Ok(())
        })?; }
        Ok(json!({"filled":result["filled"] == true,"username":result["username"] == true}))
    }
}
impl BrowserBackend for NativeBackend {
    fn snapshot_on_page_change(&self) -> bool { true }
    fn authorize_tool(&self, args: Value) -> BoxFuture<'_, Result<(), String>> {
        Box::pin(async move {
            let _views = self.views.lock().await;
            self.check_paused(&json!({"action":"tool","tabId":args["tabId"]}), true)
        })
    }
    fn click(&self, reference: &str) -> BoxFuture<'_, Result<Value, String>> {
        Box::pin(self.action_and_settle(json!({"action":"script","op":"click","ref":reference})))
    }
    fn type_text(&self, reference: &str, text: &str, submit: bool) -> BoxFuture<'_, Result<Value, String>> {
        Box::pin(self.action_and_settle(json!({"action":"script","op":"type","ref":reference,"text":text,"submit":submit})))
    }
    fn press(&self, key: &str) -> BoxFuture<'_, Result<Value, String>> {
        Box::pin(self.action_and_settle(json!({"action":"script","op":"press","key":key})))
    }
    fn select(&self, reference: &str, values: Value) -> BoxFuture<'_, Result<Value, String>> {
        Box::pin(self.action_and_settle(json!({"action":"script","op":"select","ref":reference,"values":values})))
    }
    fn navigate(&self, url: &str) -> BoxFuture<'_, Result<Value, String>> {
        let current = self.tab(&self.active()).and_then(|t| t["url"].as_str().map(String::from));
        let url = resolve_path(url, current.as_deref());
        Box::pin(async move {
            self.command(json!({"action":"navigate","url":url})).await?;
            let id = self.active();
            let events = self.state.subscribe();
            match wait_for_page(events.clone(), &id, url == "about:blank", Duration::from_secs(20)).await {
                // The navigation started; a slow page is not a failed one.
                Err(error) if error == STILL_LOADING => {
                    let mut tab = self.tab(&id).ok_or("Browser tab was closed")?;
                    tab["note"] = json!("Still loading after 20 s. Check with browser_snapshot or browser_wait_for.");
                    Ok(tab)
                }
                Ok(tab) => Ok(titled(events, &id, tab, Duration::from_millis(500)).await),
                result => result,
            }
        })
    }
    fn request(&self, p: Value) -> BoxFuture<'_, Result<Value, String>> {
        Box::pin(self.command(p))
    }
    fn screenshot(&self) -> BoxFuture<'_, Result<Value, String>> {
        Box::pin(async move {
            let _ = self.command(json!({"action":"idle"})).await;
            self.command(json!({"action":"screenshot"})).await
        })
    }
    fn snapshot(&self) -> BoxFuture<'_, Result<Value, String>> {
        Box::pin(async move {
            // Pages often fetch their content after the load event (one list arrives ~2 s later).
            let busy = matches!(self.command(json!({"action":"idle"})).await, Ok(Value::Bool(true)));
            let snapshot = json!({"action":"script","op":"snapshot"});
            let mut result = match self.command(snapshot.clone()).await {
                // A client-side route change between reading the URL and running the snapshot.
                Err(e) if e.starts_with("Page navigated before") => self.command(snapshot).await?,
                result => result?,
            };
            if busy && result.is_object() { result["stillLoading"] = json!(true); }
            Ok(result)
        })
    }
}
/// Snapshots list same-site links as paths; resolve one against the page the agent is on.
fn resolve_path(url: &str, current: Option<&str>) -> String {
    if url.starts_with('/') && !url.starts_with("//") {
        let base = current.and_then(|c| url::Url::parse(c).ok()).filter(|c| matches!(c.scheme(), "http" | "https"));
        if let Some(joined) = base.and_then(|c| c.join(url).ok()) { return joined.into(); }
    }
    url.into()
}
fn new_tab_url(p: &Value) -> Result<&str, String> {
    let url = if p["action"] == "tabs" { p["params"].get("url").filter(|url| !url.is_null()) } else { None }
        .or_else(|| p.get("url").filter(|url| !url.is_null()));
    let url = url.map(|url| url.as_str().ok_or("Invalid URL")).transpose()?.unwrap_or("about:blank");
    if navigation(url, url) != Navigation::Allow { return Err("Navigation blocked".into()); }
    Ok(url)
}

/// Click the way a person does: the visible agent cursor glides to the element and presses it with trusted
/// mouse events. False means nothing was pressed (covered element, events ignored), so the caller falls back to
/// the synthetic click without clicking twice.
#[cfg(target_os = "macos")]
async fn pointer_click(view: &Webview, p: &Value, url: &str) -> bool {
    let mut point = p.clone(); point["op"] = json!("point");
    let Ok(at) = macos::script(view, point).await else { return false };
    let (Some(x), Some(y), Some(w)) = (at["x"].as_f64(), at["y"].as_f64(), at["w"].as_f64()) else { return false };
    if macos::pointer::click(view, x, y, w).await.is_err() { return false; }
    // WebKit delivers the press asynchronously; give it a moment before deciding it was dropped.
    for wait in [30, 150] {
        tokio::time::sleep(Duration::from_millis(wait)).await;
        match macos::script(view, json!({"op":"pressed"})).await {
            Ok(r) if r["pressed"] == true || r["url"].as_str() != Some(url) => return true,
            Ok(_) => {}
            // The page went away mid-check: the click navigated.
            Err(_) => return true,
        }
    }
    false
}

fn needs_ready_page(p: &Value) -> bool {
    matches!(p["action"].as_str(), Some("evaluate" | "screenshot" | "console" | "idle")) ||
        (p["action"] == "script" && matches!(p["op"].as_str(), Some("snapshot" | "click" | "type" | "press" | "select" | "scroll" | "fill")))
}

const STILL_LOADING: &str = "The page is still loading; try again in a moment";
async fn wait_for_page(mut events: watch::Receiver<Value>, id: &str, allow_blank: bool, timeout: Duration) -> Result<Value, String> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        let tab = events.borrow_and_update()["tabs"].as_array()
            .and_then(|tabs| tabs.iter().find(|tab| tab["id"] == id)).cloned().ok_or("Browser tab was closed")?;
        if let Some(error) = tab["error"].as_str() { return Err(error.into()); }
        if tab["ready"] == true && (allow_blank || tab["url"] != "about:blank") { return Ok(tab); }
        tokio::time::timeout_at(deadline, events.changed()).await
            .map_err(|_| STILL_LOADING)?
            .map_err(|_| "Native browser closed")?;
    }
}

/// WebKit can report a new document's title just after its load finishes; wait briefly for it.
async fn titled(mut events: watch::Receiver<Value>, id: &str, mut tab: Value, grace: Duration) -> Value {
    let deadline = tokio::time::Instant::now() + grace;
    loop {
        match events.borrow_and_update()["tabs"].as_array().and_then(|tabs| tabs.iter().find(|t| t["id"] == id)) {
            Some(next) if next["url"] == tab["url"] && next["ready"] == true => tab = next.clone(),
            _ => return tab,
        }
        if tab["title"].as_str().is_some_and(|title| !title.is_empty()) { return tab; }
        if !matches!(tokio::time::timeout_at(deadline, events.changed()).await, Ok(Ok(()))) { return tab; }
    }
}

// Subscribe before the action, then wait without holding the views mutex.
async fn settle_action(
    mut events: watch::Receiver<Value>,
    id: &str,
    before: &Value,
    before_popup: &Value,
    mut result: Value,
    grace: Duration,
    timeout: Duration,
) -> Value {
    // A load has started: wait for it to finish. A URL change alone (the policy decision, or a same-document
    // navigation) only earns a short grace for a load to start; the old page stays ready until the new one commits.
    let mut loading = before["loading"] == true;
    let mut navigated = loading;
    let mut deadline = tokio::time::Instant::now() + if loading { timeout } else { grace };
    let finish = |tab: Value, mut result: Value| {
        if result["id"] == id { return tab; }
        result["navigated"] = tab["url"].clone();
        result
    };
    loop {
        let tab = {
            let state = events.borrow_and_update();
            let popup = &state["lastPopup"];
            if popup != before_popup && popup["url"].is_string() {
                result["popup"] = json!({"url":popup["url"],"note":"Opened in a separate sign-in window that browser tools can't control; ask the user to finish it there."});
            }
            state["tabs"].as_array().and_then(|tabs| tabs.iter().find(|tab| tab["id"] == id)).cloned()
        };
        let Some(tab) = tab else { return result; };
        if !loading && (tab["loading"] == true || (before["ready"] == true && tab["ready"] == false)) {
            loading = true;
            navigated = true;
            deadline = tokio::time::Instant::now() + timeout;
        } else if !navigated && tab["url"] != before["url"] {
            navigated = true;
            deadline = tokio::time::Instant::now() + grace;
        }
        if loading && (!tab["error"].is_null() || (tab["ready"] == true && tab["loading"] != true)) {
            return finish(tab, result);
        }
        match tokio::time::timeout_at(deadline, events.changed()).await {
            Ok(Ok(())) => (),
            Ok(Err(_)) => return result,
            Err(_) => {
                if !navigated { return result; }
                if loading && result["id"] != id { result["loading"] = json!(true); return result; }
                return finish(tab, result);
            }
        }
    }
}
/// Debug builds only: `NUCODE_BROWSER_FAULT=<stage>[:count]` fails tab creation at that stage so Retry and
/// partial-view cleanup can be exercised against real WebKit views. Release builds never read it.
fn injected_fault(stage: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        use std::sync::{atomic::AtomicU32, OnceLock};
        static FAULT: OnceLock<Option<(String, AtomicU32)>> = OnceLock::new();
        let fault = FAULT.get_or_init(|| parse_fault(&std::env::var("NUCODE_BROWSER_FAULT").ok()?).map(|(stage, count)| (stage, AtomicU32::new(count))));
        if let Some((target, remaining)) = fault {
            if target == stage && remaining.try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1)).is_ok() {
                return Err(format!("injected test fault at {stage}"));
            }
        }
    }
    let _ = stage;
    Ok(())
}
#[cfg(debug_assertions)]
fn parse_fault(spec: &str) -> Option<(String, u32)> {
    let (stage, count) = spec.split_once(':').map_or(Some((spec, 1)), |(stage, count)| count.parse().ok().map(|count| (stage, count)))?;
    (!stage.is_empty() && count > 0).then(|| (stage.to_owned(), count))
}
fn page_load_values(previous_url: &str, url: &tauri::Url, finished: bool) -> Value {
    let mut values = json!({"url":url.as_str(),"loading":!finished,"ready":finished,"progress":if finished {1.} else {0.1},"error":null});
    if !finished {
        values["credentialsPaused"] = json!(false);
        values["snapshot"] = Value::Null;
        values["favicon"] = Value::Null;
        if tauri::Url::parse(previous_url).map(|previous| previous.origin() != url.origin()).unwrap_or(true) {
            values["title"] = Value::Null;
        }
    }
    values
}
fn update(state: &watch::Sender<Value>, id: &str, values: Value) {
    update_if(state, id, values, || true);
}
fn update_if(state: &watch::Sender<Value>, id: &str, values: Value, valid: impl FnOnce() -> bool) {
    state.send_if_modified(|s| {
        // Check under the state lock so failure always wins against an in-flight callback.
        if !valid() { return false; }
        let Some(tab) = s["tabs"]
            .as_array_mut()
            .and_then(|tabs| tabs.iter_mut().find(|t| t["id"] == id))
        else {
            return false;
        };
        let mut changed = false;
        for (key, value) in values.as_object().into_iter().flatten() {
            if tab[key] != *value {
                tab[key] = value.clone();
                changed = true;
            }
        }
        changed
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn password_offers_are_private_bounded_and_respect_preferences() {
        let dir = std::env::temp_dir().join(format!("capture-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let pending = Arc::new(Mutex::new(None));
        let index = Mutex::new(());
        let (state, _) = watch::channel(json!({"tabs":[]}));
        let capture = |password: &str, ago: u64| json!({"origin":"https://example.test","username":"alice","password":password,
            "created":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64 - ago});
        for settings in [json!({"privateBrowsing":true}), json!({"offerToSavePasswords":false})] {
            std::fs::write(&path, json!({"browser":settings}).to_string()).unwrap();
            offer_capture(&path, &pending, &index, &state, capture("private-secret", 0)).unwrap();
            assert!(pending.lock().unwrap().is_none());
            assert!(state.borrow()["passwordOffer"].is_null());
        }
        std::fs::write(&path, "{}").unwrap();
        offer_capture(&path, &pending, &index, &state, capture("expired-secret", 120001)).unwrap();
        assert!(pending.lock().unwrap().is_none());
        offer_capture(&path, &pending, &index, &state, capture("first-secret", 0)).unwrap();
        offer_capture(&path, &pending, &index, &state, capture("latest-secret", 0)).unwrap();
        assert_eq!(pending.lock().unwrap().as_ref().unwrap().password, "latest-secret");
        assert_eq!(state.borrow()["passwordOffer"], json!({"origin":"https://example.test","username":"alice","update":false}));
        assert!(!state.borrow().to_string().contains("secret"));
        *pending.lock().unwrap() = None;
        let mut metadata = super::super::passwords::Index::default();
        metadata.block("https://example.test".into());
        metadata.save(&dir.join("browser/passwords.json")).unwrap();
        offer_capture(&path, &pending, &index, &state, capture("blocked-secret", 0)).unwrap();
        assert!(pending.lock().unwrap().is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn navigate_resolves_snapshot_paths_against_the_current_page_only() {
        let page = Some("https://site.test/courses/1/grades?x=1#top");
        assert_eq!(super::resolve_path("/courses/2/grades", page), "https://site.test/courses/2/grades");
        for (url, current) in [("https://other.test/", page), ("//evil.test/x", page), ("/courses", None), ("/courses", Some("about:blank")), ("courses", page)] {
            assert_eq!(super::resolve_path(url, current), url);
        }
    }
    #[test]
    fn password_pause_covers_raw_and_tool_actions_and_the_actual_target() {
        let state = json!({"active":"paused","tabs":[{"id":"paused","credentialsPaused":true},{"id":"other","credentialsPaused":false}]});
        for name in ["browser_passwords_list", "browser_password_save", "browser_password_delete", "browser_password_unblock", "browser_password_fill", "browser_password_offer", "browser_password_resume"] {
            assert_eq!(password_gate(&state, &json!({"action":name}), true).unwrap_err(), "Unknown browser action");
            assert_eq!(password_gate(&state, &json!({"action":name}), false).unwrap_err(), "Unknown browser action");
        }
        for action in ["tool","script","evaluate","console","dialog","screenshot","navigate","back","forward","reload","wait","close","reset","clear","new"] {
            assert_eq!(password_gate(&state, &json!({"action":action}), true).unwrap_err(), super::super::passwords::PAUSED, "{action}");
        }
        for op in ["snapshot","click","type","press","select","fill","scroll","wait","meta"] {
            assert!(password_gate(&state, &json!({"action":"script","op":op,"tabId":"other","id":"other","agent":false}), true).is_err());
        }
        for action in ["script","evaluate","console","dialog","screenshot","wait"] {
            assert!(password_gate(&state, &json!({"action":action}), false).is_err());
        }
        for action in ["navigate","back","forward","reload"] {
            assert!(password_gate(&state, &json!({"action":action}), false).is_ok());
        }
        let other = json!({"active":"other","tabs":state["tabs"]});
        for action in ["close","activate"] {
            assert!(password_gate(&other, &json!({"action":action,"id":"paused"}), true).is_err());
        }
        assert!(password_gate(&other, &json!({"action":"tabs","params":{"action":"close","index":0}}), true).is_err());
        assert!(password_gate(&other, &json!({"action":"evaluate"}), true).is_ok());
        for action in ["reset", "clear"] {
            assert!(password_gate(&other, &json!({"action":action}), true).is_err());
            assert!(password_gate(&other, &json!({"action":action}), false).is_ok());
        }
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn a_page_without_a_url_is_still_loading_not_a_panic() {
        assert_eq!(macos::parse_page_url(None).unwrap_err(), "The page is still loading; try again in a moment");
        assert_eq!(macos::parse_page_url(Some("https://example.test/a".into())).unwrap().as_str(), "https://example.test/a");
    }
    fn settle_state() -> (watch::Sender<Value>, watch::Receiver<Value>, Value) {
        let tab = json!({"id":"one","url":"https://example.test/","ready":true,"loading":false});
        let (state, events) = watch::channel(json!({"active":"one","tabs":[tab.clone(),{"id":"other","ready":true}]}));
        (state, events, tab)
    }
    #[test]
    fn page_load_clears_favicon_and_only_clears_title_on_origin_change() {
        for (url, changed) in [
            ("https://example.test/next", false),
            ("https://example.test:443/next", false),
            ("http://example.test/", true),
            ("https://example.test:8443/", true),
            ("https://other.test/", true),
            ("http://localhost:3000/", true),
        ] {
            let (state, _, _) = settle_state();
            update(&state, "one", json!({"title":"Old title","favicon":"https://example.test/favicon.ico"}));
            // The navigation callback has already published the destination URL.
            update(&state, "one", json!({"url":url}));
            let url = url.parse().unwrap();
            update(&state, "one", page_load_values("https://example.test/", &url, false));
            assert!(state.borrow()["tabs"][0]["favicon"].is_null());
            assert_eq!(state.borrow()["tabs"][0]["title"], if changed { Value::Null } else { json!("Old title") });
            assert_eq!(state.borrow()["tabs"][0]["loading"], true);
            update(&state, "one", json!({"title":"New title","favicon":"new.ico"}));
            update(&state, "one", page_load_values(url.as_str(), &url, true));
            assert_eq!(state.borrow()["tabs"][0]["title"], "New title");
            assert_eq!(state.borrow()["tabs"][0]["favicon"], "new.ico");
            assert_eq!(state.borrow()["tabs"][0]["ready"], true);
        }
    }
    #[tokio::test]
    async fn settle_reports_new_popups_before_command_return_or_during_settle() {
        for already_opened in [false, true] {
            for navigated in [false, true] {
                let (state, events, before) = settle_state();
                let old_popup = json!({"id":"old","url":"https://signin.test/"});
                state.send_modify(|s| s["lastPopup"] = old_popup.clone());
                let open_popup = || state.send_modify(|s| s["lastPopup"] = json!({"id":"new","url":"https://signin.test/"}));
                if already_opened { open_popup(); }
                let settle = settle_action(events, "one", &before, &old_popup, json!({"performed":true,"detail":"preserved"}), Duration::from_millis(10), Duration::from_secs(1));
                tokio::pin!(settle);
                assert!(futures_util::poll!(&mut settle).is_pending());
                if !already_opened { open_popup(); }
                if navigated { update(&state, "one", json!({"url":"https://example.test/done"})); }
                let result = settle.await;
                assert_eq!(result["performed"], true);
                assert_eq!(result["detail"], "preserved");
                assert_eq!(result["popup"], json!({"url":"https://signin.test/","note":"Opened in a separate sign-in window that browser tools can't control; ask the user to finish it there."}));
                if navigated { assert_eq!(result["navigated"], "https://example.test/done"); }
            }
        }
    }
    #[tokio::test]
    async fn settle_does_not_report_a_popup_from_an_earlier_action() {
        let (state, events, before) = settle_state();
        let popup = json!({"id":"old","url":"https://signin.test/"});
        state.send_modify(|s| s["lastPopup"] = popup.clone());
        let result = json!({"performed":true});
        assert_eq!(settle_action(events, "one", &before, &popup, result.clone(), Duration::from_millis(10), Duration::from_secs(1)).await, result);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn password_calls_install_the_private_script_before_the_operation() {
        let operation = "return JSON.stringify(globalThis.__nuPasswords.sensitive());";
        let source = macos::password_source(operation);
        assert!(source.starts_with(include_str!("passwords.js")));
        assert!(source.ends_with(operation));
    }
    #[tokio::test]
    async fn ready_wait_handles_recreated_pages_and_ignores_other_tabs() {
        let (state, events, _) = settle_state();
        update(&state, "one", json!({"ready":false,"loading":true}));
        let ready = wait_for_page(events, "one", true, Duration::from_secs(1));
        tokio::pin!(ready);
        assert!(futures_util::poll!(&mut ready).is_pending());
        update(&state, "other", json!({"ready":true}));
        assert!(futures_util::poll!(&mut ready).is_pending());
        update(&state, "one", json!({"ready":true,"loading":false}));
        assert_eq!(ready.await.unwrap()["id"], "one");
        // Readiness that arrives before subscribing must not be missed.
        assert!(wait_for_page(state.subscribe(), "one", true, Duration::ZERO).await.is_ok());
    }
    #[tokio::test]
    async fn navigate_results_wait_briefly_for_the_new_page_title() {
        let (state, events, _) = settle_state();
        update(&state, "one", json!({"title":null}));
        let tab = state.borrow()["tabs"][0].clone();
        let result = titled(events.clone(), "one", tab.clone(), Duration::from_secs(1));
        tokio::pin!(result);
        assert!(futures_util::poll!(&mut result).is_pending());
        update(&state, "one", json!({"title":"Worksheet"}));
        assert_eq!(result.await["title"], "Worksheet");
        // An untitled page returns after the grace; a page that moved on keeps the result it had.
        update(&state, "one", json!({"title":""}));
        let tab = state.borrow()["tabs"][0].clone();
        assert_eq!(titled(events.clone(), "one", tab.clone(), Duration::from_millis(10)).await["title"], "");
        update(&state, "one", json!({"url":"https://example.test/next","title":"Next"}));
        assert_eq!(titled(events, "one", tab, Duration::ZERO).await["title"], "");
    }
    #[tokio::test]
    async fn ready_wait_reports_errors_timeouts_and_closed_tabs() {
        let (state, events, _) = settle_state();
        update(&state, "one", json!({"ready":false}));
        assert_eq!(wait_for_page(events.clone(), "one", true, Duration::from_millis(10)).await.unwrap_err(),
            "The page is still loading; try again in a moment");
        let ready = wait_for_page(events.clone(), "one", true, Duration::from_secs(1));
        tokio::pin!(ready);
        assert!(futures_util::poll!(&mut ready).is_pending());
        update(&state, "one", json!({"error":"Navigation blocked by browser policy"}));
        assert_eq!(ready.await.unwrap_err(), "Navigation blocked by browser policy");
        state.send_modify(|s| s["tabs"] = json!([]));
        assert_eq!(wait_for_page(events.clone(), "one", true, Duration::ZERO).await.unwrap_err(), "Browser tab was closed");
        state.send_modify(|s| s["tabs"] = json!([{"id":"one","ready":false}]));
        drop(state);
        assert_eq!(wait_for_page(events, "one", true, Duration::from_secs(1)).await.unwrap_err(), "Native browser closed");
    }
    #[test]
    fn agent_page_operations_require_readiness() {
        for action in ["evaluate", "screenshot", "console", "idle"] {
            assert!(needs_ready_page(&json!({"action":action})));
        }
        for op in ["snapshot", "click", "type", "press", "select", "scroll", "fill"] {
            assert!(needs_ready_page(&json!({"action":"script","op":op})));
        }
        for action in ["navigate", "tabs", "close", "stop", "dialog", "poll"] {
            assert!(!needs_ready_page(&json!({"action":action})));
        }
    }
    #[tokio::test]
    async fn tabs_new_tool_uses_nested_url_and_waits_for_ready_tab() {
        // Exercise tool payloads against the same command parsing and watch wait as native views.
        struct Tabs(watch::Sender<Value>);
        impl BrowserBackend for Tabs {
            fn request(&self, p: Value) -> BoxFuture<'_, Result<Value, String>> {
                Box::pin(async move {
                    assert_eq!(p["action"], "tabs");
                    assert_eq!(p["params"]["action"], "new");
                    let url = new_tab_url(&p)?;
                    update(&self.0, "one", json!({"url":url,"ready":false,"loading":true}));
                    wait_for_page(self.0.subscribe(), "one", url == "about:blank", Duration::from_secs(1)).await
                })
            }
        }
        let (state, _, _) = settle_state();
        let backend = Tabs(state.clone());
        let result = super::super::backend::tool(&backend, "browser_tabs", json!({"action":"new","url":"https://example.test/new"}));
        tokio::pin!(result);
        assert!(futures_util::poll!(&mut result).is_pending());
        assert_eq!(state.borrow()["tabs"][0]["url"], "https://example.test/new");
        update(&state, "one", json!({"ready":true,"url":"about:blank"}));
        assert!(futures_util::poll!(&mut result).is_pending());
        update(&state, "one", json!({"ready":true,"loading":false,"url":"https://example.test/final","snapshot":"cG5n"}));
        let result = result.await.unwrap();
        let tab: Value = serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(tab["url"], "https://example.test/final");
        assert_eq!(tab["ready"], true);
        assert!(tab.get("snapshot").is_none());
        assert_eq!(state.borrow()["tabs"][0]["snapshot"], "cG5n");
        for url in [json!("file:///etc/passwd"), json!("javascript:alert(1)"), json!("tauri://localhost"), json!("mailto:a@example.test"), json!(123)] {
            assert!(super::super::backend::tool(&backend, "browser_tabs", json!({"action":"new","url":url})).await.is_err());
        }
        for (p, expected) in [
            (json!({"action":"tabs","params":{"action":"new"}}), "about:blank"),
            (json!({"action":"tabs","params":{"action":"new"},"url":"https://fallback.test/"}), "https://fallback.test/"),
            (json!({"action":"tabs","params":{"action":"new","url":"https://nested.test/"},"url":"https://fallback.test/"}), "https://nested.test/"),
            (json!({"action":"new","url":"https://direct.test/","params":{"url":"https://ignored.test/"}}), "https://direct.test/"),
        ] {
            assert_eq!(new_tab_url(&p).unwrap(), expected);
        }
    }
    #[tokio::test]
    async fn settle_without_navigation_returns_after_grace() {
        let (state, events, before) = settle_state();
        let result = json!({"performed":true});
        let grace = Duration::from_millis(10);
        let started = Instant::now();
        let settle = settle_action(events, "one", &before, &Value::Null, result.clone(), grace, Duration::from_secs(5));
        tokio::pin!(settle);
        assert!(futures_util::poll!(&mut settle).is_pending());
        update(&state, "other", json!({"loading":true,"ready":false,"url":"https://other.test/"}));
        assert_eq!(tokio::time::timeout(Duration::from_secs(1), settle).await.unwrap(), result);
        assert!(started.elapsed() >= grace);
    }
    #[tokio::test]
    async fn settle_waits_for_navigation_and_reports_final_url() {
        // Each supported start signal must work, including readiness alone.
        for change in [json!({"loading":true,"ready":false}), json!({"ready":false}), json!({"url":"https://example.test/done"})] {
            let (state, events, before) = settle_state();
            let result = json!({"performed":true,"detail":"preserved"});
            // A URL change with no load (same-document navigation) settles once the grace passes.
            let grace = Duration::from_millis(if change["url"].is_null() { 1000 } else { 10 });
            let settle = settle_action(events, "one", &before, &Value::Null, result.clone(), grace, Duration::from_secs(1));
            tokio::pin!(settle);
            assert!(futures_util::poll!(&mut settle).is_pending());
            update(&state, "one", change.clone());
            if change["url"].is_null() {
                assert!(futures_util::poll!(&mut settle).is_pending());
                // Switching the active tab must not switch which load is awaited.
                state.send_modify(|s| s["active"] = json!("other"));
                update(&state, "one", json!({"loading":false,"ready":true,"url":"https://example.test/done"}));
            }
            assert_eq!(settle.await, json!({"performed":true,"detail":"preserved","navigated":"https://example.test/done"}));
        }
    }
    #[tokio::test]
    async fn settle_waits_past_the_policy_url_until_the_new_page_finishes() {
        // Policy updates the URL first and the old page stays ready until the new one commits.
        let (state, events, before) = settle_state();
        let settle = settle_action(events, "one", &before, &Value::Null, json!({"performed":true}), Duration::from_secs(1), Duration::from_secs(1));
        tokio::pin!(settle);
        update(&state, "one", json!({"url":"https://example.test/next"}));
        assert!(futures_util::poll!(&mut settle).is_pending());
        for step in [json!({"loading":true}), json!({"loading":true,"ready":false})] {
            update(&state, "one", step);
            assert!(futures_util::poll!(&mut settle).is_pending());
        }
        update(&state, "one", json!({"loading":false,"ready":true}));
        assert_eq!(settle.await, json!({"performed":true,"navigated":"https://example.test/next"}));
        // A cancelled load (download, superseded request) leaves the old page ready and settles at once.
        let (state, events, before) = settle_state();
        let settle = settle_action(events, "one", &before, &Value::Null, json!({"performed":true}), Duration::from_secs(1), Duration::from_secs(1));
        tokio::pin!(settle);
        update(&state, "one", json!({"loading":true}));
        assert!(futures_util::poll!(&mut settle).is_pending());
        update(&state, "one", json!({"loading":false}));
        assert_eq!(settle.await, json!({"performed":true,"navigated":"https://example.test/"}));
    }
    #[tokio::test]
    async fn history_settle_returns_the_final_tab_or_loading_tab() {
        for finish in [true, false] {
            let (state, events, before) = settle_state();
            let settle = settle_action(events, "one", &before, &Value::Null, before.clone(), Duration::from_secs(1), Duration::from_millis(10));
            tokio::pin!(settle);
            assert!(futures_util::poll!(&mut settle).is_pending());
            update(&state, "one", json!({"ready":false,"loading":true}));
            assert!(futures_util::poll!(&mut settle).is_pending());
            if finish { update(&state, "one", json!({"ready":true,"loading":false,"url":"https://example.test/back","canGoBack":false,"canGoForward":true})); }
            let result = settle.await;
            assert_eq!(result, state.borrow()["tabs"][0]);
            assert_eq!(result["loading"], !finish);
        }
    }
    #[tokio::test]
    async fn settle_loading_timeout_preserves_success() {
        let (state, events, before) = settle_state();
        let timeout = Duration::from_millis(10);
        let settle = settle_action(events, "one", &before, &Value::Null, json!({"performed":true}), Duration::from_secs(5), timeout);
        tokio::pin!(settle);
        assert!(futures_util::poll!(&mut settle).is_pending());
        update(&state, "one", json!({"loading":true,"ready":false}));
        let started = Instant::now();
        assert_eq!(tokio::time::timeout(Duration::from_secs(1), settle).await.unwrap(), json!({"performed":true,"loading":true}));
        assert!(started.elapsed() >= timeout);
    }
    #[tokio::test]
    async fn settle_removed_tab_returns_unchanged_in_either_phase() {
        for loading in [false, true] {
            let (state, events, before) = settle_state();
            let result = json!({"performed":true});
            let settle = settle_action(events, "one", &before, &Value::Null, result.clone(), Duration::from_secs(5), Duration::from_secs(5));
            tokio::pin!(settle);
            assert!(futures_util::poll!(&mut settle).is_pending());
            if loading {
                update(&state, "one", json!({"loading":true,"ready":false}));
                assert!(futures_util::poll!(&mut settle).is_pending());
            }
            state.send_modify(|s| s["tabs"].as_array_mut().unwrap().retain(|tab| tab["id"] != "one"));
            assert_eq!(tokio::time::timeout(Duration::from_secs(1), settle).await.unwrap(), result);
        }
    }
    #[tokio::test]
    async fn settle_handles_loads_started_before_command_return_and_errors() {
        for initially_loading in [false, true] {
            for failed in [false, true] {
                let (state, events, mut before) = settle_state();
                if initially_loading { before["loading"] = json!(true); before["ready"] = json!(false); }
                update(&state, "one", json!({"loading":true,"ready":false}));
                let settle = settle_action(events, "one", &before, &Value::Null, json!({"performed":true}), Duration::from_secs(1), Duration::from_secs(1));
                tokio::pin!(settle);
                assert!(futures_util::poll!(&mut settle).is_pending());
                update(&state, "one", json!({"loading":false,"ready":!failed,"error":if failed {json!("Load failed")} else {Value::Null}}));
                assert_eq!(settle.await, json!({"performed":true,"navigated":"https://example.test/"}));
            }
        }
    }
    #[test]
    fn fault_injection_spec_names_a_stage_and_positive_count() {
        assert_eq!(parse_fault("layout"), Some(("layout".into(), 1)));
        assert_eq!(parse_fault("navigation:2"), Some(("navigation".into(), 2)));
        for invalid in ["", ":1", "layout:0", "layout:x"] { assert_eq!(parse_fault(invalid), None, "{invalid}"); }
        assert!(injected_fault("not-a-stage").is_ok());
    }
    #[test]
    fn failed_creation_settles_the_tab_and_discards_only_its_partial_state() {
        let original = json!({"id":"other","ready":true,"loading":false,"title":"Keep this page","url":"https://example.test/"});
        let (state, _) = watch::channel(json!({"tabs":[original.clone(),{"id":"failed","ready":false,"loading":true,"progress":0.1}],"active":"failed"}));
        let mut views = Views { live: vec!["other".into(), "failed".into()], hook_keys: HashMap::from([("other".into(), "keep".into()), ("failed".into(), "discard".into())]), shown: Some("failed".into()), placement: Default::default(), last_poll: Instant::now(), private: false };
        views.creation_failed(&state, "failed", "Main window unavailable");
        let snapshot = state.borrow().clone();
        assert_eq!(snapshot["active"], "failed");
        assert_eq!(snapshot["tabs"][0], original);
        assert_eq!(snapshot["tabs"][1]["loading"], false);
        assert_eq!(snapshot["tabs"][1]["ready"], false);
        assert_eq!(snapshot["tabs"][1]["progress"], 0);
        assert!(snapshot["tabs"][1]["error"].as_str().unwrap().contains("Choose Retry"));
        assert_eq!(views.live, ["other"]);
        assert_eq!(views.hook_keys, HashMap::from([("other".into(), "keep".into())]));
        assert!(views.shown.is_none());
        // A late failure for a closed tab must not resurrect it or hide another page.
        views.shown = Some("other".into());
        views.creation_failed(&state, "closed", "creation failed");
        assert_eq!(*state.borrow(), snapshot);
        assert_eq!(views.shown.as_deref(), Some("other"));
    }
    #[test]
    fn late_page_load_cannot_clear_a_failed_creation_or_overwrite_its_retry() {
        let (state, _) = watch::channel(json!({"tabs":[{"id":"failed","ready":false,"loading":false,"error":"Choose Retry"}]}));
        let valid = AtomicBool::new(false);
        let original = state.borrow().clone();
        update_if(&state, "failed", json!({"ready":true,"error":null}), || valid.load(Ordering::Acquire));
        assert_eq!(*state.borrow(), original);
        // Retry creates a separate callback lifetime; the old one stays invalid.
        let retry = AtomicBool::new(true);
        update_if(&state, "failed", json!({"ready":true,"error":null,"title":"Retried page"}), || retry.load(Ordering::Acquire));
        update_if(&state, "failed", json!({"ready":false,"loading":true}), || valid.load(Ordering::Acquire));
        assert_eq!(state.borrow()["tabs"][0], json!({"id":"failed","ready":true,"loading":false,"error":null,"title":"Retried page"}));
    }
    #[test]
    fn clear_site_confirmation_rejects_changed_tab_or_url() {
        let params = json!({"action":"clearSite","confirmed":true,"tabId":"one","expectedUrl":"https://first.example/page"});
        assert!(policy::check_target(&params, "one", Some("https://first.example/page")).is_ok());
        assert!(policy::check_target(&params, "two", Some("https://first.example/page")).is_err());
        assert!(policy::check_target(&params, "one", Some("https://second.example/page")).is_err());
        assert!(policy::check_target(&json!({"action":"clearSite","confirmed":true}), "one", Some("https://first.example/page")).is_ok());
    }
    #[test]
    fn automation_rechecks_current_origin_including_blob_pages() {
        let mut settings = super::super::Settings::default();
        settings.allowed_origins = vec!["https://allowed.example".into()];
        for url in ["https://allowed.example/page", "blob:https://allowed.example/uuid", "about:blank", "data:image/png;base64,eA=="] {
            assert!(automation_allowed(&url.parse().unwrap(), &settings), "{url}");
        }
        for url in ["https://blocked.example", "blob:https://blocked.example/uuid", "file:///etc/hosts", "tauri://localhost", "http://tauri.localhost", "javascript:alert(1)"] {
            assert!(!automation_allowed(&url.parse().unwrap(), &settings), "{url}");
        }
        settings.blocked_origins = vec!["https://allowed.example".into()];
        assert!(!automation_allowed(&"https://allowed.example/page".parse().unwrap(), &settings));
        assert!(!automation_allowed(&"blob:https://allowed.example/uuid".parse().unwrap(), &settings));
    }
}

fn close_popups(app: &AppHandle) -> Result<(), String> {
    // multiwebview-ok: sign-in popups are WebviewWindows by construction; main is never touched.
    for (label, window) in app.webview_windows() {
        if label.starts_with("browser-popup-") { window.destroy().map_err(|e| e.to_string())?; }
    }
    Ok(())
}
// Never use Wry's URL getter on macOS: WKWebView.URL is nil before the first committed load.
async fn current_url(view: &Webview) -> Result<tauri::Url, String> {
    #[cfg(target_os = "macos")]
    return macos::page_url(view).await;
    #[cfg(not(target_os = "macos"))]
    view.url().map_err(|error| error.to_string())
}
fn close_view(view: Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    navigation_events::release(&view);
    #[cfg(target_os = "macos")]
    macos::release_accessibility(&view);
    #[cfg(target_os = "macos")]
    macos::close_view_page(&view);
    view.close().map_err(|e| e.to_string())
}

fn password_gate(state: &Value, p: &Value, agent: bool) -> Result<(), String> {
    super::passwords::reject_action(p)?;
    let action = p["action"].as_str().unwrap_or("");
    let active = state["active"].as_str().unwrap_or("").to_string();
    let target = if p["action"] == "tabs" {
        p["params"]["index"].as_u64().and_then(|i| state["tabs"][i as usize]["id"].as_str().map(str::to_owned))
    } else if matches!(action, "close" | "activate") { p["id"].as_str().map(str::to_owned) } else { None }.unwrap_or(active);
    let always = matches!(action, "script" | "evaluate" | "console" | "dialog" | "screenshot" | "wait");
    let agent_action = agent && !matches!(action, "poll" | "ensure" | "activity" | "detach" | "bounds" | "resize" | "attach");
    if (always || agent_action) && state["tabs"].as_array().is_some_and(|tabs| tabs.iter().any(|t| (t["id"] == target || matches!(action, "reset" | "clear")) && t["credentialsPaused"] == true)) {
        return Err(super::passwords::PAUSED.into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn offer_capture(settings_path: &std::path::PathBuf, pending: &Arc<Mutex<Option<super::passwords::Pending>>>,
    index_lock: &Mutex<()>, state: &watch::Sender<Value>, captured: Value) -> Result<(), String> {
    use super::passwords::{origin, Pending};
    let settings = crate::storage::read_settings(settings_path)?.browser;
    let Some(password) = captured["password"].as_str() else { return Ok(()); };
    nucode_diag_mcp::writer::remember_secret(password);
    if !settings.offer_to_save_passwords || settings.private_browsing { return Ok(()); }
    let site = origin(captured["origin"].as_str().ok_or("Invalid login origin")?)?;
    let username = captured["username"].as_str().ok_or("Invalid login username")?;
    if password.is_empty() || password.len() > 65536 || username.len() > 4096 { return Ok(()); }
    let _guard = index_lock.lock().map_err(|_| "Saved passwords unavailable")?;
    let index = super::passwords::Index::load(&settings_path.parent().ok_or("Missing app data directory")?.join("browser/passwords.json"))?;
    if index.never.contains(&site) || index.same(&super::passwords::Keychain, &site, username, password)? { return Ok(()); }
    let update = index.matching(&site).any(|e| e.username == username);
    let captured_at = captured["created"].as_u64().ok_or("Invalid login capture")?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
    let age = now.saturating_sub(captured_at);
    if age >= 120000 { return Ok(()); }
    let created = Instant::now() - Duration::from_millis(age);
    let mut offer = pending.lock().map_err(|_| "Password offer unavailable")?;
    *offer = Some(Pending {
        origin: site.clone(), username: username.into(), password: password.into(), created,
    });
    state.send_modify(|s| s["passwordOffer"] = json!({"origin":site,"username":username,"update":update}));
    drop(offer);
    let pending = pending.clone();
    let state = state.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(120000 - age)).await;
        if let Ok(mut pending) = pending.lock() {
            if pending.as_ref().is_some_and(|p| p.created == created) {
                *pending = None;
                state.send_modify(|s| s["passwordOffer"] = Value::Null);
            }
        }
    });
    Ok(())

}
