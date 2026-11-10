use futures_util::future::BoxFuture;
use serde_json::{json, Value};

/// The local socket and MCP adapter use the same backend as the pane.
pub trait BrowserBackend: Send + Sync {
    fn authorize_tool(&self, _args: Value) -> BoxFuture<'_, Result<(), String>> { Box::pin(async { Ok(()) }) }
    /// Whether a tool that changes the page also returns the new page's compact snapshot.
    fn snapshot_on_page_change(&self) -> bool { false }
    fn request(&self, params: Value) -> BoxFuture<'_, Result<Value, String>>;
    fn navigate(&self, url: &str) -> BoxFuture<'_, Result<Value, String>> {
        self.request(json!({"action":"navigate","url":url}))
    }
    fn snapshot(&self) -> BoxFuture<'_, Result<Value, String>> {
        self.request(json!({"action":"script","op":"snapshot"}))
    }
    fn click(&self, reference: &str) -> BoxFuture<'_, Result<Value, String>> {
        self.request(json!({"action":"script","op":"click","ref":reference}))
    }
    fn type_text(
        &self,
        reference: &str,
        text: &str,
        submit: bool,
    ) -> BoxFuture<'_, Result<Value, String>> {
        self.request(
            json!({"action":"script","op":"type","ref":reference,"text":text,"submit":submit}),
        )
    }
    fn press(&self, key: &str) -> BoxFuture<'_, Result<Value, String>> {
        self.request(json!({"action":"script","op":"press","key":key}))
    }
    fn select(&self, reference: &str, values: Value) -> BoxFuture<'_, Result<Value, String>> {
        self.request(json!({"action":"script","op":"select","ref":reference,"values":values}))
    }
    fn scroll(&self, params: Value) -> BoxFuture<'_, Result<Value, String>> {
        self.request(json!({"action":"script","op":"scroll","x":params["x"],"y":params["y"],"ref":params["ref"]}))
    }
    fn screenshot(&self) -> BoxFuture<'_, Result<Value, String>> {
        self.request(json!({"action":"screenshot"}))
    }
    fn tabs(&self, params: Value) -> BoxFuture<'_, Result<Value, String>> {
        self.request(params)
    }
    fn wait_for(&self, params: Value) -> BoxFuture<'_, Result<Value, String>> {
        self.request(json!({"action":"wait","text":params["text"],"textGone":params["textGone"],"ref":params["ref"],"time":params["time"]}))
    }
}

pub struct CdpBackend(pub tokio::sync::mpsc::Sender<super::bridge::Request>);
impl BrowserBackend for CdpBackend {
    fn request(&self, params: Value) -> BoxFuture<'_, Result<Value, String>> {
        Box::pin(async move {
            let (reply, receiver) = tokio::sync::oneshot::channel();
            self.0
                .send((params, reply))
                .await
                .map_err(|_| "Browser disconnected")?;
            tokio::time::timeout(std::time::Duration::from_secs(30), receiver)
                .await
                .map_err(|_| "Browser request timed out")?
                .map_err(|_| "Browser disconnected")?
        })
    }
}

fn reference(args: &Value) -> Result<&str, String> {
    args.get("target")
        .or_else(|| args.get("ref"))
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "Missing target (snapshot ref or unique selector)".into())
}

pub fn supported_tools() -> &'static [&'static str] {
    &[
        "browser_navigate", "browser_navigate_back", "browser_snapshot", "browser_click",
        "browser_type", "browser_press_key", "browser_select_option", "browser_fill_form",
        "browser_evaluate", "browser_scroll", "browser_wait_for", "browser_tabs",
        "browser_close", "browser_take_screenshot", "browser_console_messages", "browser_handle_dialog",
    ]
}

