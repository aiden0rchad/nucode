//! The agent's visible cursor: an arrow drawn over the page that glides to a target and presses it with real
//! (trusted) mouse events, so the user can watch where the agent clicks and sites see ordinary pointer input.
//! The arrow is a sublayer of the WKWebView's layer: it never takes part in hit testing, and page snapshots
//! render web content only, so it never shows up in the model's screenshots.
use objc2::rc::Retained;
use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{CGColor, CGMutablePath};
use objc2_foundation::{ns_string, NSArray, NSNumber, NSProcessInfo};
use objc2_quartz_core::{
    kCALineJoinRound, kCAMediaTimingFunctionEaseInEaseOut, kCAMediaTimingFunctionEaseOut, CABasicAnimation,
    CAKeyframeAnimation, CALayer, CAMediaTiming, CAMediaTimingFunction, CAShapeLayer, CATransaction,
};
use objc2_web_kit::WKWebView;
use std::time::Duration;
use tauri::Webview;

const CURSOR: &str = "nucode.agentCursor";
const RING: &str = "ring";

struct Glide {
    moves: Vec<CGPoint>,
    end: CGPoint,
    step: Duration,
}

/// Glide to (x, y), in CSS pixels of a viewport `css_width` wide, and press there.
/// Errors only before the press, so a caller can fall back to a synthetic click without clicking twice.
pub async fn click(view: &Webview, x: f64, y: f64, css_width: f64) -> Result<(), String> {
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let (tx, rx) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let _ = tx.send(glide(wk, x, y, css_width, seed));
    })
    .map_err(|e| e.to_string())?;
    let glide = rx.await.map_err(|_| "Native view closed")??;
    for at in glide.moves {
        tokio::time::sleep(glide.step).await;
        mouse(view, NSEventType::MouseMoved, at)?;
    }
    // A person settles on the target for a beat before pressing, and holds the button briefly.
    tokio::time::sleep(Duration::from_millis(70 + (seed % 90) as u64)).await;
    mouse(view, NSEventType::LeftMouseDown, glide.end)?;
    tokio::time::sleep(Duration::from_millis(45 + (seed / 7 % 50) as u64)).await;
    let _ = mouse(view, NSEventType::LeftMouseUp, glide.end);
    Ok(())
}

