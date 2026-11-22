use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq)]
pub enum Navigation {
    Allow,
    Block,
    External,
}
/// Subframes cannot open app resources or launch external handlers.
pub fn subframe_navigation(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "about" | "data" | "blob"))
}
pub fn navigation(url: &str, current: &str) -> Navigation {
    let Ok(url) = reqwest::Url::parse(url) else {
        return Navigation::Block;
    };
    if url
        .host_str()
        .is_some_and(|h| h == "tauri.localhost" || h == "asset.localhost" || h == "ipc.localhost")
    {
        return Navigation::Block;
    }
    match url.scheme() {
        "http" | "https" => Navigation::Allow,
        "about" if url.as_str() == "about:blank" => Navigation::Allow,
        "data"
            if [
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
                "image/avif",
                "image/bmp",
            ]
            .iter()
            .any(|mime| {
                url.path()
                    .strip_prefix(mime)
                    .is_some_and(|s| s.starts_with(';') || s.starts_with(','))
            }) =>
        {
            Navigation::Allow
        }
        "blob"
            if reqwest::Url::parse(url.path())
                .ok()
                .zip(reqwest::Url::parse(current).ok())
                .is_some_and(|(a, b)| {
                    matches!(b.scheme(), "http" | "https") && a.origin() == b.origin()
                }) =>
        {
            Navigation::Allow
        }
        "file" | "tauri" | "asset" | "ipc" | "nucode" | "codex-monitor" | "javascript"
        | "about" | "data" | "blob" => Navigation::Block,
        _ => Navigation::External,
    }
}
pub fn opens_popup(url: &str, has_size: bool, has_position: bool) -> bool {
    has_size || has_position || url == "about:blank"
}
pub fn label(id: &str) -> Result<String, String> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("Invalid browser tab ID".into());
    }
    Ok(format!("browser-{id}"))
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
/// Smallest and largest viewport an agent may ask for, in CSS pixels.
pub const VIEWPORT_WIDTH: (f64, f64) = (240., 3840.);
pub const VIEWPORT_HEIGHT: (f64, f64) = (240., 2160.);
/// Size of a page the pane isn't showing, parked offscreen, when no agent viewport is set.
pub const PARKED_SIZE: (f64, f64) = (800., 600.);
/// The size a parked page gets, in CSS pixels: it lays out at its view's size, so an agent's viewport is the size
/// itself (with the pane's height, if the page has a pane, when no height was asked for). Without one the page
/// takes its pane's size, or the default.
pub fn parked_size(viewport: Option<(f64, Option<f64>)>, pane: Option<Rect>) -> (f64, f64) {
    match viewport {
        Some((width, height)) => (width, height.or(pane.map(|p| p.h)).unwrap_or(PARKED_SIZE.1)),
        None => pane.map_or(PARKED_SIZE, |p| (p.w, p.h)),
    }
}
/// Lays an agent's requested viewport out inside the pane, in the pane's points. A narrower viewport keeps full size
/// and is centred; a wider one is scaled down with page zoom, so the page still lays out at the requested width and
/// the user sees all of it. Returns the view's bounds and the page zoom to apply.
pub fn fit_viewport(pane: Rect, width: f64, height: Option<f64>) -> (Rect, f64) {
    let zoom = (pane.w / width).min(1.);
    let w = (width * zoom).min(pane.w);
    let h = height.map_or(pane.h, |h| (h * zoom).min(pane.h));
    (Rect { x: pane.x + (pane.w - w) / 2., y: pane.y, w, h }, zoom)
}
/// A native view may only occupy bounds measured for its own mounted UI slot.
#[derive(Default)]
pub struct Placement {
    tab: String,
    rect: Option<Rect>,
    visible: bool,
}
impl Placement {
    pub fn update(&mut self, tab: &str, rect: Option<Rect>, visible: Option<bool>) -> Result<(), String> {
        let rect = rect.map(Rect::validate).transpose()?;
        if self.tab != tab { *self = Self { tab: tab.into(), ..Self::default() }; }
        if let Some(rect) = rect { self.rect = Some(rect); }
        if let Some(visible) = visible { self.visible = visible; }
        Ok(())
    }
    pub fn rect(&self, tab: &str) -> Option<Rect> {
        self.rect.filter(|_| self.visible && self.tab == tab)
    }
    pub fn detach(&mut self) { *self = Self::default(); }
}
impl Rect {
    pub fn scaled(self, zoom: f64) -> Result<Self, String> {
        if !zoom.is_finite() || zoom <= 0. { return Err("Invalid UI zoom".into()); }
        Self { x: self.x * zoom, y: self.y * zoom, w: self.w * zoom, h: self.h * zoom }.validate()
    }
    pub fn validate(self) -> Result<Self, String> {
        if ![self.x, self.y, self.w, self.h]
            .iter()
            .all(|n| n.is_finite())
            || self.x < 0.
            || self.y < 0.
            || self.w < 1.
            || self.h < 1.
            || self.x + self.w > 32768.
            || self.y + self.h > 32768.
        {
            return Err("Invalid browser bounds".into());
        }
        Ok(Self {
            x: self.x.round(),
            y: self.y.round(),
            w: self.w.round(),
            h: self.h.round(),
        })
    }
}
/// Oldest hidden view is evicted; tab metadata remains in the shared state.
pub fn touch(live: &mut Vec<String>, id: &str) -> Option<String> {
    live.retain(|s| s != id);
    live.push(id.into());
    (live.len() > 8).then(|| live.remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subframes_allow_web_documents_but_never_app_or_external_schemes() {
        for url in ["http://example.test/", "https://example.test/", "about:blank", "about:srcdoc", "about:anything", "data:text/html,hello", "blob:https://other.test/id", "blob:null/id"] {
            assert!(subframe_navigation(url), "{url}");
        }
        for url in ["file:///etc/passwd", "javascript:alert(1)", "tauri://localhost", "asset://localhost/a", "ipc://localhost", "nucode://open", "mailto:a@example.test", "custom:value", "", "not a URL"] {
            assert!(!subframe_navigation(url), "{url}");
        }
    }
    #[test]
    fn popup_features_preserve_script_openers() {
        assert!(!opens_popup("https://example.com", false, false));
        assert!(opens_popup("https://example.com", true, false));
        assert!(opens_popup("https://example.com", false, true));
        assert!(opens_popup("about:blank", false, false));
    }
    #[test]
    fn native_placement_does_not_leak_between_closed_or_agent_created_tabs() {
        let mut placement = Placement::default();
        let rect = Rect { x: 500., y: 90., w: 400., h: 600. };
        placement.update("ui-tab", Some(rect), Some(true)).unwrap();
        assert_eq!(placement.rect("ui-tab"), Some(rect));
        assert_eq!(placement.rect("agent-tab"), None);
        placement.detach();
        assert_eq!(placement.rect("ui-tab"), None);
        placement.update("agent-tab", None, Some(true)).unwrap();
        assert_eq!(placement.rect("agent-tab"), None);
        placement.update("agent-tab", Some(rect), Some(true)).unwrap();
        assert_eq!(placement.rect("agent-tab"), Some(rect));
        placement.update("agent-tab", None, Some(false)).unwrap();
        assert_eq!(placement.rect("agent-tab"), None);
    }
    #[test]
    fn browser_bounds_convert_css_pixels_to_native_points_at_ui_zoom() {
        let rect = Rect { x: 400., y: 80., w: 500., h: 600. };
        assert_eq!(rect.scaled(0.8).unwrap(), Rect { x: 320., y: 64., w: 400., h: 480. });
        assert_eq!(rect.scaled(1.25).unwrap(), Rect { x: 500., y: 100., w: 625., h: 750. });
        assert!(rect.scaled(f64::NAN).is_err());
    }
    #[test]
    fn navigation_policy() {
        for url in [
            "https://example.com",
            "http://localhost:3000",
            "about:blank",
            "data:image/png;base64,AA",
            "blob:https://example.com/id",
        ] {
            assert_eq!(
                navigation(url, "https://example.com"),
                Navigation::Allow,
                "{url}"
            );
        }
        for url in [
            "file:///etc/passwd",
            "tauri://localhost",
            "asset://localhost/a",
            "ipc://x",
            "javascript:alert(1)",
            "about:config",
            "data:text/html,hi",
            "data:image/svg+xml,<svg/>",
            "blob:https://evil.com/id",
            "nucode://open",
            "https://tauri.localhost",
        ] {
            assert_eq!(
                navigation(url, "https://example.com"),
                Navigation::Block,
                "{url}"
            );
        }
        assert_eq!(navigation("mailto:a@example.com", ""), Navigation::External);
    }
    #[test]
    fn labels_bounds_and_lru() {
        assert!(label("../main").is_err());
        assert!(label("").is_err());
        assert_eq!(label("tab-1").unwrap(), "browser-tab-1");
        assert!(Rect {
            x: 0.,
            y: 0.,
            w: f64::NAN,
            h: 20.
        }
        .validate()
        .is_err());
        assert_eq!(
            Rect {
                x: 1.4,
                y: 2.6,
                w: 100.2,
                h: 50.
            }
            .validate()
            .unwrap()
            .y,
            3.
        );
        let mut live = (0..8).map(|n| n.to_string()).collect();
        assert_eq!(touch(&mut live, "0"), None);
        assert_eq!(touch(&mut live, "8"), Some("1".into()));
        assert_eq!(live.len(), 8);
    }
    #[test]
    fn capabilities_exclude_browser_webviews() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let value: serde_json::Value =
                serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let caps = value["capabilities"]
                .as_array()
                .cloned()
                .unwrap_or(vec![value]);
            for cap in caps {
                assert!(cap.get("remote").is_none());
                assert!(cap.get("windows").is_none());
                for label in cap["webviews"].as_array().unwrap() {
                    assert!(matches!(label.as_str(), Some("main" | "about" | "thread-*")));
                }
            }
        }
    }
}

