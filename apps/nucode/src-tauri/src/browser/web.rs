use super::{policy, Settings};
use futures_util::StreamExt;
use regex::Regex;
use reqwest::{Client, Url};
use serde_json::{json, Value};
use std::{sync::LazyLock, time::Duration};

const USER_AGENT: &str = concat!("Mozilla/5.0 (compatible; nucode/", env!("CARGO_PKG_VERSION"), ")");
const BODY_LIMIT: usize = 5 * 1024 * 1024;
pub(super) const SEARCH_ENDPOINT: &str = "https://html.duckduckgo.com/html/";
pub(super) const NAVIGATE_NOTE: &str = "This opens the page in the user's visible in-app browser: use it only when the user asks for the browser, or a page needs sign-in, interaction or JavaScript. To look something up or read a public page, use web_search and web_fetch instead.";

pub fn tools() -> Vec<Value> {
    vec![
        json!({"name":"web_search","description":"Search the web in the background, without opening the browser. Returns result titles, URLs and snippets. Use this first whenever you need to look something up.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"count":{"type":"integer","minimum":1,"maximum":20}},"required":["query"],"additionalProperties":false}}),
        json!({"name":"web_fetch","description":"Fetch a public web page in the background, without opening the browser, and return its readable text. Use this to read search results, documentation and articles. It does not run JavaScript and does not use the user's sign-ins.","inputSchema":{"type":"object","properties":{"url":{"type":"string"},"offset":{"type":"integer","minimum":0},"max_chars":{"type":"integer"}},"required":["url"],"additionalProperties":false}}),
    ]
}

pub(super) fn client() -> Result<Client, String> {
    Client::builder().redirect(reqwest::redirect::Policy::none()).user_agent(USER_AGENT)
        .build().map_err(|e| e.to_string())
}

pub(super) async fn call(client: &Client, settings: &Settings, name: &str, args: &Value) -> Result<String, String> {
    let integer = |key: &str, default: u64| -> Result<u64, String> {
        args.get(key).map_or(Ok(default), |v| v.as_u64().ok_or_else(|| format!("Invalid {key}: expected a nonnegative integer")))
    };
    match name {
        "web_search" => {
            let query = args["query"].as_str().filter(|s| !s.trim().is_empty()).ok_or("Missing search query")?;
            search(client, SEARCH_ENDPOINT, query, integer("count", 8)?.clamp(1, 20) as usize).await
        }
        "web_fetch" => {
            let max_chars = args.get("max_chars").map_or(Ok(20000), |v| v.as_i64()
                .map(|n| n.clamp(1000, 100000) as usize).or_else(|| v.as_u64().map(|n| n.min(100000) as usize))
                .ok_or("Invalid max_chars: expected an integer"))?;
            fetch(client, settings, args["url"].as_str().ok_or("Missing URL")?,
                integer("offset", 0)?.min(usize::MAX as u64) as usize, max_chars).await
        }
        _ => Err("Unknown web tool".into()),
    }
}

async fn body(response: reqwest::Response) -> Result<String, String> {
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        let remaining = BODY_LIMIT - bytes.len();
        bytes.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if bytes.len() == BODY_LIMIT { break; }
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn search_error(reason: impl std::fmt::Display) -> String {
    format!("Web search is unavailable right now ({reason}). Try again, or use browser_navigate with a search URL.")
}

pub async fn search(client: &Client, endpoint: &str, query: &str, count: usize) -> Result<String, String> {
    tokio::time::timeout(Duration::from_secs(15), async {
        let response = client.get(endpoint).query(&[("q", query)]).send().await.map_err(search_error)?;
        if response.status() != reqwest::StatusCode::OK { return Err(search_error(response.status())); }
        let html = body(response).await.map_err(search_error)?;
        let results = parse_results(&html)?;
        Ok(results.into_iter().take(count.clamp(1, 20)).enumerate()
            .map(|(i, (title, url, snippet))| format!("{}. {title}\n   {url}\n   {snippet}", i + 1))
            .collect::<Vec<_>>().join("\n\n"))
    }).await.map_err(|_| search_error("request timed out"))?
}

fn check_url(url: &Url, settings: &Settings) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") { return Err("Only HTTP(S) URLs are supported".into()); }
    if !url.username().is_empty() || url.password().is_some() { return Err("URLs with credentials are unsupported".into()); }
    if !policy::allowed_origin(url, settings) { return Err(format!("Blocked by browser origin settings: {}", url.origin().ascii_serialization())); }
    Ok(())
}

fn redirect_target(url: &Url, location: &str, hops: usize, settings: &Settings) -> Result<Url, String> {
    if hops >= 5 { return Err("Too many redirects (maximum 5)".into()); }
    let next = url.join(location).map_err(|e| e.to_string())?;
    check_url(&next, settings)?;
    Ok(next)
}

fn content_type(value: &str) -> Result<bool, String> {
    let mime = value.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if mime.starts_with("image/") || !(mime.starts_with("text/") || matches!(mime.as_str(), "application/json" | "application/xml" | "application/xhtml+xml") || mime.ends_with("+json")) {
        return Err(format!("Unsupported content type {mime}; use browser_navigate to view it."));
    }
    Ok(matches!(mime.as_str(), "text/html" | "application/xhtml+xml"))
}

pub async fn fetch(client: &Client, settings: &Settings, url: &str, offset: usize, max_chars: usize) -> Result<String, String> {
    tokio::time::timeout(Duration::from_secs(20), async {
        let mut url = Url::parse(url).map_err(|e| e.to_string())?;
        check_url(&url, settings)?;
        for hops in 0..=5 {
            let response = client.get(url.clone()).send().await.map_err(|e| e.to_string())?;
            if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                let location = response.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).ok_or("Redirect missing Location")?;
                url = redirect_target(&url, location, hops, settings)?;
                continue;
            }
            if !response.status().is_success() { return Err(format!("Web fetch failed: {}", response.status())); }
            let html = content_type(response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("unknown"))?;
            let raw = body(response).await?;
            let (title, text) = if html { page_text(&raw, &url) } else { (String::new(), raw) };
            return Ok(format_page(&url, &title, &text, html, offset, max_chars));
        }
        Err("Too many redirects (maximum 5)".into())
    }).await.map_err(|_| "Web fetch timed out".to_string())?
}

