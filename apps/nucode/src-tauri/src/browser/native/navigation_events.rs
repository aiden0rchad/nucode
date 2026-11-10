//! Observe load starts and failures, and isolate subframe policy from Wry's top-level navigation policy.
//! All other delegate messages forward to the original delegate.
use objc2::{
    define_class, msg_send,
    rc::Retained, sel, Message,
    runtime::{AnyObject, ProtocolObject, Sel},
    DefinedClass, MainThreadOnly,
};
use objc2_foundation::{MainThreadMarker, NSError, NSObject, NSObjectProtocol};
use objc2_web_kit::{WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKWebView};
use serde_json::{json, Value};
use std::{cell::{Cell, RefCell}, collections::HashMap};
use tokio::sync::watch;

struct State {
    original: Retained<ProtocolObject<dyn WKNavigationDelegate>>,
    state: watch::Sender<Value>,
    id: String,
    /// The main-frame navigation that started last, so a cancelled older one can't clear its loading state.
    provisional: Cell<usize>,
    /// A finish held back because a newer navigation had already started; replayed if that one is cancelled.
    deferred: RefCell<Option<Retained<WKNavigation>>>,
}
fn key(navigation: Option<&WKNavigation>) -> usize { navigation.map_or(0, |n| n as *const WKNavigation as usize) }
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = State]
    struct NavigationEvents;
    unsafe impl NSObjectProtocol for NavigationEvents {}
    unsafe impl WKNavigationDelegate for NavigationEvents {}
    impl NavigationEvents {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn navigation_policy(&self, view: &WKWebView, action: &WKNavigationAction, handler: &block2::DynBlock<dyn Fn(WKNavigationActionPolicy)>) {
            unsafe {
                if action.targetFrame().is_some_and(|frame| !frame.isMainFrame()) {
                    let allowed = action.request().URL().and_then(|url| url.absoluteString())
                        .is_some_and(|url| super::policy::subframe_navigation(&url.to_string()));
                    handler.call((if allowed { WKNavigationActionPolicy::Allow } else { WKNavigationActionPolicy::Cancel },));
                } else {
                    let _: () = msg_send![&*self.ivars().original, webView: view, decidePolicyForNavigationAction: action, decisionHandler: handler];
                }
            }
        }
        #[unsafe(method(respondsToSelector:))]
        fn responds(&self, selector: Sel) -> bool {
            let own: bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
            own || self.ivars().original.respondsToSelector(selector)
        }
        #[unsafe(method(forwardingTargetForSelector:))]
        fn forward(&self, _selector: Sel) -> *mut AnyObject {
            Retained::as_ptr(&self.ivars().original) as *mut AnyObject
        }
        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn terminated(&self, _view: &WKWebView) {
            nucode_diag_mcp::writer::record(|| nucode_diag_mcp::core::event("error", "browser", "browser.native.process_terminated", "Native page process stopped"));
            self.failed("The page process stopped. Reload to recover.".into());
        }
        /// Wry only reports a load once it commits; mark it loading as soon as the request starts, so a click
        /// that navigates waits for the new page instead of returning while the old one is still showing.
        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn provisional_started(&self, _view: &WKWebView, navigation: Option<&WKNavigation>) {
            self.ivars().provisional.set(key(navigation));
            super::update(&self.ivars().state, &self.ivars().id, json!({"loading":true,"progress":0.1}));
        }
        #[unsafe(method(webView:didCommitNavigation:))]
        fn committed(&self, view: &WKWebView, navigation: Option<&WKNavigation>) {
            self.ivars().deferred.take();
            self.pass_on(sel!(webView:didCommitNavigation:), view, navigation);
        }
        /// Wry reports a finish with whatever URL the view shows now. When an older load (the blank page a new
        /// tab starts with, or the page before a client redirect) finishes after a newer request started, that
        /// would mark the new page ready before it has even committed.
        #[unsafe(method(webView:didFinishNavigation:))]
        fn finished(&self, view: &WKWebView, navigation: Option<&WKNavigation>) {
            let latest = self.ivars().provisional.get();
            if let Some(stale) = navigation.filter(|_| latest != 0 && latest != key(navigation)) {
                self.ivars().deferred.replace(Some(stale.retain()));
                return;
            }
            self.pass_on(sel!(webView:didFinishNavigation:), view, navigation);
        }
        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn provisional_failed(&self, view: &WKWebView, navigation: Option<&WKNavigation>, error: &NSError) {
            // Cancellation is normal for redirects, downloads and user navigation: the old page stays.
            if !matches!(error.code(), -999 | 102) {
                self.ivars().deferred.take();
                self.failed(error.localizedDescription().to_string());
            } else if self.ivars().provisional.get() == key(navigation) {
                // The policy step already published the cancelled request's URL (e.g. a download); show the page that stays.
                let mut values = json!({"loading":false});
                if let Some(url) = unsafe { view.URL() }.and_then(|url| url.absoluteString()) { values["url"] = json!(url.to_string()); }
                super::update(&self.ivars().state, &self.ivars().id, values);
                if let Some(stale) = self.ivars().deferred.take() {
                    self.pass_on(sel!(webView:didFinishNavigation:), view, Some(&stale));
                }
            }
        }
        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn navigation_failed(&self, _view: &WKWebView, _navigation: Option<&WKNavigation>, error: &NSError) {
            if !matches!(error.code(), -999 | 102) { self.failed(error.localizedDescription().to_string()); }
        }
    }
);
impl NavigationEvents {
    fn pass_on(&self, selector: Sel, view: &WKWebView, navigation: Option<&WKNavigation>) {
        let original = &*self.ivars().original;
        if original.respondsToSelector(selector) {
            unsafe { let _: *mut AnyObject = msg_send![original, performSelector: selector, withObject: view, withObject: navigation]; }
        }
    }
    fn failed(&self, error: String) {
        super::update(
            &self.ivars().state,
            &self.ivars().id,
            json!({"error":error,"loading":false,"ready":false}),
        );
    }
}
thread_local! { static DELEGATES: RefCell<HashMap<String,Retained<NavigationEvents>>> = RefCell::new(HashMap::new()); }
pub fn install(
    view: &tauri::Webview,
    id: String,
    state: watch::Sender<Value>,
) -> Result<(), String> {
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let Some(original) = wk.navigationDelegate() else {
            return;
        };
        let allocated =
            NavigationEvents::alloc(MainThreadMarker::new().expect("WebKit main thread"))
                .set_ivars(State {
                    original,
                    state,
                    id: id.clone(),
                    provisional: Cell::new(0),
                    deferred: RefCell::new(None),
                });
        let delegate: Retained<NavigationEvents> = msg_send![super(allocated), init];
        wk.setNavigationDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        DELEGATES.with(|delegates| {
            delegates.borrow_mut().insert(id, delegate);
        });
    })
    .map_err(|e| e.to_string())
}
pub fn release(view: &tauri::Webview) {
    let id = view.label().trim_start_matches("browser-").to_string();
    let _ = view.with_webview(move |platform| unsafe {
        if let Some(delegate) = DELEGATES.with(|delegates| delegates.borrow_mut().remove(&id)) {
            let wk = &*(platform.inner() as *const WKWebView);
            wk.setNavigationDelegate(Some(&delegate.ivars().original));
        }
    });
}