pub(super) fn allowed_origin(url: &reqwest::Url, settings: &super::Settings) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return true;
    }
    let origin = url.origin().ascii_serialization();
    let matches = |pattern: &String| {
        pattern == "*"
            || pattern == &origin
            || pattern.strip_prefix("*.").is_some_and(|host| {
                url.host_str()
                    .is_some_and(|h| h == host || h.ends_with(&format!(".{host}")))
            })
    };
    !settings.blocked_origins.iter().any(matches)
        && (settings.allowed_origins.is_empty() || settings.allowed_origins.iter().any(matches))
}

pub(super) fn automation_allowed(url: &reqwest::Url, settings: &super::Settings) -> bool {
    let origin = if url.scheme() == "blob" {
        let Ok(origin) = reqwest::Url::parse(url.path()) else { return false; };
        origin
    } else { url.clone() };
    navigation(url.as_str(), origin.as_str()) == Navigation::Allow && allowed_origin(&origin, settings)
}

pub(super) fn check_target(params: &serde_json::Value, tab: &str, url: Option<&str>) -> Result<(), String> {
    for (key, actual) in [("tabId", Some(tab)), ("expectedUrl", url)] {
        if let (Some(expected), Some(actual)) = (params.get(key).filter(|value| !value.is_null()), actual) {
            if expected.as_str() != Some(actual) {
                return Err("Browser page changed; retry on the current page".into());
            }
        }
    }
    Ok(())
}