pub fn filter_tools(response: &mut Value, native: bool) {
    if native {
        if let Some(tools) = response.get_mut("result").and_then(|r| r.get_mut("tools")).and_then(Value::as_array_mut) {
            tools.retain(|tool| tool["name"].as_str().is_some_and(|name| supported_tools().contains(&name)));
            if !tools.iter().any(|tool| tool["name"] == "browser_scroll") {
                tools.push(json!({"name":"browser_scroll",
                    "description":"Scroll the page by x/y pixels, or scroll an element (snapshot ref or selector) into view.",
                    "inputSchema":{"type":"object","properties":{
                        "x":{"type":"number","description":"Horizontal pixels (+right)"},
                        "y":{"type":"number","description":"Vertical pixels (+down)"},
                        "ref":{"type":"string","description":"Snapshot ref or unique selector to scroll into view. With x/y, scroll inside the element instead."}
                    },"additionalProperties":false}}));
            }
            let input = ["browser_click", "browser_type", "browser_press_key", "browser_select_option", "browser_fill_form"];
            for tool in tools.iter_mut().filter(|tool| input.iter().any(|name| tool["name"] == *name)) {
                let note = if tool["name"] == "browser_click" {
                    "Clicks with real mouse events (a visible cursor presses the element), and waits for any page it opens to load; the result then includes that page's snapshot. Dropdowns, date pickers and file inputs get a synthetic click. If a click opens a popup window, the result says so."
                } else {
                    "Input is synthetic (not isTrusted). If a site ignores it, tell the user; the Headless Chromium backend (Settings → Browser) sends trusted input."
                };
                tool["description"] = json!(format!("{} {note}", tool["description"].as_str().unwrap_or("")));
            }
            for tool in tools.iter_mut().filter(|tool| tool["name"] == "browser_navigate") {
                tool["description"] = json!(format!("{} Returns once the page has loaded, followed by the page snapshot (as browser_snapshot gives it), so no browser_wait_for or browser_snapshot call is needed. This is the user's in-app browser; it keeps their sign-ins. If you don't know a site's exact address (say, an organisation's portal), check browser_tabs, search, or ask; don't guess a generic domain. If a page wants the user to sign in, ask them to sign in in the browser panel; don't switch to another browser or computer use.", tool["description"].as_str().unwrap_or("")));
            }
            for tool in tools.iter_mut().filter(|tool| tool["name"] == "browser_tabs") {
                tool["description"] = json!(format!("{} The list marks the active tab (\"active\":true), which the other browser tools act on. new and select return that tab's page snapshot.", tool["description"].as_str().unwrap_or("")));
            }
            for tool in tools.iter_mut().filter(|tool| tool["name"] == "browser_snapshot") {
                tool["description"] = json!("Compact page snapshot: interactive elements with refs (e.g. e12, for browser_click/type) in page order, plus the page's visible text as `text` lines (table rows joined with |). Links show their url (same-site ones as a path) for browser_navigate.");
            }
            for tool in tools.iter_mut().filter(|tool| tool["name"] == "browser_evaluate") {
                tool["description"] = json!("Evaluate a JavaScript function in the native page and return its result inline. Omit target (or use null) for a page-level function such as () => document.title.");
                tool["inputSchema"] = json!({"type":"object","properties":{
                    "function":{"type":"string","description":"JavaScript function, optionally async; receives the target element when supplied."},
                    "target":{"type":["string","null"],"description":"Optional snapshot ref or unique selector. Null evaluates at page level."}
                },"required":["function"],"additionalProperties":false});
            }
        }
    }
}

