use base64::Engine;
use block2::RcBlock;
use objc2::{runtime::AnyObject, MainThreadOnly};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSView};
use objc2_foundation::{NSDictionary, NSError, NSString, NSObjectProtocol};
use objc2_web_kit::{WKContentWorld, WKWebView, WKScriptMessageHandler};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::Webview;
#[path = "accessibility.rs"]
mod accessibility;
pub use accessibility::expose as expose_accessibility;
pub use accessibility::install_view as install_accessibility;
pub use accessibility::release as release_accessibility;
#[path = "pointer.rs"]
pub mod pointer;

/// Placement's view of the main window in one main-thread hop. Tauri's window getters each block
/// on their own round trip, which left the page trailing the panel edge while resizing.
pub(super) async fn main_frame(view: &Webview) -> Result<super::MainFrame, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let window = wk.window();
        let visible = window.as_ref().is_some_and(|w| w.isVisible() && !w.isMiniaturized());
        let size = window.and_then(|w| w.contentView()).map(|v| v.frame().size);
        let _ = tx.send(super::MainFrame { zoom: wk.pageZoom(), visible, width: size.map_or(0., |s| s.width), height: size.map_or(0., |s| s.height) });
    }).map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "Main webview closed".into())
}
pub(super) fn parse_page_url(url: Option<String>) -> Result<tauri::Url, String> {
    url.and_then(|url| url.parse().ok()).ok_or_else(|| "The page is still loading; try again in a moment".into())
}
// tauri's Webview::url() unwraps WKWebView.URL, which stays nil until a page's first load commits;
// that panic on the main thread ended the app when an agent read a just-created tab.
pub async fn page_url(view: &Webview) -> Result<tauri::Url, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let _ = tx.send(wk.URL().and_then(|url| url.absoluteString()).map(|url| url.to_string()));
    }).map_err(|e| e.to_string())?;
    parse_page_url(rx.await.map_err(|_| "Browser page closed".to_string())?)
}
/// WebKit's message when a page's CSP sandbox forbids scripts (file previews, many PDF hosts). The private
/// bridge's own world still runs; page-world calls (evaluate, console, dialogs) fail.
const NO_PAGE_SCRIPTS: &str = "Cannot execute JavaScript in this document";
pub const SCRIPTS_BLOCKED: &str = "This page doesn't allow scripts (common for PDFs and file previews), so browser_evaluate, console and dialog tools can't run here. Use browser_snapshot or browser_take_screenshot to read it.";
/// WebKit describes every script failure as "A JavaScript exception occurred"; its exception message names the problem.
fn script_error(error: &NSError) -> String {
    let message = error.userInfo().objectForKey(&NSString::from_str("WKJavaScriptExceptionMessage"))
        .and_then(|m| m.downcast_ref::<NSString>().map(|m| m.to_string()));
    match message {
        Some(m) if m == NO_PAGE_SCRIPTS => SCRIPTS_BLOCKED.into(),
        Some(m) if !m.is_empty() => m.chars().take(1000).collect(),
        _ => error.localizedDescription().to_string(),
    }
}
thread_local! {
    // Retain the named world for the app lifetime so refs survive separate calls.
    static WORLD: objc2::rc::Retained<WKContentWorld> = unsafe { WKContentWorld::worldWithName(&NSString::from_str("nucode.browser.private"), objc2::MainThreadMarker::new().expect("WebKit main thread")) };
}