fn format_page(url: &Url, title: &str, text: &str, html: bool, offset: usize, max_chars: usize) -> String {
    let total = text.chars().count();
    let start = offset.min(total);
    let end = start.saturating_add(max_chars.clamp(1000, 100000)).min(total);
    let slice: String = text.chars().skip(start).take(end - start).collect();
    let mut result = format!("URL: {url}\n{}\n{slice}", if title.is_empty() { String::new() } else { format!("Title: {title}\n") });
    if end < total { result.push_str(&format!("\n[Truncated: {} more characters. Call web_fetch again with offset={end}.]", total - end)); }
    if html && total < 200 { result.push_str("\n[This page has little static text; it may need JavaScript. Use browser_navigate if you need it rendered.]"); }
    result
}

static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?s)<!--.*?-->|</?[A-Za-z][^<>"']*(?:"[^"]*"[^<>"']*|'[^']*'[^<>"']*)*>|<![^>]*>"#).unwrap());
static ATTRS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#).unwrap());
static ENTITIES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);").unwrap());
fn decode(text: &str) -> String {
    ENTITIES.replace_all(text, |c: &regex::Captures| {
        let entity = &c[1];
        let character = if let Some(n) = entity.strip_prefix("#x") { u32::from_str_radix(n, 16).ok().and_then(char::from_u32) }
            else if let Some(n) = entity.strip_prefix('#') { n.parse().ok().and_then(char::from_u32) }
            else { match entity { "amp" => Some('&'), "lt" => Some('<'), "gt" => Some('>'), "quot" => Some('"'), "apos" => Some('\''), "nbsp" => Some(' '), "ndash" => Some('–'), "mdash" => Some('—'), "hellip" => Some('…'), "lsquo" => Some('‘'), "rsquo" => Some('’'), "ldquo" => Some('“'), "rdquo" => Some('”'), _ => None } };
        character.map_or_else(|| c[0].to_string(), |c| c.to_string())
    }).into_owned()
}
fn attr(tag: &str, name: &str) -> Option<String> {
    ATTRS.captures_iter(tag).find(|c| c[1].eq_ignore_ascii_case(name))
        .and_then(|c| (2..=4).find_map(|n| c.get(n).map(|m| decode(m.as_str()))))
}
fn plain(html: &str) -> String { decode(&TAGS.replace_all(html, "")).split_whitespace().collect::<Vec<_>>().join(" ") }

pub fn parse_results(html: &str) -> Result<Vec<(String, String, String)>, String> {
    static ANCHORS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<a\b([^>]*)>(.*?)</a\s*>").unwrap());
    static SNIPPET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?is)<[^>]*\bclass\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>(.*?)</(?:a|div|span)\s*>"#).unwrap());
    let lower = html.to_ascii_lowercase();
    if lower.contains("anomaly.js") || lower.contains("challenge-form") || lower.contains("bots use duckduckgo") { return Err(search_error("challenge page")); }
    let anchors: Vec<_> = ANCHORS.captures_iter(html).filter(|c| attr(&c[1], "class").is_some_and(|s| s.split_whitespace().any(|s| s == "result__a"))).collect();
    let mut results = Vec::new();
    for (i, anchor) in anchors.iter().enumerate() {
        let Some(href) = attr(&anchor[1], "href") else { continue; };
        let Ok(mut url) = Url::parse("https://duckduckgo.com").unwrap().join(&href) else { continue; };
        if url.path().ends_with("y.js") || url.query_pairs().any(|(k, _)| k == "ad_domain") { continue; }
        if let Some(target) = url.query_pairs().find(|(key, _)| key == "uddg").map(|(_, v)| v.into_owned()) {
            let Ok(target) = Url::parse(&target) else { continue; };
            url = target;
        }
        if url.path().ends_with("y.js") || url.query_pairs().any(|(k, _)| k == "ad_domain") { continue; }
        if !matches!(url.scheme(), "http" | "https") { continue; }
        let end = anchors.get(i + 1).map_or(html.len(), |c| c.get(0).unwrap().start());
        let snippet = SNIPPET.captures(&html[anchor.get(0).unwrap().end()..end]).map_or(String::new(), |c| plain(&c[1]));
        results.push((plain(&anchor[2]), url.to_string(), snippet));
    }
    if results.is_empty() { return Err(search_error("no results")); }
    Ok(results)
}

fn append_page_text(text: &mut String, raw: &str, pre: bool, separator: &mut &'static str) {
    for ch in decode(raw).chars() {
        if !pre && ch.is_whitespace() {
            if *separator != "\n" { *separator = " "; }
        } else {
            if !text.is_empty() && !text.ends_with('\n') { text.push_str(separator); }
            *separator = "";
            text.push(ch);
        }
    }
}

pub fn page_text(html: &str, base: &Url) -> (String, String) {
    let mut title = String::new();
    let mut text = String::new();
    let mut hidden: Vec<String> = Vec::new();
    let mut in_title = false;
    let mut in_head = false;
    let mut pre = false;
    let mut separator = "";
    let mut scope: Option<(String, usize)> = None;
    let mut done = false;
    let mut link: Option<(usize, String)> = None;
    let mut document = base.clone();
    document.set_fragment(None);
    let mut cursor = 0;
    for tag in TAGS.find_iter(html) {
        if hidden.is_empty() {
            if in_title { title.push_str(&html[cursor..tag.start()]); }
            else if !in_head && !done { append_page_text(&mut text, &html[cursor..tag.start()], pre, &mut separator); }
        }
        cursor = tag.end();
        let raw = tag.as_str();
        if raw.starts_with("<!--") { continue; }
        let name = raw.trim_start_matches('<').trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '>' || c == '/').next().unwrap_or("").to_ascii_lowercase();
        let close = raw.starts_with("</");
        if let Some(skip) = hidden.last() {
            if &name == skip {
                if close { hidden.pop(); } else if name != "script" && name != "style" && !raw.ends_with("/>") { hidden.push(name); }
            }
            continue;
        }
        if ["script", "style", "noscript", "svg", "template", "nav", "footer", "aside", "form", "button", "select", "iframe"].contains(&name.as_str()) && !close {
            if !raw.ends_with("/>") { hidden.push(name); }
            continue;
        }
        if name == "head" { in_head = !close; continue; }
        if name == "title" { in_title = !close; continue; }
        if in_head || in_title { continue; }
        if name == "body" {
            if close { done = true; }
            else if scope.is_none() {
                text.clear();
                separator = "";
                link = None;
                pre = false;
            }
            continue;
        }
        if done { continue; }
        if !pre && !close && scope.is_none() && matches!(name.as_str(), "main" | "article") {
            text.clear();
            separator = "";
            link = None;
            scope = Some((name.clone(), 0));
        }
        if let Some((selected, depth)) = &mut scope {
            if &name == selected {
                if close {
                    *depth -= 1;
                    if *depth == 0 { done = true; continue; }
                } else { *depth += 1; }
            }
        }
        if name == "pre" {
            pre = !close;
            separator = "\n";
            continue;
        }
        if pre { continue; }
        if name == "a" {
            if close {
                if let Some((start, href)) = link.take() {
                    let label = text[start..].split_whitespace().collect::<Vec<_>>().join(" ");
                    if !label.is_empty() && label != href { text.push_str(&format!(" ({href})")); }
                }
            } else {
                link = attr(raw, "href").and_then(|href| base.join(&href).ok())
                    .filter(|url| {
                        let mut target = url.clone();
                        target.set_fragment(None);
                        matches!(url.scheme(), "http" | "https") && target != document
                    }).map(|url| (text.len(), url.to_string()));
            }
        }
        if ["address", "article", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "ol", "p", "section", "table", "tr", "ul"].contains(&name.as_str()) { separator = "\n"; }
        if !close {
            if let Some(level) = name.strip_prefix('h').and_then(|n| n.parse::<usize>().ok()).filter(|n| (1..=6).contains(n)) {
                append_page_text(&mut text, &format!("{} ", "#".repeat(level)), false, &mut separator);
            }
            if name == "li" { append_page_text(&mut text, "- ", false, &mut separator); }
        }
        if matches!(name.as_str(), "td" | "th") && separator != "\n" { separator = " "; }
    }
    if hidden.is_empty() && !in_head && !in_title && !done { append_page_text(&mut text, &html[cursor..], pre, &mut separator); }
    (plain(&title), text)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn user_agent_identifies_nucode_and_its_crate_version() {
        assert_eq!(USER_AGENT, format!("Mozilla/5.0 (compatible; nucode/{})", env!("CARGO_PKG_VERSION")));
        assert!(!USER_AGENT.contains("Safari"));
    }
    #[tokio::test]
    async fn invalid_arguments_fail_without_network_access() {
        let client = client().unwrap();
        let settings = Settings::default();
        for args in [json!({}), json!({"query":" "}), json!({"query":"query","count":1.5})] {
            assert!(call(&client, &settings, "web_search", &args).await.is_err());
        }
        for args in [json!({}), json!({"url":"file:///page","offset":-1}), json!({"url":"file:///page","max_chars":"many"})] {
            assert!(call(&client, &settings, "web_fetch", &args).await.is_err());
        }
        assert_eq!(call(&client, &settings, "web_fetch", &json!({"url":"file:///page","max_chars":-1})).await.unwrap_err(), "Only HTTP(S) URLs are supported");
        assert_eq!(call(&client, &settings, "web_fetch", &json!({"url":"file:///page","max_chars":u64::MAX})).await.unwrap_err(), "Only HTTP(S) URLs are supported");
        assert!(search(&client, "invalid endpoint", "query", 8).await.unwrap_err().starts_with("Web search is unavailable right now ("));
    }
    #[test]
    fn search_results_decode_redirects_and_skip_ads() {
        let html = r#"<a class="result__a" href="//duckduckgo.com/y.js?ad_domain=ads.test">Ad</a><a class='result__snippet'>Ad snippet</a>
            <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2F%3Fx%3D1%26y%3D2&amp;rut=abc" class="result__a">An <b>example</b> &amp; &#x754c;</a><div class="result__snippet">A <b>useful</b> snippet&#33;</div>
            <a class="other result__a" href="https://docs.test/">Docs</a><a class="result__snippet">Read docs</a>"#;
        assert_eq!(parse_results(html).unwrap(), vec![("An example & 界".into(), "https://example.test/?x=1&y=2".into(), "A useful snippet!".into()), ("Docs".into(), "https://docs.test/".into(), "Read docs".into())]);
        for html in ["<p>No results</p>", "<form id='challenge-form'></form>"] { assert!(parse_results(html).unwrap_err().contains("use browser_navigate")); }
    }
    #[test]
    fn readable_html_omits_hidden_content_and_preserves_links_and_blocks() {
        let base = Url::parse("https://example.test/docs/").unwrap();
        let (title, text) = page_text(r#"<html><head><title>A &amp; B</title><style>hidden</style></head><body><h1>Hello   world</h1><p>Read <a href='../guide'>the <b>guide</b></a>.</p><div>One<br>Two</div><script>bad()</script><noscript>hidden</noscript><svg><text>hidden</text></svg><template><template>nested</template>hidden</template><p><a href='https://example.test/'>https://example.test/</a></p><p>&lt;b&gt; &#233; &nbsp; end</p></body></html>"#, &base);
        assert_eq!(title, "A & B");
        assert_eq!(text, "# Hello world\nRead the guide (https://example.test/guide).\nOne\nTwo\nhttps://example.test/\n<b> é end");
        assert_eq!(page_text(r#"<script>if (a <b) { const text = '<script>'; }</script><p title='a > b'>Visible 2 < 3</p>"#, &base).1, "Visible 2 < 3");
    }
    #[test]
    fn source_whitespace_collapses_across_inline_tags_and_links() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = "<body>\n <p>Read\n\t<a href='https://docs.rs/'>\n Docs.rs\n </a>\n and <b>the\n docs</b>.</p>\n <p>Another\n line.</p>\n</body>";
        assert_eq!(page_text(html, &base).1, "Read Docs.rs (https://docs.rs/) and the docs.\nAnother line.");
    }
    #[test]
    fn preformatted_text_keeps_indentation_newlines_and_trailing_spaces() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = "<p>Before</p><pre>\n  <code>fn main() {\n\tprintln!(&quot;hi&quot;);\n  }  </code>\n\n</pre><p>After</p>";
        assert_eq!(page_text(html, &base).1, "Before\n\n  fn main() {\n\tprintln!(\"hi\");\n  }  \n\nAfter");
        assert_eq!(page_text("<pre>\n  code  \n</pre>", &base).1, "\n  code  \n");
        assert_eq!(page_text("<pre>  first  </pre><pre>\tsecond</pre>", &base).1, "  first  \n\tsecond");
    }
    #[test]
    fn first_main_or_article_wins_with_body_fallback_and_document_title() {
        let base = Url::parse("https://example.test/").unwrap();
        for (html, expected) in [
            ("<head><title>Page title</title></head><body>Before<main><h1>Main</h1><main>Nested</main><article>Inside</article>End</main><article>Later</article>After</body>", "# Main\nNested\nInside\nEnd"),
            ("<head><title>Page title</title></head><body>Before<article>First<main>Nested</main>End</article><main>Later</main>After</body>", "First\nNested\nEnd"),
            ("<head><title>Page title</title></head><body><main></main><article>Later</article></body>", ""),
            ("Outside<head><title>Page title</title>Metadata</head><body><p>Body</p> text</body>Outside", "Body\ntext"),
        ] {
            assert_eq!(page_text(html, &base), ("Page title".into(), expected.into()));
        }
    }
    #[test]
    fn page_chrome_and_hidden_content_never_enter_the_text_or_select_a_scope() {
        let base = Url::parse("https://example.test/").unwrap();
        for tag in ["script", "style", "noscript", "svg", "template", "nav", "footer", "aside", "form", "button", "select", "iframe"] {
            let html = format!("<head><title>Title</title>Metadata<main>Wrong scope</main></head><body><{tag}><main>Hidden</main><title>Wrong title</title></{tag}><p>Visible</p></body>");
            assert_eq!(page_text(&html, &base), ("Title".into(), "Visible".into()), "{tag}");
        }
        assert_eq!(page_text("<body><nav><nav>Nested</nav>Hidden</nav><p>Visible</p></body>", &base).1, "Visible");
    }
    #[test]
    fn links_only_annotate_nonempty_http_targets_in_other_documents() {
        let base = Url::parse("https://example.test/docs?lang=en#current").unwrap();
        let html = r##"<p><a href="#section">Section</a> <a href="/docs?lang=en#other">Same</a> <a href="https://example.test/docs?lang=en">Absolute</a></p>
            <p><a href="javascript:alert(1)">Script</a> <a href="mailto:help@example.test">Email</a> <a href="ftp://example.test/file">FTP</a> <a href="">Empty href</a></p>
            <p><a href="https://docs.rs/">https://docs.rs/</a> <a href="/docs?lang=fr#intro">French</a> <a href="http://other.test/">Other</a></p>
            <a href="https://other.test/">
            </a><a href="https://other.test/"><img src="icon.png"></a>"##;
        assert_eq!(page_text(html, &base).1, "Section Same Absolute\nScript Email FTP Empty href\nhttps://docs.rs/ French (https://example.test/docs?lang=fr#intro) Other (http://other.test/)");
        assert_eq!(page_text("<a href='https://other.test/'> \n </a><a href='https://other.test/'><img></a>", &base).1, "");
    }
    #[test]
    fn headings_and_list_items_get_markdown_prefixes() {
        let base = Url::parse("https://example.test/").unwrap();
        let html = "<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><H6>Six</H6><ul><li>First <b>item</b></li><li>Second</li></ul><ol><li>Third</li></ol>";
        assert_eq!(page_text(html, &base).1, "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n- First item\n- Second\n- Third");
    }
    #[test]
    fn redirects_recheck_origins_schemes_credentials_and_limit() {
        let mut settings = Settings::default();
        let url = Url::parse("https://example.test/a").unwrap();
        settings.blocked_origins = vec!["https://blocked.test".into()];
        assert_eq!(redirect_target(&url, "https://blocked.test/b", 0, &settings).unwrap_err(), "Blocked by browser origin settings: https://blocked.test");
        assert!(check_url(&Url::parse("https://blocked.test").unwrap(), &settings).is_err());
        for target in ["file:///tmp/file", "https://user:pass@example.test/"] { assert!(redirect_target(&url, target, 0, &settings).is_err()); }
        assert!(redirect_target(&url, "/b", 5, &settings).is_err());
        assert_eq!(redirect_target(&url, "/b", 4, &settings).unwrap().as_str(), "https://example.test/b");
        settings.allowed_origins = vec!["https://allowed.test".into()];
        assert!(redirect_target(&url, "/b", 0, &settings).is_err());
    }
    #[test]
    fn content_types_and_unicode_pagination() {
        for mime in ["text/html; charset=utf-8", "application/xhtml+xml"] { assert_eq!(content_type(mime), Ok(true)); }
        for mime in ["text/plain", "text/xml", "application/json", "application/xml", "application/problem+json"] { assert_eq!(content_type(mime), Ok(false)); }
        for mime in ["image/png", "image/svg+xml", "image/custom+json", "application/feed+xml", "application/pdf", "unknown"] { assert!(content_type(mime).unwrap_err().contains("use browser_navigate")); }
        let url = Url::parse("https://example.test/").unwrap();
        let text = "界".repeat(2100);
        let first = format_page(&url, "Title", &text, true, 1, 10);
        assert!(first.starts_with(&format!("URL: {url}\nTitle: Title\n\n{}", "界".repeat(1000))));
        assert!(first.ends_with("[Truncated: 1099 more characters. Call web_fetch again with offset=1001.]"));
        assert_eq!(format_page(&url, "", &text, false, usize::MAX, 20000), format!("URL: {url}\n\n"));
        assert!(format_page(&url, "", "short", true, 0, 20000).contains("may need JavaScript"));
        assert!(!format_page(&url, "", "short", false, 0, 20000).contains("JavaScript"));
        let long = format_page(&url, "", &"x".repeat(100001), false, 0, usize::MAX);
        assert!(long.ends_with("[Truncated: 1 more characters. Call web_fetch again with offset=100000.]"));
    }
}