unsafe fn glide(wk: &WKWebView, x: f64, y: f64, css_width: f64, seed: u32) -> Result<Glide, String> {
    let bounds = wk.bounds();
    if !(css_width > 0.0 && bounds.size.width > 0.0) { return Err("Browser view has no size".into()); }
    let layer = wk.layer().ok_or("Browser view has no layer")?;
    let scale = bounds.size.width / css_width;
    let flipped = wk.isFlipped();
    // View points, whichever way this view's y axis runs; `down` is the sign of "visually lower" in view space.
    let down = if flipped { 1.0 } else { -1.0 };
    let to_view = |cx: f64, cy: f64| CGPoint::new(cx * scale, if flipped { cy * scale } else { bounds.size.height - cy * scale });
    let end = to_view(x, y);
    // The layer's interior may run either way too; the arrow is drawn with its tip up in whichever it is.
    let top = wk.convertPointToLayer(to_view(0.0, 0.0));
    let bottom = wk.convertPointToLayer(to_view(0.0, 10.0));
    let layer_down = if bottom.y > top.y { 1.0 } else { -1.0 };

    let existing = cursor(&layer);
    let fresh = existing.is_none();
    let cursor = existing.unwrap_or_else(|| {
        let cursor = make_cursor(layer_down);
        layer.addSublayer(&cursor);
        cursor
    });
    let start = if fresh {
        // A new cursor drifts in from just below and to the right of the target.
        let p = CGPoint::new(end.x + 48.0, end.y + down * 64.0);
        CGPoint::new(p.x.clamp(0.0, bounds.size.width), p.y.clamp(0.0, bounds.size.height))
    } else {
        wk.convertPointFromLayer(cursor.position())
    };
    let (dx, dy) = (end.x - start.x, end.y - start.y);
    let distance = dx.hypot(dy);
    let millis = (180.0 + distance * 0.5).clamp(260.0, 700.0);
    // Bow the path to one side, the way a hand arcs, instead of a ruler-straight line.
    let bend = if seed % 2 == 0 { 0.16 } else { -0.16 };
    let ctrl = CGPoint::new((start.x + end.x) / 2.0 - dy * bend, (start.y + end.y) / 2.0 + dx * bend);

    let (s, c, e) = (wk.convertPointToLayer(start), wk.convertPointToLayer(ctrl), wk.convertPointToLayer(end));
    let path = CGMutablePath::new();
    CGMutablePath::move_to_point(Some(&path), std::ptr::null(), s.x, s.y);
    CGMutablePath::add_quad_curve_to_point(Some(&path), std::ptr::null(), c.x, c.y, e.x, e.y);
    let motion = CAKeyframeAnimation::animationWithKeyPath(Some(ns_string!("position")));
    motion.setPath(Some(&path));
    motion.setDuration(millis / 1000.0);
    motion.setTimingFunction(Some(&CAMediaTimingFunction::functionWithName(kCAMediaTimingFunctionEaseInEaseOut)));

    CATransaction::begin();
    CATransaction::setDisableActions(true);
    cursor.removeAnimationForKey(ns_string!("fade"));
    cursor.setOpacity(1.0);
    cursor.setPosition(e);
    cursor.addAnimation_forKey(&motion, Some(ns_string!("glide")));
    if fresh { cursor.addAnimation_forKey(&fade(0.0, 1.0, 0.18), Some(ns_string!("appear"))); }
    CATransaction::commit();

    // Real pointer moves along the same curve, so hover styles and mouse listeners see a pointer arrive.
    let window = |p: CGPoint| wk.convertPoint_toView(p, None);
    let steps = ((millis / 16.0) as usize).max(4);
    let moves = (1..=steps)
        .map(|i| {
            let t = i as f64 / steps as f64;
            let t = t * t * (3.0 - 2.0 * t);
            let u = 1.0 - t;
            window(CGPoint::new(
                u * u * start.x + 2.0 * u * t * ctrl.x + t * t * end.x,
                u * u * start.y + 2.0 * u * t * ctrl.y + t * t * end.y,
            ))
        })
        .collect();
    Ok(Glide { moves, end: window(end), step: Duration::from_millis((millis / steps as f64) as u64) })
}

fn mouse(view: &Webview, kind: NSEventType, at: CGPoint) -> Result<(), String> {
    view.with_webview(move |platform| unsafe {
        let wk = &*(platform.inner() as *const WKWebView);
        let Some(window) = wk.window() else { return };
        let (clicks, pressure) = match kind {
            NSEventType::MouseMoved => (0, 0.0),
            NSEventType::LeftMouseDown => (1, 1.0),
            _ => (1, 0.0),
        };
        let Some(event) = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
            kind, at, NSEventModifierFlags(0), NSProcessInfo::processInfo().systemUptime(), window.windowNumber(), None, 0, clicks, pressure,
        ) else { return };
        match kind {
            NSEventType::MouseMoved => wk.mouseMoved(&event),
            NSEventType::LeftMouseDown => {
                if let Some(cursor) = wk.layer().and_then(|l| cursor(&l)) { pressed(&cursor); }
                wk.mouseDown(&event)
            }
            _ => {
                wk.mouseUp(&event);
                if let Some(cursor) = wk.layer().and_then(|l| cursor(&l)) { released(&cursor); }
            }
        }
    })
    .map_err(|e| e.to_string())
}

unsafe fn cursor(layer: &CALayer) -> Option<Retained<CALayer>> {
    layer.sublayers()?.iter().find(|l| l.name().is_some_and(|n| &*n == ns_string!(CURSOR)))
}

fn accent(alpha: f64) -> objc2_core_foundation::CFRetained<CGColor> { CGColor::new_generic_rgb(0.25, 0.48, 1.0, alpha) }