async fn evaluate(view: &Webview, script: String, page: bool) -> Result<Value, String> {
    if objc2_foundation::NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        < 11
    {
        return Err("Native agent control requires macOS 11. Try the Headless Chromium backend (Settings → Browser)".into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let callback = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            let result = if let Some(error) = error.as_ref() {
                Err(script_error(error))
            } else if value.is_null() {
                Ok(Value::Null)
            } else if let Some(string) = (&*value).downcast_ref::<NSString>() {
                let string = string.to_string();
                if string.len() > 200000 {
                    Err("Native result exceeds 200 KB".into())
                } else {
                    serde_json::from_str(&string).map_err(|e| e.to_string())
                }
            } else {
                Err("Unexpected native bridge response".into())
            };
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(result);
            }
        });
        if page {
            wk.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &NSString::from_str(&script),
                None,
                None,
                &WKContentWorld::pageWorld(
                    objc2::MainThreadMarker::new().expect("WebKit main thread"),
                ),
                Some(&callback),
            );
        } else {
            WORLD.with(|world| {
                wk.evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                    &NSString::from_str(&script),
                    None,
                    world,
                    Some(&callback),
                )
            });
        }
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| "Native page did not respond; reload the tab")?
        .map_err(|_| "Native view closed")?
}

pub async fn script(view: &Webview, params: Value) -> Result<Value, String> {
    let result = evaluate(
        view,
        format!(
            "{}\nglobalThis.__nuBrowser({params})",
            include_str!("bridge.js")
        ),
        false,
    )
    .await?;
    if let Some(error) = result["error"].as_str() {
        Err(error.into())
    } else {
        Ok(result["result"].clone())
    }
}

pub async fn evaluate_page(view: &Webview, params: Value, url: &str) -> Result<Value, String> {
    let function = params["function"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 200000)
        .ok_or("Invalid JavaScript function")?;
    // A transient, unpredictable marker carries an isolated-world ref into the
    // page world without exposing the bridge or retaining page globals there.
    let marker = params["ref"]
        .as_str()
        .map(|_| format!("data-nucode-evaluate-{}", uuid::Uuid::new_v4()));
    if let Some(marker) = &marker {
        script(
            view,
            json!({"op":"mark","ref":params["ref"],"marker":marker,"expectedUrl":url}),
        )
        .await?;
    }
    let result = evaluate(
        view,
        format!(
            "return await ({} )(() => ({}\n), {}, {});",
            include_str!("evaluate.js"),
            function,
            json!(url),
            json!(marker)
        ),
        true,
    )
    .await;
    // Syntax errors, navigation or rejected WebKit execution must clear markers too.
    if let Some(marker) = marker {
        let _ = script(view, json!({"op":"unmark","marker":marker})).await;
    }
    let result = result?;
    if let Some(error) = result["error"].as_str() {
        Err(error.into())
    } else if result.get("result").is_some() {
        Ok(result["result"].clone())
    } else {
        Err("Unexpected native evaluation response".into())
    }
}

pub async fn image(view: &Webview) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let callback = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = (|| {
                if let Some(error) = error.as_ref() {
                    return Err(error.localizedDescription().to_string());
                }
                let tiff = image
                    .as_ref()
                    .and_then(|i| i.TIFFRepresentation())
                    .ok_or("No native snapshot")?;
                let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)
                    .ok_or("Cannot decode native snapshot")?;
                let data = bitmap
                    .representationUsingType_properties(
                        NSBitmapImageFileType::PNG,
                        &NSDictionary::new(),
                    )
                    .ok_or("Cannot encode native snapshot")?;
                Ok(json!(
                    base64::engine::general_purpose::STANDARD.encode(data.to_vec())
                ))
            })();
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(result);
            }
        });
        wk.takeSnapshotWithConfiguration_completionHandler(None, &callback);
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(3), rx)
        .await
        .map_err(|_| "Native snapshot timed out")?
        .map_err(|_| "Native view closed")?
}

/// Check native keyboard focus without changing visibility or WebKit's viewport.
pub async fn owns_focus(view: &Webview) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let focused = wk.window().is_some_and(|window| {
            window.firstResponder().is_some_and(|responder| {
                responder
                    .downcast_ref::<NSView>()
                    .is_some_and(|view| view.isDescendantOf(wk))
            })
        });
        let _ = tx.send(focused);
    })
    .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "Native view closed".into())
}

