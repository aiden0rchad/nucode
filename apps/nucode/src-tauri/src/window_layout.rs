#[derive(Clone, Copy)]
pub(crate) struct Rect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

/// None when `frame` fills `bounds` within 1 pt on every edge; otherwise a short description.
/// Each edge difference is `frame_edge - bounds_edge` in the superview's own coordinate space
/// (AppKit: origin bottom-left unless the superview is flipped, so "top" is the max-y edge).
pub(crate) fn drift(frame: &Rect, bounds: &Rect) -> Option<String> {
    let top = (frame.y + frame.h) - (bounds.y + bounds.h);
    let bottom = frame.y - bounds.y;
    let left = frame.x - bounds.x;
    let right = (frame.x + frame.w) - (bounds.x + bounds.w);
    if [top, bottom, left, right].iter().all(|d| d.abs() <= 1.) { return None; }
    let r = |rect: &Rect| format!("{},{} {}x{}", n(rect.x), n(rect.y), n(rect.w), n(rect.h));
    Some(format!("frame {} in bounds {} (top {}, bottom {}, left {}, right {})", r(frame), r(bounds), n(top), n(bottom), n(left), n(right)))
}

/// True when either top inset moved more than 1 pt from the first observed (safe, obscured) pair.
fn inset_changed(base: (f64, f64), now: (f64, f64)) -> bool {
    (base.0 - now.0).abs() > 1. || (base.1 - now.1).abs() > 1.
}

fn n(v: f64) -> f64 { (v * 10.).round() / 10. }

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct Insets { top: f64, left: f64, bottom: f64, right: f64 }

#[cfg(target_os = "macos")]
unsafe impl objc2::Encode for Insets {
    const ENCODING: objc2::Encoding = objc2::Encoding::Struct(
        "NSEdgeInsets",
        &[objc2::Encoding::Double, objc2::Encoding::Double, objc2::Encoding::Double, objc2::Encoding::Double],
    );
}

/// Compare the main WKWebView with its superview, repair a drifted frame and record what was seen.
#[cfg(target_os = "macos")]
pub(crate) fn check(webview: &tauri::Webview, reason: &'static str) {
    let _ = webview.with_webview(move |platform| unsafe { inspect(platform.inner().cast(), reason) });
}