pub async fn tool(backend: &dyn BrowserBackend, name: &str, args: Value) -> Result<Value, String> {
    backend.authorize_tool(args.clone()).await?;
    let tab_page = name == "browser_tabs" && matches!(args["action"].as_str(), Some("new" | "select"));
    let mut result = match name {
        "browser_navigate" => backend.navigate(args["url"].as_str().ok_or("Missing URL")?).await?,
        "browser_navigate_back" => backend.request(json!({"action":"back"})).await?,
        "browser_snapshot" => backend.snapshot().await?,
        "browser_click" => backend.click(reference(&args)?).await?,
        "browser_type" => backend.type_text(reference(&args)?, args["text"].as_str().ok_or("Missing text")?, args["submit"] == true).await?,
        "browser_press_key" => backend.press(args["key"].as_str().ok_or("Missing key")?).await?,
        "browser_select_option" => backend.select(reference(&args)?, args["values"].clone()).await?,
        "browser_fill_form" => backend.request(json!({"action":"script","op":"fill","fields":args["fields"]})).await?,
        "browser_evaluate" => {
            let function = args["function"].as_str().filter(|s| !s.trim().is_empty() && s.len() <= 200000).ok_or("Invalid JavaScript function")?;
            if !args["filename"].is_null() && args["filename"] != "" { return Err("Native evaluation returns results inline; filename is unsupported".into()); }
            let target = args.get("target").filter(|v| !v.is_null() && **v != "").or_else(|| args.get("ref").filter(|v| !v.is_null() && **v != ""));
            let target = target.map(|v| v.as_str().ok_or("Invalid evaluation target")).transpose()?;
            backend.request(json!({"action":"evaluate","function":function,"ref":target})).await?
        },
        "browser_scroll" => backend.scroll(args).await?,
        "browser_wait_for" => backend.wait_for(args).await?,
        "browser_tabs" => backend.tabs(json!({"action":"tabs","params":args})).await?,
        "browser_close" => backend.request(json!({"action":"close"})).await?,
        "browser_console_messages" => {
            if !args["level"].is_null() && !args["level"].as_str().is_some_and(|s| ["error", "warning", "info", "debug"].contains(&s)) {
                return Err("Invalid console level".into());
            }
            for key in ["all", "onlyErrors"] {
                if !args[key].is_null() && !args[key].is_boolean() { return Err(format!("Invalid console {key} boolean")); }
            }
            backend.request(json!({"action":"console","level":args["level"],"all":args["all"],"onlyErrors":args["onlyErrors"]})).await?
        },
        "browser_handle_dialog" => {
            let accept = args["accept"].as_bool().ok_or("Missing dialog accept boolean")?;
            if !args["promptText"].is_null() && !args["promptText"].as_str().is_some_and(|s| s.chars().count() <= 2000) {
                return Err("Dialog promptText must be a string of at most 2000 characters".into());
            }
            backend.request(json!({"action":"dialog","accept":accept,"promptText":args["promptText"]})).await?
        },
        "browser_take_screenshot" => return Ok(json!({"content":[{"type":"image","mimeType":"image/png","data":backend.screenshot().await?}]})),
        _ => return Err("This tool needs trusted input or CDP. Try the Headless Chromium backend (Settings → Browser)".into()),
    };
    if matches!(name, "browser_navigate" | "browser_navigate_back" | "browser_tabs") {
        trim_tool_tabs(&mut result);
    }
    let mut text = if name == "browser_snapshot" { compact_snapshot(&result) } else { None }
        .unwrap_or_else(|| result.to_string());
    // The agent reads the new page next anyway: one call instead of two.
    let page_changed = matches!(name, "browser_navigate" | "browser_navigate_back") || (name == "browser_click" && result["navigated"].is_string())
        || tab_page;
    if page_changed && result["error"].is_null() && backend.snapshot_on_page_change() {
        if let Some(lines) = backend.snapshot().await.ok().as_ref().and_then(compact_snapshot) {
            text.push_str("\n\nPage snapshot:\n");
            text.push_str(&lines);
        }
    }
    Ok(
        json!({"content":[{"type":"text","text":text}]}),
    )
}

