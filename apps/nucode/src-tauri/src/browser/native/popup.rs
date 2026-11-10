use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, ProtocolObject, Sel},
    DefinedClass, MainThreadOnly, Message,
};
use objc2_foundation::{MainThreadMarker, NSObject, NSObjectProtocol};
use objc2_web_kit::{WKUIDelegate, WKWebView};
use std::{cell::RefCell, collections::HashMap};

struct State {
    original: Retained<ProtocolObject<dyn WKUIDelegate>>,
    window: tauri::WebviewWindow,
}
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = State]
    struct PopupEvents;
    unsafe impl NSObjectProtocol for PopupEvents {}
    unsafe impl WKUIDelegate for PopupEvents {}
    impl PopupEvents {
        #[unsafe(method(respondsToSelector:))]
        fn responds(&self, selector: Sel) -> bool {
            let own: bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
            own || self.ivars().original.respondsToSelector(selector)
        }
        #[unsafe(method(forwardingTargetForSelector:))]
        fn forward(&self, _selector: Sel) -> *mut AnyObject {
            Retained::as_ptr(&self.ivars().original) as *mut AnyObject
        }
        #[unsafe(method(webViewDidClose:))]
        fn closed(&self, _view: &WKWebView) {
            let window = self.ivars().window.clone();
            let _ = window.close().or_else(|_| window.destroy());
        }
    }
);
thread_local! { static DELEGATES: RefCell<HashMap<String,(Retained<PopupEvents>, Retained<WKWebView>)>> = RefCell::new(HashMap::new()); }

pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let popup = window.clone();
    window.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        super::macos::drop_app_bridge(wk);
        let Some(original) = wk.UIDelegate() else { return; };
        let Some(main) = MainThreadMarker::new() else { return; };
        let label = popup.label().to_string();
        let allocated = PopupEvents::alloc(main).set_ivars(State { original, window: popup });
        let delegate: Retained<PopupEvents> = msg_send![super(allocated), init];
        wk.setUIDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        DELEGATES.with(|delegates| { delegates.borrow_mut().insert(label, (delegate, wk.retain())); });
    })?;
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some((_, view)) = DELEGATES.with(|delegates| delegates.borrow_mut().remove(&label)) {
                super::macos::close_page(&view);
            }
        }
    });
    Ok(())
}