#[cfg(test)]
mod viewport_tests {
    use super::*;
    const PANE: Rect = Rect { x: 100., y: 50., w: 800., h: 600. };
    #[test]
    fn a_narrower_viewport_is_centred_at_full_size() {
        let (rect, zoom) = fit_viewport(PANE, 390., None);
        assert_eq!((rect, zoom), (Rect { x: 305., y: 50., w: 390., h: 600. }, 1.));
        let (rect, _) = fit_viewport(PANE, 390., Some(844.));
        assert_eq!(rect.h, 600., "a taller viewport than the pane keeps the pane height");
        let (rect, _) = fit_viewport(PANE, 390., Some(400.));
        assert_eq!(rect.h, 400.);
    }
    #[test]
    fn a_parked_page_takes_the_agents_viewport_as_its_size() {
        // A wide viewport is not scaled down offscreen: the page's own size is what it lays out at.
        assert_eq!(parked_size(Some((1440., Some(900.))), Some(PANE)), (1440., 900.));
        assert_eq!(parked_size(Some((1440., None)), Some(PANE)), (1440., 600.), "no height: the pane's");
        assert_eq!(parked_size(Some((390., None)), None), (390., PARKED_SIZE.1), "no pane: the default height");
        // Clearing the viewport returns the page to its pane's size, or the default.
        assert_eq!(parked_size(None, Some(PANE)), (800., 600.));
        assert_eq!(parked_size(None, Some(Rect { x: 0., y: 0., w: 462., h: 700. })), (462., 700.));
        assert_eq!(parked_size(None, None), PARKED_SIZE);
    }
    #[test]
    fn a_wider_viewport_is_scaled_to_fit_and_still_lays_out_at_its_width() {
        let (rect, zoom) = fit_viewport(PANE, 1600., Some(1000.));
        assert_eq!(zoom, 0.5);
        assert_eq!((rect.x, rect.w, rect.h), (100., 800., 500.));
        // Page CSS width = view width / page zoom.
        assert_eq!(rect.w / zoom, 1600.);
        let (rect, zoom) = fit_viewport(PANE, 800., None);
        assert_eq!((rect, zoom), (PANE, 1.));
    }
}