fn compact_snapshot(value: &Value) -> Option<String> {
    let nodes = value["nodes"].as_array()?;
    let collapse = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut lines = Vec::new();
    for node in nodes {
        let role = node["role"].as_str().unwrap_or("generic");
        let name = collapse(node["name"].as_str().unwrap_or(""));
        if name.is_empty() && matches!(role, "generic" | "text") { continue; }
        // Page text lines (no ref) carry the content: dates, scores, descriptions.
        let limit = match role {
            "text" => 300,
            "banner" | "navigation" | "main" | "contentinfo" | "form" | "region" | "complementary" | "generic" => 80,
            _ => 160,
        };
        let name = if name.chars().count() > limit { format!("{}…", name.chars().take(limit).collect::<String>()) } else { name };
        let mut line = match node["ref"].as_str().filter(|r| !r.is_empty()) {
            Some(r) => format!("- {r} {role} {}", json!(name)),
            None => format!("- {role} {}", json!(name)),
        };
        if let Some(value) = node["value"].as_str().filter(|value| !value.is_empty()) {
            line.push_str(&format!(" value={}", json!(collapse(value))));
        }
        if let Some(url) = node["url"].as_str().filter(|url| !url.is_empty()) {
            let url: String = url.chars().filter(|c| !c.is_whitespace()).take(200).collect();
            line.push_str(&format!(" url={url}"));
        }
        if let Some(checked) = node["checked"].as_bool() { line.push_str(if checked { " checked" } else { " unchecked" }); }
        if let Some(expanded) = node["expanded"].as_bool() { line.push_str(if expanded { " expanded" } else { " collapsed" }); }
        lines.push(line);
    }
    if value["truncated"] == true { lines.push("[truncated: more elements not shown]".into()); }
    if let Some(note) = value["dialogNote"].as_str() { lines.push(format!("Dialog: {}", collapse(note))); }
    if value["scriptsBlocked"] == true { lines.push("[this page doesn't allow scripts (PDF or file preview); text drawn outside the page, like a PDF's, isn't listed — use browser_take_screenshot to read it]".into()); }
    if value["stillLoading"] == true { lines.push("[page was still loading data; snapshot again if something looks missing]".into()); }
    Some(lines.join("\n"))
}