pub async fn control(view: &Webview, action: String) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        match action.as_str() { "back" => { wk.goBack(); }, "forward" => { wk.goForward(); }, "stop" => wk.stopLoading(), _ => () }
        let _ = tx.send(json!({"canGoBack":wk.canGoBack(),"canGoForward":wk.canGoForward(),"progress":wk.estimatedProgress()}));
    }).map_err(|e|e.to_string())?;
    rx.await.map_err(|_| "Native view closed".into())
}

pub fn persistent_store_available() -> bool {
    // data_store_identifier is only supported on macOS 14+.
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    version.majorVersion >= 14
}

/// WebKit groups website records by registrable domain. Clear only records
/// belonging to this host (including its parent domain), never the whole store.
pub async fn clear_site(view: &Webview, host: String) -> Result<(), String> {
    use objc2_foundation::NSArray;
    use objc2_web_kit::{WKWebsiteDataRecord, WKWebsiteDataStore};
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = std::sync::Arc::new(Mutex::new(Some(tx)));
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let store = wk.configuration().websiteDataStore();
        let types = WKWebsiteDataStore::allWebsiteDataTypes(
            objc2::MainThreadMarker::new().expect("WebKit main thread"),
        );
        let fetch_store = store.clone();
        let fetch_types = types.clone();
        let callback = RcBlock::new(
            move |records: std::ptr::NonNull<NSArray<WKWebsiteDataRecord>>| {
                let records: Vec<_> = records
                    .as_ref()
                    .iter()
                    .filter(|record| {
                        let name = record.displayName().to_string();
                        host == name || host.ends_with(&format!(".{name}"))
                    })
                    .collect();
                let selected = NSArray::from_retained_slice(&records);
                let tx = tx.clone();
                let done = RcBlock::new(move || {
                    if let Some(tx) = tx.lock().unwrap().take() {
                        let _ = tx.send(());
                    }
                });
                fetch_store.removeDataOfTypes_forDataRecords_completionHandler(
                    &fetch_types,
                    &selected,
                    &done,
                );
            },
        );
        store.fetchDataRecordsOfTypes_completionHandler(&types, &callback);
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10), rx)
        .await
        .map_err(|_| "Clearing site data timed out")?
        .map_err(|_| "Native view closed".into())
}

/// Wry keeps an extra retain on every WKWebView it drops, so without this a closed tab or popup
/// keeps its page (scripts, timers, network) alive until the app quits.
pub(super) fn close_page(wk: &WKWebView) {
    if wk.respondsToSelector(objc2::sel!(_close)) {
        let _: () = unsafe { objc2::msg_send![wk, _close] };
    }
}

pub(super) fn close_view_page(view: &Webview) {
    let _ = view.with_webview(|platform| close_page(unsafe { &*(platform.inner() as *const WKWebView) }));
}

/// Tauri and Wry add the app's IPC bridge (`__TAURI_INTERNALS__`, `window.ipc`, plugin polyfills
/// that replace `Notification`) to every webview. Web pages keep only nucode's own scripts.
pub fn drop_app_bridge(wk: &WKWebView) {
    let hooks = concat!("(", include_str!("page_hooks.js"), ")");
    unsafe {
        let controller = wk.configuration().userContentController();
        let own: Vec<_> = controller.userScripts().to_vec().into_iter().filter(|script| {
            let source = script.source().to_string();
            source.starts_with(hooks) || source == include_str!("passwords.js")
        }).collect();
        controller.removeAllUserScripts();
        for script in own { controller.addUserScript(&script); }
        controller.removeScriptMessageHandlerForName(&NSString::from_str("ipc"));
    }
}

pub async fn hide_app_bridge(view: &Webview) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        drop_app_bridge(unsafe { &*(platform.inner() as *const WKWebView) });
        let _ = tx.send(());
    }).map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "Native view closed".into())
}

