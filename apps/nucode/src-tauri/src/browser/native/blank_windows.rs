//! Give `window.open("")` the about:blank address browsers use. WebKit asks for that window with an empty URL,
//! which fails Tauri's URL parse before nucode's new-window handler runs, so the page got null back. LMS tool
//! launches open a blank named window this way and then point it at the tool once a request returns.
use objc2::{
    class, define_class, msg_send, sel,
    rc::Retained,
    runtime::{AnyObject, ProtocolObject, Sel},
    DefinedClass, MainThreadOnly, Message,
};
use objc2_foundation::{MainThreadMarker, NSObject, NSObjectProtocol, NSString};
use objc2_web_kit::{WKNavigationAction, WKUIDelegate, WKWebView};
use std::{cell::RefCell, collections::HashMap};

struct Blank {
    action: Retained<WKNavigationAction>,
    request: Retained<AnyObject>,
}
define_class!(
    /// The original navigation action with an about:blank request; everything else forwards to it.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Blank]
    struct BlankAction;
    unsafe impl NSObjectProtocol for BlankAction {}
    impl BlankAction {
        #[unsafe(method(request))]
        fn request(&self) -> *mut AnyObject {
            Retained::as_ptr(&self.ivars().request) as *mut AnyObject
        }
        #[unsafe(method(respondsToSelector:))]
        fn responds(&self, selector: Sel) -> bool {
            let own: bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
            own || self.ivars().action.respondsToSelector(selector)
        }
        #[unsafe(method(forwardingTargetForSelector:))]
        fn forward(&self, _selector: Sel) -> *mut AnyObject {
            Retained::as_ptr(&self.ivars().action) as *mut AnyObject
        }
    }
);

struct State {
    original: Retained<ProtocolObject<dyn WKUIDelegate>>,
}
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = State]
    struct TabWindows;
    unsafe impl NSObjectProtocol for TabWindows {}
    unsafe impl WKUIDelegate for TabWindows {}
    impl TabWindows {
        #[unsafe(method(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn create(&self, view: &WKWebView, configuration: &AnyObject, action: &WKNavigationAction, features: &AnyObject) -> *mut WKWebView {
            let original = &*self.ivars().original;
            if !original.respondsToSelector(sel!(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:)) {
                return std::ptr::null_mut();
            }
            unsafe {
                let empty = action.request().URL().and_then(|url| url.absoluteString()).is_none_or(|url| url.is_empty());
                if !empty {
                    return msg_send![original, webView: view, createWebViewWithConfiguration: configuration, forNavigationAction: action, windowFeatures: features];
                }
                let url: Retained<AnyObject> = msg_send![class!(NSURL), URLWithString: &*NSString::from_str("about:blank")];
                let request: Retained<AnyObject> = msg_send![class!(NSURLRequest), requestWithURL: &*url];
                let allocated = BlankAction::alloc(MainThreadMarker::from(self)).set_ivars(Blank { action: action.retain(), request });
                let blank: Retained<BlankAction> = msg_send![super(allocated), init];
                msg_send![original, webView: view, createWebViewWithConfiguration: configuration, forNavigationAction: &*blank, windowFeatures: features]
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
    }
);
thread_local! { static DELEGATES: RefCell<HashMap<String, Retained<TabWindows>>> = RefCell::new(HashMap::new()); }

pub fn install(view: &tauri::Webview, id: String) -> Result<(), String> {
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let Some(original) = wk.UIDelegate() else { return; };
        let Some(main) = MainThreadMarker::new() else { return; };
        let allocated = TabWindows::alloc(main).set_ivars(State { original });
        let delegate: Retained<TabWindows> = msg_send![super(allocated), init];
        wk.setUIDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        DELEGATES.with(|delegates| { delegates.borrow_mut().insert(id, delegate); });
    })
    .map_err(|e| e.to_string())
}
pub fn release(view: &tauri::Webview) {
    let id = view.label().trim_start_matches("browser-").to_string();
    let _ = view.with_webview(move |platform| unsafe {
        if let Some(delegate) = DELEGATES.with(|delegates| delegates.borrow_mut().remove(&id)) {
            let wk = &*(platform.inner() as *const WKWebView);
            wk.setUIDelegate(Some(&delegate.ivars().original));
        }
    });
}