fn trim_tool_tabs(value: &mut Value) {
    use base64::Engine;
    match value {
        Value::Array(values) => values.iter_mut().for_each(trim_tool_tabs),
        Value::Object(fields) => {
            if fields.get("id").is_some_and(Value::is_string) {
                fields.retain(|key, value| matches!(key.as_str(), "id" | "url" | "title" | "ready" | "loading" | "canGoBack" | "canGoForward") ||
                    (key == "error" && !value.is_null()) || (matches!(key.as_str(), "credentialsPaused" | "active") && value == true));
            }
            fields.retain(|key, value| {
                key != "snapshot" && !value.as_str().is_some_and(|text| {
                    text.starts_with("data:") ||
                    base64::engine::general_purpose::STANDARD.decode(text).is_ok_and(|bytes| {
                        [b"\x89PNG\r\n\x1a\n".as_slice(), b"\xff\xd8\xff", b"GIF87a", b"GIF89a", b"RIFF", b"\0\0\x01\0", b"BM"]
                            .iter().any(|header| bytes.starts_with(header)) ||
                            std::str::from_utf8(&bytes).is_ok_and(|svg| svg.trim_start().starts_with("<svg") || (svg.trim_start().starts_with("<?xml") && svg.contains("<svg")))
                    })
                })
            });
            fields.values_mut().for_each(trim_tool_tabs);
        }
        _ => (),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TabResults(Value);
    impl BrowserBackend for TabResults {
        fn request(&self, _params: Value) -> BoxFuture<'_, Result<Value, String>> {
            Box::pin(async { Ok(self.0.clone()) })
        }
    }
    #[tokio::test]
    async fn tool_tab_results_omit_images_without_changing_ui_state() {
        let tab = json!({"id":"one","url":"https://example.test/","title":"Example","ready":true,
            "snapshot":"cG5n", "favicon":"data:image/png;base64,cG5n", "thumbnail":"iVBORw0KGgo=",
            "icon":"data:image/svg+xml,<svg/>", "imageBase64":"PHN2Zy8+"});
        let expected = json!({"id":"one","url":"https://example.test/","title":"Example","ready":true});
        for (name, args, result, clean) in [
            ("browser_navigate", json!({"url":"https://example.test/"}), tab.clone(), expected.clone()),
            ("browser_tabs", json!({"action":"new","url":"https://example.test/"}), tab.clone(), expected.clone()),
            ("browser_tabs", json!({"action":"list"}), json!([tab.clone(), {"id":"two","favicon":"https://example.test/icon.png"}, {"id":"three","favicon":"/favicon.ico"}, {"id":"four","favicon":"logo"}]),
                json!([expected.clone(), {"id":"two"}, {"id":"three"}, {"id":"four"}])),
            ("browser_tabs", json!({"action":"list"}), json!({"tabs":[tab.clone()]}), json!({"tabs":[expected.clone()]})),
        ] {
            let backend = TabResults(result.clone());
            let response = tool(&backend, name, args).await.unwrap();
            let actual: Value = serde_json::from_str(response["content"][0]["text"].as_str().unwrap()).unwrap();
            assert_eq!(actual, clean);
            assert_eq!(backend.0, result);
        }
        let screenshot = tool(&TabResults(json!("cG5n")), "browser_take_screenshot", json!({})).await.unwrap();
        assert_eq!(screenshot["content"][0]["data"], "cG5n");
    }
    struct Fake;
    #[tokio::test]
    async fn snapshots_are_compact_only_for_native_nodes() {
        let snapshot = json!({"nodes":[
            {"ref":"e1","role":"banner","name":"界".repeat(81),"bounds":{"x":1,"y":2,"w":3,"h":4}},
            {"ref":"e2","role":"link","name":"  Skip\n to  \"content\" ","value":"","url":"/courses/1/grades?x=1 #top"},
            {"ref":"e3","role":"generic","name":" \t "},
            {"ref":"e4","role":"generic","name":"x".repeat(81)},
            {"ref":"e5","role":"textbox","name":"Search","value":"  My\n\"syllabus\" \\ "},
            {"ref":"e6","role":"button","name":"y".repeat(161)},
            {"ref":"e7","role":"textbox","name":"Password"},
            {"ref":"e8","role":"checkbox","name":"Remember me","checked":false},
            {"ref":"e9","role":"button","name":"Menu","expanded":true},
            {"role":"text","name":" Due  Monday\n | 5 pts "},
            {"role":"text","name":" "},
            {"role":"text","name":"z".repeat(301)}
        ],"truncated":true,"dialogNote":" Confirm\n on page ","stillLoading":true,"scriptsBlocked":true});
        let backend = TabResults(snapshot.clone());
        let result = tool(&backend, "browser_snapshot", json!({})).await.unwrap();
        assert_eq!(result["content"][0]["text"], format!(
            "- e1 banner \"{}…\"\n- e2 link \"Skip to \\\"content\\\"\" url=/courses/1/grades?x=1#top\n- e4 generic \"{}…\"\n- e5 textbox \"Search\" value=\"My \\\"syllabus\\\" \\\\\"\n- e6 button \"{}…\"\n- e7 textbox \"Password\"\n- e8 checkbox \"Remember me\" unchecked\n- e9 button \"Menu\" expanded\n- text \"Due Monday | 5 pts\"\n- text \"{}…\"\n[truncated: more elements not shown]\nDialog: Confirm on page\n[this page doesn't allow scripts (PDF or file preview); text drawn outside the page, like a PDF's, isn't listed — use browser_take_screenshot to read it]\n[page was still loading data; snapshot again if something looks missing]",
            "界".repeat(80), "x".repeat(80), "y".repeat(160), "z".repeat(300)));
        assert_eq!(backend.0, snapshot);
        for cdp in [json!({"snapshot":"- link Example","truncated":false}), json!("CDP snapshot")] {
            let result = tool(&TabResults(cdp.clone()), "browser_snapshot", json!({})).await.unwrap();
            assert_eq!(result["content"][0]["text"], cdp.to_string());
        }
    }
    #[tokio::test]
    async fn tool_tabs_keep_only_public_fields_and_actionable_errors() {
        for paused in [false, true] {
            for error in [Value::Null, json!("Load failed")] {
                let tab = json!({"id":"one","url":"https://example.test/","title":"Example","ready":true,
                    "loading":false,"canGoBack":true,"canGoForward":false,"credentialsPaused":paused,
                    "error":error,"savedLogins":[{"username":"private"}],"progress":1,"snapshot":null,"favicon":"/icon.png","active":true});
                let mut expected = json!({"id":"one","url":"https://example.test/","title":"Example","ready":true,
                    "loading":false,"canGoBack":true,"canGoForward":false,"active":true});
                if paused { expected["credentialsPaused"] = json!(true); }
                if !error.is_null() { expected["error"] = error; }
                for name in ["browser_navigate", "browser_navigate_back", "browser_tabs"] {
                    let backend = TabResults(tab.clone());
                    let response = tool(&backend, name, json!({"url":"https://example.test/"})).await.unwrap();
                    assert_eq!(serde_json::from_str::<Value>(response["content"][0]["text"].as_str().unwrap()).unwrap(), expected);
                    assert_eq!(backend.0, tab);
                }
            }
        }
    }
    struct Pages;
    impl BrowserBackend for Pages {
        fn snapshot_on_page_change(&self) -> bool { true }
        fn request(&self, params: Value) -> BoxFuture<'_, Result<Value, String>> {
            Box::pin(async move { Ok(match params["op"].as_str() {
                Some("snapshot") => json!({"nodes":[{"ref":"e1","role":"link","name":"Grades","url":"/grades"}]}),
                Some("click") => json!({"performed":true,"navigated":"https://example.test/grades"}),
                _ if params["action"] == "back" => json!({"id":"one","url":"https://example.test/","error":"Load failed"}),
                _ => json!({"id":"one","url":"https://example.test/","ready":true}),
            }) })
        }
    }
    #[tokio::test]
    async fn page_changes_return_the_new_page_snapshot() {
        let text = |r: Value| r["content"][0]["text"].as_str().unwrap().to_string();
        let snap = "\n\nPage snapshot:\n- e1 link \"Grades\" url=/grades";
        assert_eq!(text(tool(&Pages, "browser_navigate", json!({"url":"https://example.test/"})).await.unwrap()), format!("{}{snap}", json!({"id":"one","url":"https://example.test/","ready":true})));
        assert!(text(tool(&Pages, "browser_click", json!({"ref":"e1"})).await.unwrap()).ends_with(snap));
        // A failed load or a click that stayed on the page returns no snapshot; neither does a backend that doesn't opt in.
        assert!(text(tool(&Pages, "browser_tabs", json!({"action":"select","index":0})).await.unwrap()).ends_with(snap));
        assert!(!text(tool(&Pages, "browser_tabs", json!({"action":"list"})).await.unwrap()).contains("Page snapshot"));
        assert!(!text(tool(&Pages, "browser_navigate_back", json!({})).await.unwrap()).contains("Page snapshot"));
        assert!(!text(tool(&Pages, "browser_press_key", json!({"key":"Tab"})).await.unwrap()).contains("Page snapshot"));
        assert!(!text(tool(&Fake, "browser_navigate", json!({"url":"https://example.test/"})).await.unwrap()).contains("Page snapshot"));
    }
    impl BrowserBackend for Fake {
        fn request(&self, params: Value) -> BoxFuture<'_, Result<Value, String>> {
            Box::pin(async { Ok(params) })
        }
    }
    #[tokio::test]
    async fn tools_share_the_backend_contract() {
        let result = tool(
            &Fake,
            "browser_type",
            json!({"ref":"e1","text":"hello","submit":true}),
        )
        .await
        .unwrap();
        let params: Value =
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(
            params,
            json!({"action":"script","op":"type","ref":"e1","text":"hello","submit":true})
        );
        assert!(tool(&Fake, "browser_evaluate", json!({}))
            .await
            .unwrap_err()
            .contains("Invalid JavaScript function"));
    }
    async fn dispatched(name: &str, args: Value) -> Value {
        let result = tool(&Fake, name, args).await.unwrap();
        serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap()
    }
    #[tokio::test]
    async fn console_and_dialog_requests_reach_native_actions() {
        assert_eq!(dispatched("browser_console_messages", json!({"level":"warning","all":false,"onlyErrors":true})).await,
            json!({"action":"console","level":"warning","all":false,"onlyErrors":true}));
        for args in [json!({"level":"warn"}), json!({"level":["error"]}), json!({"all":"true"}), json!({"onlyErrors":1})] {
            assert!(tool(&Fake, "browser_console_messages", args).await.is_err());
        }
        assert_eq!(dispatched("browser_handle_dialog", json!({"accept":true,"promptText":"answer"})).await,
            json!({"action":"dialog","accept":true,"promptText":"answer"}));
        assert_eq!(dispatched("browser_handle_dialog", json!({"accept":false})).await,
            json!({"action":"dialog","accept":false,"promptText":null}));
        for args in [json!({}), json!({"accept":"yes"}), json!({"accept":true,"promptText":42}), json!({"accept":true,"promptText":"x".repeat(2001)})] {
            assert!(tool(&Fake, "browser_handle_dialog", args).await.is_err());
        }
    }
    #[test]
    fn native_listing_adds_scroll_missing_from_playwright() {
        let response = json!({"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"browser_snapshot"}]}});
        let mut cdp = response.clone();
        filter_tools(&mut cdp, false);
        assert_eq!(cdp, response);
        let mut native = response;
        filter_tools(&mut native, true);
        let scroll = native["result"]["tools"][1].clone();
        assert_eq!(scroll, json!({"name":"browser_scroll",
            "description":"Scroll the page by x/y pixels, or scroll an element (snapshot ref or selector) into view.",
            "inputSchema":{"type":"object","properties":{
                "x":{"type":"number","description":"Horizontal pixels (+right)"},
                "y":{"type":"number","description":"Vertical pixels (+down)"},
                "ref":{"type":"string","description":"Snapshot ref or unique selector to scroll into view. With x/y, scroll inside the element instead."}
            },"additionalProperties":false}}));
        filter_tools(&mut native, true);
        assert_eq!(native["result"]["tools"].as_array().unwrap().iter().filter(|t| t["name"] == "browser_scroll").count(), 1);
        assert_eq!(native["result"]["tools"][1], scroll);
    }

    #[tokio::test]
    async fn scroll_reaches_native_bridge() {
        for args in [json!({"y":400}), json!({"x":-20,"y":50,"ref":"e12"}), json!({"ref":"#footer"})] {
            assert_eq!(dispatched("browser_scroll", args.clone()).await,
                json!({"action":"script","op":"scroll","x":args["x"],"y":args["y"],"ref":args["ref"]}));
        }
    }

    #[test]
    fn native_tool_list_keeps_supported_tools_and_schemas_only() {
        let mut tools: Vec<_> = supported_tools().iter().map(|name| json!({"name":name,"description":"Original description.","inputSchema":{"properties":{"target":{"type":"string"}}}})).collect();
        for name in ["browser_run_code_unsafe", "browser_drag", "browser_file_upload", "browser_network_requests", "browser_future_tool"] {
            tools.push(json!({"name":name}));
        }
        tools.push(json!({"name":null}));
        let response = json!({"jsonrpc":"2.0","id":5,"result":{"tools":tools,"nextCursor":"next"}});
        let mut cdp = response.clone();
        filter_tools(&mut cdp, false);
        assert_eq!(cdp, response);
        let mut native = response.clone();
        filter_tools(&mut native, true);
        for tool in native["result"]["tools"].as_array().unwrap() {
            if ["browser_click", "browser_type", "browser_press_key", "browser_select_option", "browser_fill_form"].iter().any(|name| tool["name"] == *name) {
                let description = tool["description"].as_str().unwrap();
                assert!(description.starts_with("Original description. "));
                if tool["name"] == "browser_click" {
                    assert!(description.contains("real mouse events") && description.contains("popup window") && !description.contains("not isTrusted"));
                } else {
                    assert!(description.ends_with("Input is synthetic (not isTrusted). If a site ignores it, tell the user; the Headless Chromium backend (Settings → Browser) sends trusted input."));
                }
                assert_eq!(tool["inputSchema"], json!({"properties":{"target":{"type":"string"}}}));
            } else if tool["name"] == "browser_snapshot" {
                assert!(tool["description"].as_str().unwrap().contains("refs (e.g. e12, for browser_click/type)"));
            } else if tool["name"] == "browser_navigate" {
                let description = tool["description"].as_str().unwrap();
                assert!(description.starts_with("Original description. ") && description.contains("don't guess a generic domain") && description.contains("sign in in the browser panel"));
            } else if tool["name"] == "browser_tabs" {
                assert!(tool["description"].as_str().unwrap().starts_with("Original description. The list marks the active tab"));
            } else if tool["name"] != "browser_evaluate" {
                assert_eq!(tool["description"], "Original description.");
            }
        }
        assert_eq!(native["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect::<Vec<_>>(), supported_tools());
        let evaluate = native["result"]["tools"].as_array().unwrap().iter().find(|t| t["name"] == "browser_evaluate").unwrap();
        assert_eq!(evaluate["inputSchema"]["required"], json!(["function"]));
        assert_eq!(evaluate["inputSchema"]["properties"].as_object().unwrap().len(), 2);
        assert_eq!(evaluate["inputSchema"]["properties"]["target"]["type"], json!(["string", "null"]));
        assert_eq!(native["result"]["nextCursor"], "next");
        assert_eq!(native["id"], 5);
        let mut error = json!({"id":5,"error":{"message":"upstream failed"}});
        let original = error.clone();
        filter_tools(&mut error, true);
        assert_eq!(error, original);
    }
    #[tokio::test]
    async fn advertised_targets_and_legacy_refs_reach_native_actions() {
        for target in [
            json!({"target":"e6"}),
            json!({"ref":"e6"}),
            json!({"target":"#login"}),
        ] {
            let expected = reference(&target).unwrap().to_string();
            assert_eq!(
                dispatched("browser_click", target).await,
                json!({"action":"script","op":"click","ref":expected})
            );
        }
        assert_eq!(
            dispatched("browser_type", json!({"target":"e4","text":"demo"})).await,
            json!({"action":"script","op":"type","ref":"e4","text":"demo","submit":false})
        );
        assert_eq!(
            dispatched(
                "browser_select_option",
                json!({"target":"select","values":["shade"]})
            )
            .await,
            json!({"action":"script","op":"select","ref":"select","values":["shade"]})
        );
        for invalid in [json!({}), json!({"target":""}), json!({"target":42})] {
            assert!(tool(&Fake, "browser_click", invalid)
                .await
                .unwrap_err()
                .contains("Missing target"));
        }
    }
    #[tokio::test]
    async fn advertised_form_and_evaluation_requests_reach_native_backend() {
        let fields = json!([
            {"target":"e4","name":"Username","type":"textbox","value":"demo"},
            {"target":"e5","name":"Password","type":"textbox","value":"demo123"}
        ]);
        assert_eq!(
            dispatched("browser_fill_form", json!({"fields":fields})).await,
            json!({"action":"script","op":"fill","fields":fields})
        );
        let function = "async () => document.title";
        assert_eq!(
            dispatched("browser_evaluate", json!({"function":function})).await,
            json!({"action":"evaluate","function":function,"ref":null})
        );
        for target in [Value::Null, json!("")] {
            assert_eq!(dispatched("browser_evaluate", json!({"function":function,"target":target,"filename":""})).await,
                json!({"action":"evaluate","function":function,"ref":null}));
        }
        assert_eq!(
            dispatched(
                "browser_evaluate",
                json!({"function":"el => el.id","target":"e4"})
            )
            .await,
            json!({"action":"evaluate","function":"el => el.id","ref":"e4"})
        );
        assert!(tool(
            &Fake,
            "browser_evaluate",
            json!({"function":function,"filename":"output.json"})
        )
        .await
        .unwrap_err()
        .contains("filename is unsupported"));
    }
}