pub async fn install_passwords(view: &Webview, capture: Box<dyn Fn(Value) + Send + Sync>) -> Result<(), String> {
    use objc2_web_kit::{WKUserScript, WKUserScriptInjectionTime};
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        WORLD.with(|world| {
            let script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
                WKUserScript::alloc(objc2::MainThreadMarker::new().expect("WebKit main thread")),
                &NSString::from_str(include_str!("passwords.js")), WKUserScriptInjectionTime::AtDocumentStart, true, world,
            );
            let controller = wk.configuration().userContentController();
            let allocated = PasswordCapture::alloc(objc2::MainThreadMarker::new().expect("WebKit main thread")).set_ivars(capture);
            let handler: objc2::rc::Retained<PasswordCapture> = objc2::msg_send![super(allocated), init];
            controller.addScriptMessageHandler_contentWorld_name(objc2::runtime::ProtocolObject::from_ref(&*handler), world, &NSString::from_str("nucodePasswordCapture"));
            controller.addUserScript(&script);
        });
        let _ = tx.send(());
    }).map_err(|_| "Cannot install password protection")?;
    rx.await.map_err(|_| "Cannot install password protection".into())
}

pub(super) fn password_source(source: &str) -> String {
    format!("{}\n{source}", include_str!("passwords.js"))
}

// This path never includes arguments or WebKit error details in source, errors, or logs.
pub async fn password_call(view: &Webview, source: &'static str, arguments: Vec<(&'static str, String)>) -> Result<Value, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let tx = Mutex::new(Some(tx));
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let keys: Vec<_> = arguments.iter().map(|(key, _)| NSString::from_str(key)).collect();
        let values: Vec<_> = arguments.iter().map(|(_, value)| NSString::from_str(value)).collect();
        let keys: Vec<&NSString> = keys.iter().map(|s| &**s).collect();
        let values: Vec<&AnyObject> = values.iter().map(|s| &**s as &AnyObject).collect();
        let args = NSDictionary::from_slices(&keys, &values);
        let callback = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            let result = (|| {
                if !error.is_null() { return Err("Password operation unavailable".to_string()); }
                let text = value.as_ref().and_then(|v| v.downcast_ref::<NSString>()).ok_or("Password protection unavailable")?.to_string();
                let value: Value = serde_json::from_str(&text).map_err(|_| "Password protection unavailable")?;
                if let Some(password) = value["password"].as_str() { nucode_diag_mcp::writer::remember_secret(password); }
                Ok(value)
            })();
            if let Some(tx) = tx.lock().unwrap().take() { let _ = tx.send(result); }
        });
        WORLD.with(|world| wk.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &NSString::from_str(&password_source(source)), Some(&args), None, world, Some(&callback),
        ));
    }).map_err(|_| "Password operation unavailable")?;
    tokio::time::timeout(std::time::Duration::from_secs(10), rx).await
        .map_err(|_| "Password operation timed out")?.map_err(|_| "Password operation unavailable")?
}
pub async fn sensitive(view: &Webview) -> Result<bool, String> {
    password_call(view, "return JSON.stringify(globalThis.__nuPasswords.sensitive());", vec![]).await?
        .as_bool().ok_or_else(|| "Password protection unavailable".into())
}

objc2::define_class!(
    #[unsafe(super = objc2_foundation::NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Box<dyn Fn(Value) + Send + Sync>]
    struct PasswordCapture;
    unsafe impl NSObjectProtocol for PasswordCapture {}
    unsafe impl WKScriptMessageHandler for PasswordCapture {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        unsafe fn receive(&self, _controller: &objc2_web_kit::WKUserContentController, message: &objc2_web_kit::WKScriptMessage) {
            use objc2::DefinedClass;
            if !message.frameInfo().isMainFrame() { return; }
            let body = message.body();
            let Some(text) = body.downcast_ref::<NSString>() else { return; };
            let text = text.to_string();
            if text.len() > 200000 { return; }
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                if let Some(password) = value["password"].as_str() { nucode_diag_mcp::writer::remember_secret(password); }
                (self.ivars())(value);
            }
        }
    }
);