#[cfg(target_os = "macos")]
unsafe fn inspect(wk: *mut objc2::runtime::AnyObject, reason: &'static str) {
    use objc2::{
        msg_send,
        runtime::AnyObject,
        sel,
    };
    use objc2_foundation::NSRect;
    use std::{sync::Mutex, time::{Duration, Instant}};
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    static BASE: Mutex<Option<(f64, f64)>> = Mutex::new(None);
    if wk.is_null() { return; }
    let rect = |r: NSRect| Rect { x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height };
    let show = |r: &Rect| format!("{},{} {}x{}", n(r.x), n(r.y), n(r.w), n(r.h));
    let insets = |i: Insets| format!("t{} l{} b{} r{}", n(i.top), n(i.left), n(i.bottom), n(i.right));
    let superview: *mut AnyObject = msg_send![wk, superview];
    if superview.is_null() { return; }
    let frame = rect(msg_send![wk, frame]);
    let bounds = rect(msg_send![superview, bounds]);
    let flipped: bool = msg_send![superview, isFlipped];
    let safe: Insets = msg_send![wk, safeAreaInsets];
    let responds: bool = msg_send![wk, respondsToSelector: sel!(obscuredContentInsets)];
    let obscured: Option<Insets> = if responds { Some(msg_send![wk, obscuredContentInsets]) } else { None };
    let drifted = drift(&frame, &bounds);
    let tops = (safe.top, obscured.map_or(0., |o| o.top));
    let base = {
        let Ok(mut base) = BASE.lock() else { return };
        *base.get_or_insert(tops)
    };
    let inset = inset_changed(base, tops);
    if drifted.is_none() && !inset { return; }
    if drifted.is_some() {
        let () = msg_send![wk, setFrame: msg_send_rect(&bounds)];
    }
    let now = Instant::now();
    {
        let Ok(mut last) = LAST.lock() else { return };
        if last.is_some_and(|t| now.duration_since(t) < Duration::from_secs(60)) { return; }
        *last = Some(now);
    }
    let window: *mut AnyObject = msg_send![wk, window];
    let (mut content, mut layout, mut classes) = ("n/a".to_string(), "n/a".to_string(), Vec::<String>::new());
    if !window.is_null() {
        let view: *mut AnyObject = msg_send![window, contentView];
        if !view.is_null() {
            content = show(&rect(msg_send![view, bounds]));
            let subviews: *mut AnyObject = msg_send![view, subviews];
            let count: usize = if subviews.is_null() { 0 } else { msg_send![subviews, count] };
            for i in 0..count {
                let sub: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
                if !sub.is_null() { classes.push((*sub).class().name().to_string_lossy().into_owned()); }
            }
        }
        layout = show(&rect(msg_send![window, contentLayoutRect]));
    }
    let note = format!(
        "reason {reason}; {}; repaired: {}; superview flipped: {flipped}; content bounds {content}; contentLayoutRect {layout}; safe-area insets {}; obscured insets {}; baseline insets t{} / t{}; contentView subviews [{}]",
        drifted.as_deref().unwrap_or("frame fills bounds"),
        if drifted.is_some() { "yes" } else { "no" },
        insets(safe),
        obscured.map(insets).unwrap_or_else(|| "n/a".into()),
        n(base.0), n(base.1),
        classes.join(", "),
    );
    nucode_diag_mcp::writer::record(|| {
        let mut e = nucode_diag_mcp::core::event("error", "ui", "ui.main_view_drift", "Main view moved inside the window");
        e.detail = serde_json::json!({ "note": note });
        e
    });
}

#[cfg(target_os = "macos")]
fn msg_send_rect(r: &Rect) -> objc2_foundation::NSRect {
    objc2_foundation::NSRect::new(objc2_foundation::NSPoint::new(r.x, r.y), objc2_foundation::NSSize::new(r.w, r.h))
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn check(_webview: &tauri::Webview, _reason: &'static str) {}

/// Main-window events that can move the main view: check it against its superview (macOS only).
pub(crate) fn after_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    use tauri::{Manager, WindowEvent};
    if cfg!(target_os = "macos") && matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } | WindowEvent::Focused(true)) {
        if let Some(main) = window.app_handle().get_webview("main") { check(&main, "window event"); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const BOUNDS: Rect = Rect { x: 0., y: 0., w: 1568., h: 758. };
    #[test]
    fn exact_fit_and_one_point_are_fine() {
        assert!(drift(&BOUNDS, &BOUNDS).is_none());
        assert!(drift(&Rect { x: 0.5, y: -1., w: 1568., h: 758.9 }, &BOUNDS).is_none());
    }
    #[test]
    fn inset_change_needs_more_than_one_point() {
        assert!(!inset_changed((28., 0.), (28., 0.)));
        assert!(!inset_changed((28., 0.), (28.9, 0.5)));
        assert!(inset_changed((28., 0.), (56., 0.)));
    }
    #[test]
    fn shifted_down_names_top_and_bottom() {
        let text = drift(&Rect { x: 0., y: -60., w: 1568., h: 758. }, &BOUNDS).unwrap();
        assert!(text.contains("top -60") && text.contains("bottom -60"), "{text}");
    }
    #[test]
    fn shorter_at_the_top_is_drift() {
        let text = drift(&Rect { x: 0., y: 0., w: 1568., h: 698. }, &BOUNDS).unwrap();
        assert!(text.contains("top -60, bottom 0, left 0, right 0"), "{text}");
    }
}