unsafe fn make_cursor(down: f64) -> Retained<CALayer> {
    let cursor = CALayer::new();
    cursor.setName(Some(ns_string!(CURSOR)));
    cursor.setZPosition(10_000.0);
    // Zero-size bounds put the arrow's tip exactly at `position`.
    cursor.setBounds(CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(0.0, 0.0)));

    let ring = CAShapeLayer::new();
    ring.setName(Some(ns_string!(RING)));
    let circle = CGMutablePath::new();
    CGMutablePath::add_ellipse_in_rect(Some(&circle), std::ptr::null(), CGRect::new(CGPoint::new(-14.0, -14.0), CGSize::new(28.0, 28.0)));
    ring.setPath(Some(&circle));
    ring.setFillColor(Some(&accent(0.18)));
    ring.setStrokeColor(Some(&accent(0.9)));
    ring.setLineWidth(2.0);
    ring.setOpacity(0.0);
    cursor.addSublayer(&ring);

    let arrow = CAShapeLayer::new();
    let outline = CGMutablePath::new();
    let points = [(0.0, 0.0), (0.0, 18.0), (4.6, 13.8), (7.8, 20.8), (10.6, 19.6), (7.5, 12.9), (13.4, 12.9)];
    for (i, (px, py)) in points.into_iter().enumerate() {
        if i == 0 { CGMutablePath::move_to_point(Some(&outline), std::ptr::null(), px, py * down); }
        else { CGMutablePath::add_line_to_point(Some(&outline), std::ptr::null(), px, py * down); }
    }
    CGMutablePath::close_subpath(Some(&outline));
    arrow.setPath(Some(&outline));
    arrow.setFillColor(Some(&accent(1.0)));
    arrow.setStrokeColor(Some(&CGColor::new_generic_rgb(1.0, 1.0, 1.0, 1.0)));
    arrow.setLineWidth(1.5);
    arrow.setLineJoin(kCALineJoinRound);
    arrow.setShadowColor(Some(&accent(1.0)));
    arrow.setShadowOpacity(0.6);
    arrow.setShadowRadius(5.0);
    arrow.setShadowOffset(CGSize::new(0.0, 0.0));
    cursor.addSublayer(&arrow);
    cursor
}

fn fade(from: f32, to: f32, seconds: f64) -> Retained<CABasicAnimation> {
    let animation = CABasicAnimation::animationWithKeyPath(Some(ns_string!("opacity")));
    unsafe {
        animation.setFromValue(Some(&NSNumber::new_f32(from)));
        animation.setToValue(Some(&NSNumber::new_f32(to)));
    }
    animation.setDuration(seconds);
    animation
}

unsafe fn pressed(cursor: &CALayer) {
    let squeeze = CABasicAnimation::animationWithKeyPath(Some(ns_string!("transform.scale")));
    squeeze.setFromValue(Some(&NSNumber::new_f64(1.0)));
    squeeze.setToValue(Some(&NSNumber::new_f64(0.86)));
    squeeze.setDuration(0.08);
    squeeze.setAutoreverses(true);
    cursor.addAnimation_forKey(&squeeze, Some(ns_string!("press")));
}

unsafe fn released(cursor: &CALayer) {
    if let Some(ring) = cursor.sublayers().and_then(|s| s.iter().find(|l| l.name().is_some_and(|n| &*n == ns_string!(RING)))) {
        let grow = CABasicAnimation::animationWithKeyPath(Some(ns_string!("transform.scale")));
        grow.setFromValue(Some(&NSNumber::new_f64(0.4)));
        grow.setToValue(Some(&NSNumber::new_f64(1.5)));
        grow.setDuration(0.42);
        grow.setTimingFunction(Some(&CAMediaTimingFunction::functionWithName(kCAMediaTimingFunctionEaseOut)));
        ring.addAnimation_forKey(&grow, Some(ns_string!("grow")));
        ring.addAnimation_forKey(&fade(0.9, 0.0, 0.42), Some(ns_string!("ripple")));
    }
    // Linger where it clicked so the user can see it, then fade until the next action brings it back.
    let linger = CAKeyframeAnimation::animationWithKeyPath(Some(ns_string!("opacity")));
    let values: Retained<NSArray<NSNumber>> = NSArray::from_retained_slice(&[NSNumber::new_f32(1.0), NSNumber::new_f32(1.0), NSNumber::new_f32(0.0)]);
    // `values` is untyped (NSArray<AnyObject>) in the binding; an NSArray<NSNumber> is one.
    linger.setValues(Some(&*(Retained::as_ptr(&values) as *const NSArray)));
    linger.setKeyTimes(Some(&NSArray::from_retained_slice(&[NSNumber::new_f64(0.0), NSNumber::new_f64(0.85), NSNumber::new_f64(1.0)])));
    linger.setDuration(4.0);
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    cursor.setOpacity(0.0);
    cursor.addAnimation_forKey(&linger, Some(ns_string!("fade")));
    CATransaction::commit();
}
